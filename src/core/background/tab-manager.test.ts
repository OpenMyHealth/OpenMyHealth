import { runtimeState } from "./state";

const lockSessionMock = vi.fn().mockResolvedValue(undefined);
vi.mock("./approval-engine", () => ({
  lockSession: (...args: unknown[]) => lockSessionMock(...args),
}));

import {
  trackVaultTab,
  untrackVaultTab,
  checkAndTrackRequestRate,
  findProviderTab,
  ensureVaultTab,
  ensureSetupTab,
} from "./tab-manager";

beforeEach(() => {
  runtimeState.session.vaultTabs.clear();
  runtimeState.providerTabs.clear();
  runtimeState.requestRateByTab.clear();
  lockSessionMock.mockClear();
});

describe("tab-manager", () => {
  describe("trackVaultTab", () => {
    it("adds vault tab URL to vaultTabs set", () => {
      const vaultUrl = browser.runtime.getURL("/vault.html");
      trackVaultTab(1, vaultUrl);
      expect(runtimeState.session.vaultTabs.has(1)).toBe(true);
    });

    it("does not add non-vault URL", () => {
      trackVaultTab(2, "https://example.com");
      expect(runtimeState.session.vaultTabs.has(2)).toBe(false);
    });

    it("removes previously tracked tab when URL changes to non-vault", () => {
      const vaultUrl = browser.runtime.getURL("/vault.html");
      trackVaultTab(1, vaultUrl);
      expect(runtimeState.session.vaultTabs.has(1)).toBe(true);

      // Add another vault tab so that removal of tab 1 doesn't trigger lockSession
      trackVaultTab(2, vaultUrl);

      trackVaultTab(1, "https://example.com");
      expect(runtimeState.session.vaultTabs.has(1)).toBe(false);
    });

    it("calls lockSession when last vault tab is removed via URL change", async () => {
      const vaultUrl = browser.runtime.getURL("/vault.html");
      trackVaultTab(1, vaultUrl);
      trackVaultTab(1, "https://example.com");

      // lockSession is called via dynamic import, so wait for microtask
      await vi.waitFor(() => {
        expect(lockSessionMock).toHaveBeenCalled();
      });
    });
  });

  describe("untrackVaultTab", () => {
    it("removes tab from vaultTabs", () => {
      runtimeState.session.vaultTabs.add(5);
      untrackVaultTab(5);
      expect(runtimeState.session.vaultTabs.has(5)).toBe(false);
    });

    it("calls lockSession when last vault tab removed", async () => {
      runtimeState.session.vaultTabs.add(10);
      untrackVaultTab(10);

      await vi.waitFor(() => {
        expect(lockSessionMock).toHaveBeenCalled();
      });
    });

    it("cleans up providerTabs", () => {
      runtimeState.providerTabs.set("chatgpt", 3);
      untrackVaultTab(3);
      expect(runtimeState.providerTabs.has("chatgpt")).toBe(false);
    });

    it("cleans up requestRateByTab", () => {
      runtimeState.requestRateByTab.set(4, [Date.now()]);
      untrackVaultTab(4);
      expect(runtimeState.requestRateByTab.has(4)).toBe(false);
    });

    it("does not remove providerTabs entries for other tabs", () => {
      runtimeState.providerTabs.set("chatgpt", 10);
      runtimeState.providerTabs.set("claude", 20);
      untrackVaultTab(10);
      expect(runtimeState.providerTabs.has("chatgpt")).toBe(false);
      expect(runtimeState.providerTabs.has("claude")).toBe(true);
    });

    it("does not trigger lockSession when other vault tabs remain", () => {
      runtimeState.session.vaultTabs.add(10);
      runtimeState.session.vaultTabs.add(20);
      untrackVaultTab(10);
      expect(runtimeState.session.vaultTabs.has(20)).toBe(true);
      expect(lockSessionMock).not.toHaveBeenCalled();
    });
  });

  describe("checkAndTrackRequestRate", () => {
    it("allows requests within limit", () => {
      expect(checkAndTrackRequestRate(1)).toBe(true);
    });

    it("returns false when limit exceeded", () => {
      for (let i = 0; i < 8; i++) {
        checkAndTrackRequestRate(1);
      }
      expect(checkAndTrackRequestRate(1)).toBe(false);
    });

    it("expires old timestamps", () => {
      // Insert old timestamps
      const oldTime = Date.now() - 60_000;
      runtimeState.requestRateByTab.set(1, Array.from({ length: 8 }, () => oldTime));

      // These should be expired, so new request allowed
      expect(checkAndTrackRequestRate(1)).toBe(true);
    });
  });

  describe("findProviderTab", () => {
    it("returns tab when preferred tab ID is trusted", async () => {
      const tab = {
        id: 42,
        url: "https://chatgpt.com/c/123",
        index: 0,
        active: true,
        pinned: false,
        highlighted: false,
        incognito: false,
        selected: false,
        windowId: 1,
        discarded: false,
        autoDiscardable: true,
        groupId: -1,
      };
      vi.spyOn(browser.tabs, "get").mockResolvedValue(tab);
      const result = await findProviderTab("chatgpt", 42);
      expect(result).toEqual(tab);
    });

    it("returns null for preferred tab that is untrusted", async () => {
      const tab = {
        id: 42,
        url: "https://evil.com",
        index: 0,
        active: true,
        pinned: false,
        highlighted: false,
        incognito: false,
        selected: false,
        windowId: 1,
        discarded: false,
        autoDiscardable: true,
        groupId: -1,
      };
      vi.spyOn(browser.tabs, "get").mockResolvedValue(tab);
      const result = await findProviderTab("chatgpt", 42);
      expect(result).toBeNull();
    });

    it("falls back to tracked provider tab", async () => {
      const tab = {
        id: 10,
        url: "https://chatgpt.com/c/abc",
        index: 0,
        active: false,
        pinned: false,
        highlighted: false,
        incognito: false,
        selected: false,
        windowId: 1,
        discarded: false,
        autoDiscardable: true,
        groupId: -1,
      };
      runtimeState.providerTabs.set("chatgpt", 10);
      vi.spyOn(browser.tabs, "get").mockResolvedValue(tab);
      const result = await findProviderTab("chatgpt");
      expect(result).toEqual(tab);
    });

    it("queries all matching tabs when no tracked tab", async () => {
      const tab = {
        id: 20,
        url: "https://chatgpt.com/c/xyz",
        index: 0,
        active: false,
        pinned: false,
        highlighted: false,
        incognito: false,
        selected: false,
        windowId: 1,
        discarded: false,
        autoDiscardable: true,
        groupId: -1,
      };
      vi.spyOn(browser.tabs, "query").mockResolvedValue([tab]);
      const result = await findProviderTab("chatgpt");
      expect(result).toEqual(tab);
      expect(browser.tabs.query).toHaveBeenCalledWith({ url: ["https://chatgpt.com/*"] });
    });

    it("prefers active tab among queried tabs", async () => {
      const inactive = {
        id: 20,
        url: "https://chatgpt.com/c/1",
        index: 0,
        active: false,
        pinned: false,
        highlighted: false,
        incognito: false,
        selected: false,
        windowId: 1,
        discarded: false,
        autoDiscardable: true,
        groupId: -1,
      };
      const active = {
        id: 21,
        url: "https://chatgpt.com/c/2",
        index: 1,
        active: true,
        pinned: false,
        highlighted: false,
        incognito: false,
        selected: false,
        windowId: 1,
        discarded: false,
        autoDiscardable: true,
        groupId: -1,
      };
      vi.spyOn(browser.tabs, "query").mockResolvedValue([inactive, active]);
      const result = await findProviderTab("chatgpt");
      expect(result?.id).toBe(21);
    });

    it("returns null with no matching tabs", async () => {
      vi.spyOn(browser.tabs, "query").mockResolvedValue([]);
      const result = await findProviderTab("chatgpt");
      expect(result).toBeNull();
    });

    it("falls through to query when tracked tab URL is untrusted", async () => {
      const untrustedTab = {
        id: 10,
        url: "https://evil.com",
        index: 0,
        active: false,
        pinned: false,
        highlighted: false,
        incognito: false,
        selected: false,
        windowId: 1,
        discarded: false,
        autoDiscardable: true,
        groupId: -1,
      };
      const trustedTab = {
        id: 20,
        url: "https://chatgpt.com/c/abc",
        index: 0,
        active: false,
        pinned: false,
        highlighted: false,
        incognito: false,
        selected: false,
        windowId: 1,
        discarded: false,
        autoDiscardable: true,
        groupId: -1,
      };
      runtimeState.providerTabs.set("chatgpt", 10);
      vi.spyOn(browser.tabs, "get").mockResolvedValue(untrustedTab);
      vi.spyOn(browser.tabs, "query").mockResolvedValue([trustedTab]);
      const result = await findProviderTab("chatgpt");
      expect(result?.id).toBe(20);
    });

    it("cleans up providerTabs when tracked tab throws", async () => {
      runtimeState.providerTabs.set("chatgpt", 999);
      vi.spyOn(browser.tabs, "get").mockRejectedValue(new Error("No tab with id 999"));
      vi.spyOn(browser.tabs, "query").mockResolvedValue([]);

      const result = await findProviderTab("chatgpt");
      expect(result).toBeNull();
      expect(runtimeState.providerTabs.has("chatgpt")).toBe(false);
    });

    it("returns null for provider with empty hosts (gemini)", async () => {
      const result = await findProviderTab("gemini");
      expect(result).toBeNull();
    });

    it("filters out tabs with untrusted URLs from query results", async () => {
      const untrustedTab = {
        id: 30,
        url: undefined,
        index: 0,
        active: false,
        pinned: false,
        highlighted: false,
        incognito: false,
        selected: false,
        windowId: 1,
        discarded: false,
        autoDiscardable: true,
        groupId: -1,
      };
      vi.spyOn(browser.tabs, "query").mockResolvedValue([untrustedTab as chrome.tabs.Tab]);
      const result = await findProviderTab("chatgpt");
      expect(result).toBeNull();
    });
  });

  describe("ensureVaultTab", () => {
    it("opens new tab if none exist", async () => {
      vi.spyOn(browser.tabs, "query").mockResolvedValue([]);
      const createSpy = vi.spyOn(browser.tabs, "create").mockResolvedValue({
        id: 100,
        index: 0,
        active: true,
        pinned: false,
        highlighted: false,
        incognito: false,
        selected: false,
        windowId: 1,
        discarded: false,
        autoDiscardable: true,
        groupId: -1,
      });

      await ensureVaultTab();
      expect(createSpy).toHaveBeenCalledWith({ url: browser.runtime.getURL("/vault.html") });
    });

    it("activates existing tab", async () => {
      const existingTab = {
        id: 50,
        index: 0,
        active: false,
        pinned: false,
        highlighted: false,
        incognito: false,
        selected: false,
        windowId: 1,
        discarded: false,
        autoDiscardable: true,
        groupId: -1,
      };
      vi.spyOn(browser.tabs, "query").mockResolvedValue([existingTab]);
      const updateSpy = vi.spyOn(browser.tabs, "update").mockResolvedValue({
        ...existingTab,
        active: true,
      });

      await ensureVaultTab();
      expect(updateSpy).toHaveBeenCalledWith(50, { active: true });
    });
  });

  describe("ensureSetupTab", () => {
    it("opens new tab if none exist", async () => {
      vi.spyOn(browser.tabs, "query").mockResolvedValue([]);
      const createSpy = vi.spyOn(browser.tabs, "create").mockResolvedValue({
        id: 101,
        index: 0,
        active: true,
        pinned: false,
        highlighted: false,
        incognito: false,
        selected: false,
        windowId: 1,
        discarded: false,
        autoDiscardable: true,
        groupId: -1,
      });

      await ensureSetupTab();
      expect(createSpy).toHaveBeenCalledWith({ url: browser.runtime.getURL("/setup.html") });
    });

    it("activates existing setup tab", async () => {
      const existingTab = {
        id: 60,
        index: 0,
        active: false,
        pinned: false,
        highlighted: false,
        incognito: false,
        selected: false,
        windowId: 1,
        discarded: false,
        autoDiscardable: true,
        groupId: -1,
      };
      vi.spyOn(browser.tabs, "query").mockResolvedValue([existingTab]);
      const updateSpy = vi.spyOn(browser.tabs, "update").mockResolvedValue({
        ...existingTab,
        active: true,
      });

      await ensureSetupTab();
      expect(updateSpy).toHaveBeenCalledWith(60, { active: true });
    });
  });
});
