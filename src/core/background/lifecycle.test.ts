const ensureSetupTabMock = vi.fn().mockResolvedValue(undefined);
const ensureVaultTabMock = vi.fn().mockResolvedValue(undefined);
const trackVaultTabMock = vi.fn();
const untrackVaultTabMock = vi.fn();

vi.mock("./approval-engine", () => ({
  ensureBackgroundReady: vi.fn().mockResolvedValue(undefined),
  lockSession: vi.fn().mockResolvedValue(undefined),
  clearPersistedApprovalState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./settings", () => ({
  getSettings: vi.fn().mockResolvedValue({
    pinConfig: null,
    locale: "ko-KR",
    schemaVersion: 1,
    lockout: { failedAttempts: 0, lockUntil: null },
    connectedProvider: null,
    alwaysAllowScopes: [],
    integrationWarning: null,
  }),
  toReadableError: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

vi.mock("./tab-manager", () => ({
  trackVaultTab: (...args: unknown[]) => trackVaultTabMock(...args),
  untrackVaultTab: (...args: unknown[]) => untrackVaultTabMock(...args),
  ensureVaultTab: (...args: unknown[]) => ensureVaultTabMock(...args),
  ensureSetupTab: (...args: unknown[]) => ensureSetupTabMock(...args),
}));

vi.mock("./message-handlers", () => ({
  handleRuntimeMessage: vi.fn().mockResolvedValue({ ok: true }),
}));

import { ensureBackgroundReady, lockSession, clearPersistedApprovalState } from "./approval-engine";
import { getSettings } from "./settings";
import { handleRuntimeMessage } from "./message-handlers";
import {
  onInstalled,
  onActionClicked,
  onTabUpdated,
  onTabRemoved,
  onStartup,
  onMessage,
} from "./lifecycle";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("lifecycle", () => {
  describe("onInstalled", () => {
    it("calls ensureSetupTab and clearPersistedApprovalState on install", async () => {
      await onInstalled({ reason: "install" } as chrome.runtime.InstalledDetails);

      expect(ensureSetupTabMock).toHaveBeenCalled();
      expect(clearPersistedApprovalState).toHaveBeenCalled();
    });

    it("does not call lockSession on install", async () => {
      await onInstalled({ reason: "install" } as chrome.runtime.InstalledDetails);

      expect(lockSession).not.toHaveBeenCalled();
    });

    it("calls lockSession on update", async () => {
      await onInstalled({ reason: "update" } as chrome.runtime.InstalledDetails);

      expect(lockSession).toHaveBeenCalledWith("runtime update");
    });

    it("does not call ensureSetupTab on update", async () => {
      await onInstalled({ reason: "update" } as chrome.runtime.InstalledDetails);

      expect(ensureSetupTabMock).not.toHaveBeenCalled();
    });
  });

  describe("onActionClicked", () => {
    it("opens setup tab when no PIN is configured", async () => {
      vi.mocked(getSettings).mockResolvedValueOnce({
        pinConfig: null,
        locale: "ko-KR",
        schemaVersion: 1,
        lockout: { failedAttempts: 0, lockUntil: null },
        connectedProvider: null,
        alwaysAllowScopes: [],
        integrationWarning: null,
      });

      await onActionClicked({} as chrome.tabs.Tab);

      expect(ensureSetupTabMock).toHaveBeenCalled();
      expect(ensureVaultTabMock).not.toHaveBeenCalled();
    });

    it("opens vault tab when PIN is configured", async () => {
      vi.mocked(getSettings).mockResolvedValueOnce({
        pinConfig: { salt: "abc", verifier: "def" },
        locale: "ko-KR",
        schemaVersion: 1,
        lockout: { failedAttempts: 0, lockUntil: null },
        connectedProvider: null,
        alwaysAllowScopes: [],
        integrationWarning: null,
      });

      await onActionClicked({} as chrome.tabs.Tab);

      expect(ensureVaultTabMock).toHaveBeenCalled();
      expect(ensureSetupTabMock).not.toHaveBeenCalled();
    });
  });

  describe("onTabUpdated", () => {
    it("tracks vault tab when URL changes", () => {
      onTabUpdated(1, { url: "chrome-extension://abc/vault.html" }, { url: "chrome-extension://abc/vault.html" });

      expect(trackVaultTabMock).toHaveBeenCalledWith(1, "chrome-extension://abc/vault.html");
    });

    it("tracks vault tab on complete status when no URL in changeInfo", () => {
      onTabUpdated(2, { status: "complete" }, { url: "chrome-extension://abc/vault.html" });

      expect(trackVaultTabMock).toHaveBeenCalledWith(2, "chrome-extension://abc/vault.html");
    });

    it("does not track when neither url nor complete status", () => {
      onTabUpdated(3, { status: "loading" }, { url: "https://example.com" });

      expect(trackVaultTabMock).not.toHaveBeenCalled();
    });
  });

  describe("onTabRemoved", () => {
    it("calls untrackVaultTab", () => {
      onTabRemoved(42);

      expect(untrackVaultTabMock).toHaveBeenCalledWith(42);
    });
  });

  describe("onStartup", () => {
    it("calls lockSession with 'runtime startup'", async () => {
      await onStartup();

      expect(lockSession).toHaveBeenCalledWith("runtime startup");
    });
  });

  describe("onMessage", () => {
    it("delegates to handleRuntimeMessage and returns true", () => {
      const sendResponse = vi.fn();
      const result = onMessage({ type: "vault:get-state" }, {} as chrome.runtime.MessageSender, sendResponse);

      expect(result).toBe(true);
    });

    it("calls ensureBackgroundReady then handleRuntimeMessage and sends response", async () => {
      const sendResponse = vi.fn();
      const message = { type: "vault:get-state" };
      const sender = {} as chrome.runtime.MessageSender;
      vi.mocked(handleRuntimeMessage).mockResolvedValue({ ok: true });

      onMessage(message, sender, sendResponse);

      await vi.waitFor(() => {
        expect(sendResponse).toHaveBeenCalled();
      });

      expect(ensureBackgroundReady).toHaveBeenCalled();
      expect(handleRuntimeMessage).toHaveBeenCalledWith(message, sender);
      expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    });

    it("sends error response when handleRuntimeMessage throws", async () => {
      const sendResponse = vi.fn();
      vi.mocked(handleRuntimeMessage).mockRejectedValue(new Error("handler fail"));

      onMessage({ type: "bad" }, {} as chrome.runtime.MessageSender, sendResponse);

      await vi.waitFor(() => {
        expect(sendResponse).toHaveBeenCalled();
      });

      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: false,
          error: expect.any(String),
        }),
      );
    });
  });
});
