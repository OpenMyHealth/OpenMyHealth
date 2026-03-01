import type { AppSettings } from "@/core/models";
import { setSettingsCache, runtimeState, setUnlockInFlight } from "./state";

const loadSettingsMock = vi.fn();
const saveSettingsMock = vi.fn();
vi.mock("../db", () => ({
  loadSettings: (...args: unknown[]) => loadSettingsMock(...args),
  saveSettings: (...args: unknown[]) => saveSettingsMock(...args),
}));

const derivePinVerifierMock = vi.fn();
const deriveAesKeyMock = vi.fn();
vi.mock("../crypto", () => ({
  derivePinVerifier: (...args: unknown[]) => derivePinVerifierMock(...args),
  deriveAesKey: (...args: unknown[]) => deriveAesKeyMock(...args),
}));

import {
  getSettings,
  updateSettings,
  toPublicSettings,
  toReadableError,
  isSixDigitPin,
  getLockoutCooldownMs,
  verifyAndUnlock,
  withUnlockMutex,
} from "./settings";

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    locale: "ko-KR",
    schemaVersion: 1,
    pinConfig: null,
    lockout: { failedAttempts: 0, lockUntil: null },
    connectedProvider: null,
    alwaysAllowScopes: [],
    integrationWarning: null,
    ...overrides,
  };
}

beforeEach(() => {
  setSettingsCache(null);
  setUnlockInFlight(Promise.resolve());
  runtimeState.session.isUnlocked = false;
  runtimeState.session.key = null;
  loadSettingsMock.mockReset();
  saveSettingsMock.mockReset();
  derivePinVerifierMock.mockReset();
  deriveAesKeyMock.mockReset();
});

describe("settings", () => {
  describe("getSettings", () => {
    it("returns cached value if available", async () => {
      const cached = makeSettings({ locale: "en" });
      setSettingsCache(cached);
      const result = await getSettings();
      expect(result).toBe(cached);
      expect(loadSettingsMock).not.toHaveBeenCalled();
    });

    it("loads from db on first call", async () => {
      const loaded = makeSettings({ locale: "ja" });
      loadSettingsMock.mockResolvedValue(loaded);
      const result = await getSettings();
      expect(result).toBe(loaded);
      expect(loadSettingsMock).toHaveBeenCalledOnce();
    });
  });

  describe("updateSettings", () => {
    it("applies mutation and saves", async () => {
      const initial = makeSettings({ locale: "ko-KR" });
      setSettingsCache(initial);
      saveSettingsMock.mockResolvedValue(undefined);

      const result = await updateSettings((s) => {
        s.locale = "en";
      });
      expect(result.locale).toBe("en");
      expect(saveSettingsMock).toHaveBeenCalledOnce();
    });

    it("skips save if no change", async () => {
      const initial = makeSettings();
      setSettingsCache(initial);

      const result = await updateSettings(() => {
        // no-op
      });
      expect(result).toBe(initial);
      expect(saveSettingsMock).not.toHaveBeenCalled();
    });
  });

  describe("toPublicSettings", () => {
    it("omits pinConfig and alwaysAllowScopes", () => {
      const settings = makeSettings({
        pinConfig: { salt: "abc", verifier: "xyz" },
        alwaysAllowScopes: ["scope1"],
        connectedProvider: "chatgpt",
      });
      const pub = toPublicSettings(settings);
      expect(pub).not.toHaveProperty("pinConfig");
      expect(pub).not.toHaveProperty("alwaysAllowScopes");
      expect(pub.connectedProvider).toBe("chatgpt");
      expect(pub.locale).toBe("ko-KR");
    });
  });

  describe("toReadableError", () => {
    it("returns Error.message for Error instances", () => {
      expect(toReadableError(new Error("fail"))).toBe("fail");
    });

    it("returns string as-is", () => {
      expect(toReadableError("oops")).toBe("oops");
    });
  });

  describe("isSixDigitPin", () => {
    it("returns true for 123456", () => {
      expect(isSixDigitPin("123456")).toBe(true);
    });

    it("returns false for 5 digits", () => {
      expect(isSixDigitPin("12345")).toBe(false);
    });

    it("returns false for 7 digits", () => {
      expect(isSixDigitPin("1234567")).toBe(false);
    });

    it("returns false for letters", () => {
      expect(isSixDigitPin("abcdef")).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(isSixDigitPin("")).toBe(false);
    });
  });

  describe("getLockoutCooldownMs", () => {
    it("returns 0 for 0 failed attempts", () => {
      expect(getLockoutCooldownMs(0)).toBe(0);
    });

    it("returns 0 for 2 failed attempts", () => {
      expect(getLockoutCooldownMs(2)).toBe(0);
    });

    it("returns 10000 for 3 failed attempts", () => {
      expect(getLockoutCooldownMs(3)).toBe(10_000);
    });

    it("returns 60000 for 5 failed attempts", () => {
      expect(getLockoutCooldownMs(5)).toBe(60_000);
    });

    it("returns 300000 for 10 failed attempts", () => {
      expect(getLockoutCooldownMs(10)).toBe(300_000);
    });
  });

  describe("verifyAndUnlock", () => {
    it("unlocks with correct pin", async () => {
      const verifier = "correct-verifier";
      const settings = makeSettings({
        pinConfig: { salt: "test-salt", verifier },
      });
      setSettingsCache(settings);

      derivePinVerifierMock.mockResolvedValue(verifier);
      deriveAesKeyMock.mockResolvedValue({} as CryptoKey);
      saveSettingsMock.mockResolvedValue(undefined);

      const result = await verifyAndUnlock("123456");
      expect(result.unlocked).toBe(true);
      expect(result.lockoutUntil).toBeNull();
      expect(runtimeState.session.isUnlocked).toBe(true);
    });

    it("calls deriveAesKey with (pin, salt) on successful PIN verification (SET-1)", async () => {
      const verifier = "correct-verifier";
      const settings = makeSettings({
        pinConfig: { salt: "my-salt-value", verifier },
      });
      setSettingsCache(settings);

      derivePinVerifierMock.mockResolvedValue(verifier);
      deriveAesKeyMock.mockResolvedValue({} as CryptoKey);
      saveSettingsMock.mockResolvedValue(undefined);

      await verifyAndUnlock("654321");
      expect(deriveAesKeyMock).toHaveBeenCalledWith("654321", "my-salt-value");
    });

    it("returns unlocked:false when no pinConfig exists", async () => {
      const settings = makeSettings({ pinConfig: null });
      setSettingsCache(settings);

      const result = await verifyAndUnlock("123456");
      expect(result.unlocked).toBe(false);
      expect(result.lockoutUntil).toBeNull();
    });

    it("returns unlocked:false with lockoutUntil during active lockout", async () => {
      const futureTime = Date.now() + 60_000;
      const settings = makeSettings({
        pinConfig: { salt: "test-salt", verifier: "v" },
        lockout: { failedAttempts: 5, lockUntil: futureTime },
      });
      setSettingsCache(settings);

      const result = await verifyAndUnlock("123456");
      expect(result.unlocked).toBe(false);
      expect(result.lockoutUntil).toBe(futureTime);
    });

    it("clears expired lockout then verifies PIN", async () => {
      const verifier = "correct-verifier";
      const pastTime = Date.now() - 1000;
      const settings = makeSettings({
        pinConfig: { salt: "test-salt", verifier },
        lockout: { failedAttempts: 3, lockUntil: pastTime },
      });
      setSettingsCache(settings);
      saveSettingsMock.mockResolvedValue(undefined);
      derivePinVerifierMock.mockResolvedValue(verifier);
      deriveAesKeyMock.mockResolvedValue({} as CryptoKey);

      const result = await verifyAndUnlock("123456");
      expect(result.unlocked).toBe(true);
      expect(result.lockoutUntil).toBeNull();
      // updateSettings should have been called to clear the lockout, then again to reset failedAttempts
      expect(saveSettingsMock).toHaveBeenCalled();
    });

    it("increments failedAttempts and sets lockout on wrong PIN (SET-2)", async () => {
      const settings = makeSettings({
        pinConfig: { salt: "test-salt", verifier: "correct" },
        lockout: { failedAttempts: 2, lockUntil: null },
      });
      setSettingsCache(settings);
      saveSettingsMock.mockResolvedValue(undefined);
      derivePinVerifierMock.mockResolvedValue("wrong-verifier");

      const before = Date.now();
      const result = await verifyAndUnlock("000000");
      expect(result.unlocked).toBe(false);
      // After 3 failed attempts, lockout cooldown is 10_000ms
      expect(result.lockoutUntil).toBeTypeOf("number");
      expect(result.lockoutUntil).toBeGreaterThanOrEqual(before + 10_000);
      expect(result.lockoutUntil).toBeLessThanOrEqual(Date.now() + 10_000);
      expect(runtimeState.session.isUnlocked).toBe(false);
    });
  });

  describe("withUnlockMutex", () => {
    it("serializes concurrent calls", async () => {
      const order: number[] = [];
      const first = withUnlockMutex(async () => {
        await new Promise((r) => setTimeout(r, 20));
        order.push(1);
        return "a";
      });
      const second = withUnlockMutex(async () => {
        order.push(2);
        return "b";
      });

      const [r1, r2] = await Promise.all([first, second]);
      expect(r1).toBe("a");
      expect(r2).toBe("b");
      // The second call waits for the first to complete
      expect(order).toEqual([1, 2]);
    });

    it("recovers from rejected operation", async () => {
      const failing = withUnlockMutex(async () => {
        throw new Error("boom");
      });
      await expect(failing).rejects.toThrow("boom");

      // Next call should still work (mutex recovered)
      const success = await withUnlockMutex(async () => "ok");
      expect(success).toBe("ok");
    });
  });
});
