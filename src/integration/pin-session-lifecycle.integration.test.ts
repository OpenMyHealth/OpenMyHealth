import "fake-indexeddb/auto";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { fakeBrowser } from "wxt/testing";

vi.stubGlobal("navigator", { language: "ko-KR" });

describe("PIN session lifecycle integration", () => {
  const PIN = "123456";
  const WRONG_PIN = "000000";

  beforeEach(async () => {
    fakeBrowser.reset();
    vi.resetModules();

    vi.spyOn(browser.tabs, "sendMessage").mockResolvedValue(undefined);
    vi.spyOn(browser.runtime, "getManifest").mockReturnValue({
      version: "0.0.0-test",
      manifest_version: 3,
      name: "OpenMyHealth Test",
    } as chrome.runtime.Manifest);

    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase("openmyhealth_vault");
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve();
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeSender() {
    return {
      id: browser.runtime.id,
      url: browser.runtime.getURL("/vault.html"),
      tab: {
        id: 1, index: 0, active: true, pinned: false, highlighted: false,
        incognito: false, selected: false, windowId: 1, discarded: false,
        autoDiscardable: true, groupId: -1, frozen: false,
      },
      frameId: 0,
    };
  }

  function makeSetupSender() {
    return {
      id: browser.runtime.id,
      url: browser.runtime.getURL("/setup.html"),
      tab: {
        id: 2, index: 0, active: true, pinned: false, highlighted: false,
        incognito: false, selected: false, windowId: 1, discarded: false,
        autoDiscardable: true, groupId: -1, frozen: false,
      },
      frameId: 0,
    };
  }

  it("sets up PIN and stores salt + verifier in settings", async () => {
    const { handleSetupPin } = await import("../core/background/message-handlers");
    const { loadSettings } = await import("../core/db");

    const result = await handleSetupPin(
      { type: "session:setup-pin", pin: PIN, locale: "ko-KR" },
      makeSetupSender(),
    );

    expect(result).toMatchObject({ ok: true, isUnlocked: true });

    const settings = await loadSettings();
    expect(settings.pinConfig).toBeTruthy();
    expect(settings.pinConfig!.salt).toBeTruthy();
    expect(settings.pinConfig!.verifier).toBeTruthy();
  });

  it("unlocks with correct PIN after setup", async () => {
    const { handleSetupPin, handleSessionUnlock } = await import("../core/background/message-handlers");

    await handleSetupPin(
      { type: "session:setup-pin", pin: PIN, locale: "ko-KR" },
      makeSetupSender(),
    );

    const { runtimeState, setSettingsCache } = await import("../core/background/state");
    runtimeState.session.isUnlocked = false;
    runtimeState.session.key = null;
    setSettingsCache(null);

    const result = await handleSessionUnlock(
      { type: "session:unlock", pin: PIN },
      makeSender(),
    );

    expect(result).toMatchObject({ ok: true, isUnlocked: true });
    expect(runtimeState.session.isUnlocked).toBe(true);
    expect(runtimeState.session.key).toBeTruthy();
  });

  it("fails to unlock with wrong PIN", async () => {
    const { handleSetupPin, handleSessionUnlock } = await import("../core/background/message-handlers");

    await handleSetupPin(
      { type: "session:setup-pin", pin: PIN, locale: "ko-KR" },
      makeSetupSender(),
    );

    const { runtimeState, setSettingsCache } = await import("../core/background/state");
    runtimeState.session.isUnlocked = false;
    runtimeState.session.key = null;
    setSettingsCache(null);

    const result = await handleSessionUnlock(
      { type: "session:unlock", pin: WRONG_PIN },
      makeSender(),
    );

    expect(result).toMatchObject({ ok: true, isUnlocked: false });
    expect(runtimeState.session.isUnlocked).toBe(false);
    expect(runtimeState.session.key).toBeNull();
  });

  it("increments failedAttempts on wrong PIN", async () => {
    const { handleSetupPin, handleSessionUnlock } = await import("../core/background/message-handlers");
    const { loadSettings } = await import("../core/db");

    await handleSetupPin(
      { type: "session:setup-pin", pin: PIN, locale: "ko-KR" },
      makeSetupSender(),
    );

    const { runtimeState, setSettingsCache } = await import("../core/background/state");
    runtimeState.session.isUnlocked = false;
    runtimeState.session.key = null;
    setSettingsCache(null);

    await handleSessionUnlock(
      { type: "session:unlock", pin: WRONG_PIN },
      makeSender(),
    );

    setSettingsCache(null);
    const settings = await loadSettings();
    expect(settings.lockout.failedAttempts).toBe(1);
  });

  it("applies lockout after 3 failed attempts", async () => {
    const { handleSetupPin, handleSessionUnlock } = await import("../core/background/message-handlers");
    const { loadSettings } = await import("../core/db");

    await handleSetupPin(
      { type: "session:setup-pin", pin: PIN, locale: "ko-KR" },
      makeSetupSender(),
    );

    const { runtimeState, setSettingsCache } = await import("../core/background/state");

    for (let i = 0; i < 3; i++) {
      runtimeState.session.isUnlocked = false;
      runtimeState.session.key = null;
      setSettingsCache(null);

      await handleSessionUnlock(
        { type: "session:unlock", pin: WRONG_PIN },
        makeSender(),
      );
    }

    setSettingsCache(null);
    const settings = await loadSettings();
    expect(settings.lockout.failedAttempts).toBe(3);
    expect(settings.lockout.lockUntil).toBeTypeOf("number");
    expect(settings.lockout.lockUntil!).toBeGreaterThan(Date.now() - 1000);
  });

  it("locks session and clears key", async () => {
    const { handleSetupPin, handleSessionLock } = await import("../core/background/message-handlers");

    await handleSetupPin(
      { type: "session:setup-pin", pin: PIN, locale: "ko-KR" },
      makeSetupSender(),
    );

    const { runtimeState } = await import("../core/background/state");
    expect(runtimeState.session.isUnlocked).toBe(true);
    expect(runtimeState.session.key).toBeTruthy();

    const result = await handleSessionLock(makeSender());
    expect(result).toMatchObject({ ok: true });
    expect(runtimeState.session.isUnlocked).toBe(false);
    expect(runtimeState.session.key).toBeNull();
  });

  it("re-unlocks after lock with correct PIN", async () => {
    const { handleSetupPin, handleSessionLock, handleSessionUnlock } = await import("../core/background/message-handlers");

    await handleSetupPin(
      { type: "session:setup-pin", pin: PIN, locale: "ko-KR" },
      makeSetupSender(),
    );

    await handleSessionLock(makeSender());

    const { runtimeState, setSettingsCache } = await import("../core/background/state");
    expect(runtimeState.session.isUnlocked).toBe(false);

    setSettingsCache(null);
    const result = await handleSessionUnlock(
      { type: "session:unlock", pin: PIN },
      makeSender(),
    );

    expect(result).toMatchObject({ ok: true, isUnlocked: true });
    expect(runtimeState.session.isUnlocked).toBe(true);
    expect(runtimeState.session.key).toBeTruthy();
  });

  it("rejects setup if PIN already configured", async () => {
    const { handleSetupPin } = await import("../core/background/message-handlers");

    await handleSetupPin(
      { type: "session:setup-pin", pin: PIN, locale: "ko-KR" },
      makeSetupSender(),
    );

    const result = await handleSetupPin(
      { type: "session:setup-pin", pin: "999999", locale: "ko-KR" },
      makeSetupSender(),
    );

    expect(result).toMatchObject({ ok: false });
  });

  it("resets failedAttempts after successful unlock", async () => {
    const { handleSetupPin, handleSessionUnlock } = await import("../core/background/message-handlers");
    const { loadSettings } = await import("../core/db");

    await handleSetupPin(
      { type: "session:setup-pin", pin: PIN, locale: "ko-KR" },
      makeSetupSender(),
    );

    const { runtimeState, setSettingsCache } = await import("../core/background/state");

    for (let i = 0; i < 2; i++) {
      runtimeState.session.isUnlocked = false;
      runtimeState.session.key = null;
      setSettingsCache(null);
      await handleSessionUnlock(
        { type: "session:unlock", pin: WRONG_PIN },
        makeSender(),
      );
    }

    runtimeState.session.isUnlocked = false;
    runtimeState.session.key = null;
    setSettingsCache(null);
    await handleSessionUnlock(
      { type: "session:unlock", pin: PIN },
      makeSender(),
    );

    setSettingsCache(null);
    const settings = await loadSettings();
    expect(settings.lockout.failedAttempts).toBe(0);
    expect(settings.lockout.lockUntil).toBeNull();
  });

  it("rejects invalid PIN format", async () => {
    const { handleSetupPin } = await import("../core/background/message-handlers");

    const result = await handleSetupPin(
      { type: "session:setup-pin", pin: "abc", locale: "ko-KR" },
      makeSetupSender(),
    );

    expect(result).toMatchObject({ ok: false });
  });
});
