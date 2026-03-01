import "fake-indexeddb/auto";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { fakeBrowser } from "wxt/testing";

vi.stubGlobal("navigator", { language: "ko-KR" });

describe("message handler routing integration", () => {
  beforeEach(async () => {
    fakeBrowser.reset();
    vi.resetModules();

    vi.spyOn(browser.tabs, "sendMessage").mockResolvedValue(undefined);
    vi.spyOn(browser.tabs, "query").mockResolvedValue([]);
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

  function makeVaultSender() {
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

  function makeExternalSender() {
    return {
      id: "other-extension-id",
      url: "https://malicious-site.com",
      tab: {
        id: 99, index: 0, active: true, pinned: false, highlighted: false,
        incognito: false, selected: false, windowId: 1,
        url: "https://malicious-site.com",
        discarded: false, autoDiscardable: true, groupId: -1, frozen: false,
      },
      frameId: 0,
    };
  }

  it("runtime:ping returns service info", async () => {
    const { handleRuntimeMessage } = await import("../core/background/message-handlers");

    const result = await handleRuntimeMessage(
      { type: "runtime:ping" },
      makeVaultSender(),
    );

    expect(result).toMatchObject({
      ok: true,
      service: "background",
      version: "0.0.0-test",
    });
  });

  it("vault:get-state returns current settings and session state", async () => {
    const { handleRuntimeMessage } = await import("../core/background/message-handlers");

    const result = await handleRuntimeMessage(
      { type: "vault:get-state" },
      makeVaultSender(),
    );

    expect(result).toMatchObject({
      ok: true,
    });
    expect(result).toHaveProperty("settings");
    expect(result).toHaveProperty("session");
  });

  it("unknown message type returns error", async () => {
    const { handleRuntimeMessage } = await import("../core/background/message-handlers");

    const result = await handleRuntimeMessage(
      { type: "unknown:command" },
      makeVaultSender(),
    );

    expect(result).toMatchObject({ ok: false });
  });

  it("rejects non-object messages", async () => {
    const { handleRuntimeMessage } = await import("../core/background/message-handlers");

    const result = await handleRuntimeMessage(
      "not-an-object",
      makeVaultSender(),
    );

    expect(result).toMatchObject({ ok: false });
  });

  it("rejects vault:get-state from untrusted sender", async () => {
    const { handleRuntimeMessage } = await import("../core/background/message-handlers");

    const result = await handleRuntimeMessage(
      { type: "vault:get-state" },
      makeExternalSender(),
    );

    expect(result).toMatchObject({ ok: false });
  });

  it("session:lock from untrusted sender is rejected", async () => {
    const { handleRuntimeMessage } = await import("../core/background/message-handlers");

    const result = await handleRuntimeMessage(
      { type: "session:lock" },
      makeExternalSender(),
    );

    expect(result).toMatchObject({ ok: false });
  });

  it("vault:list-files returns empty array when locked", async () => {
    const { handleRuntimeMessage } = await import("../core/background/message-handlers");

    const result = await handleRuntimeMessage(
      { type: "vault:list-files" },
      makeVaultSender(),
    );

    expect(result).toMatchObject({ ok: true, files: [] });
  });

  it("isRuntimeMessage correctly validates message structure", async () => {
    const { isRuntimeMessage } = await import("../core/background/message-handlers");

    expect(isRuntimeMessage({ type: "runtime:ping" })).toBe(true);
    expect(isRuntimeMessage({ type: "vault:get-state" })).toBe(true);
    expect(isRuntimeMessage({ type: "unknown:type" })).toBe(false);
    expect(isRuntimeMessage(null)).toBe(false);
    expect(isRuntimeMessage(undefined)).toBe(false);
    expect(isRuntimeMessage("string")).toBe(false);
    expect(isRuntimeMessage({ noType: true })).toBe(false);
  });
});
