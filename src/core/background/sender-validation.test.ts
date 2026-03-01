describe("sender-validation", () => {
  let mod: typeof import("@/core/background/sender-validation");

  function makeSender(overrides: Record<string, unknown> = {}): chrome.runtime.MessageSender {
    return {
      id: browser.runtime.id,
      url: browser.runtime.getURL("/vault.html"),
      tab: {
        id: 1,
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
      },
      frameId: 0,
      ...overrides,
    } as chrome.runtime.MessageSender;
  }

  beforeEach(async () => {
    vi.resetModules();
    mod = await import("./sender-validation");
  });

  describe("canTrustProviderHost", () => {
    it("trusts chatgpt.com over https", () => {
      expect(mod.canTrustProviderHost("chatgpt", "https://chatgpt.com/c/123")).toBe(true);
    });

    it("trusts claude.ai over https", () => {
      expect(mod.canTrustProviderHost("claude", "https://claude.ai/chat")).toBe(true);
    });

    it("rejects http protocol", () => {
      expect(mod.canTrustProviderHost("chatgpt", "http://chatgpt.com/c/123")).toBe(false);
    });

    it("rejects undefined url", () => {
      expect(mod.canTrustProviderHost("chatgpt", undefined)).toBe(false);
    });

    it("rejects invalid url", () => {
      expect(mod.canTrustProviderHost("chatgpt", "invalid-url")).toBe(false);
    });

    it("rejects subdomain mismatch", () => {
      expect(mod.canTrustProviderHost("chatgpt", "https://evil.chatgpt.com")).toBe(false);
    });

    it("rejects gemini with any host (empty hosts list)", () => {
      expect(mod.canTrustProviderHost("gemini", "https://gemini.google.com")).toBe(false);
    });
  });

  describe("isTrustedSenderForProvider", () => {
    it("returns true for valid chatgpt sender", () => {
      const sender = makeSender({
        url: "https://chatgpt.com/c/123",
        tab: { id: 1, index: 0, active: true, pinned: false, highlighted: false, incognito: false, selected: false, windowId: 1, discarded: false, autoDiscardable: true, groupId: -1 },
      });
      expect(mod.isTrustedSenderForProvider(sender, "chatgpt")).toBe(true);
    });

    it("returns false for wrong runtime.id", () => {
      const sender = makeSender({
        id: "wrong-id",
        url: "https://chatgpt.com/c/123",
      });
      expect(mod.isTrustedSenderForProvider(sender, "chatgpt")).toBe(false);
    });

    it("returns false without tab.id", () => {
      const sender = makeSender({
        url: "https://chatgpt.com/c/123",
        tab: undefined,
      });
      expect(mod.isTrustedSenderForProvider(sender, "chatgpt")).toBe(false);
    });

    it("returns false for iframe (frameId > 0)", () => {
      const sender = makeSender({
        url: "https://chatgpt.com/c/123",
        frameId: 1,
      });
      expect(mod.isTrustedSenderForProvider(sender, "chatgpt")).toBe(false);
    });

    it("returns false for wrong host", () => {
      const sender = makeSender({
        url: "https://evil.com/c/123",
      });
      expect(mod.isTrustedSenderForProvider(sender, "chatgpt")).toBe(false);
    });

    it("falls back to tab.url when sender.url is undefined", () => {
      const sender = makeSender({
        url: undefined,
        tab: { id: 1, index: 0, active: true, pinned: false, highlighted: false, incognito: false, selected: false, windowId: 1, discarded: false, autoDiscardable: true, groupId: -1, url: "https://chatgpt.com/c/123" },
      });
      expect(mod.isTrustedSenderForProvider(sender, "chatgpt")).toBe(true);
    });

    it("returns false when both sender.url and tab.url are undefined", () => {
      const sender = makeSender({
        url: undefined,
        tab: { id: 1, index: 0, active: true, pinned: false, highlighted: false, incognito: false, selected: false, windowId: 1, discarded: false, autoDiscardable: true, groupId: -1 },
      });
      expect(mod.isTrustedSenderForProvider(sender, "chatgpt")).toBe(false);
    });
  });

  describe("isVaultPageSender", () => {
    it("returns true for vault URL and adds to vaultTabs", async () => {
      const { runtimeState } = await import("./state");
      const sender = makeSender({
        url: browser.runtime.getURL("/vault.html"),
      });
      expect(mod.isVaultPageSender(sender)).toBe(true);
      expect(runtimeState.session.vaultTabs.has(1)).toBe(true);
    });

    it("returns false for non-vault URL", () => {
      const sender = makeSender({
        url: "https://example.com",
      });
      expect(mod.isVaultPageSender(sender)).toBe(false);
    });

    it("returns false for wrong runtime.id", () => {
      const sender = makeSender({
        id: "wrong-id",
        url: browser.runtime.getURL("/vault.html"),
      });
      expect(mod.isVaultPageSender(sender)).toBe(false);
    });

    it("falls back to tab.url when sender.url is undefined", async () => {
      const { runtimeState } = await import("./state");
      const sender = makeSender({
        url: undefined,
        tab: { id: 5, index: 0, active: true, pinned: false, highlighted: false, incognito: false, selected: false, windowId: 1, discarded: false, autoDiscardable: true, groupId: -1, url: browser.runtime.getURL("/vault.html") },
      });
      expect(mod.isVaultPageSender(sender)).toBe(true);
      expect(runtimeState.session.vaultTabs.has(5)).toBe(true);
    });

    it("returns true for vault URL even without tab.id", () => {
      const sender = makeSender({
        url: browser.runtime.getURL("/vault.html"),
        tab: undefined,
      }) as chrome.runtime.MessageSender;
      // Still returns true (URL matches), but doesn't add to vaultTabs (no tab.id)
      expect(mod.isVaultPageSender(sender)).toBe(true);
    });
  });

  describe("isVaultOrSetupPageSender", () => {
    it("returns true for vault URL", () => {
      const sender = makeSender({
        url: browser.runtime.getURL("/vault.html"),
      });
      expect(mod.isVaultOrSetupPageSender(sender)).toBe(true);
    });

    it("returns true for setup URL", () => {
      const sender = makeSender({
        url: browser.runtime.getURL("/setup.html"),
      });
      expect(mod.isVaultOrSetupPageSender(sender)).toBe(true);
    });

    it("returns false for other URL", () => {
      const sender = makeSender({
        url: "https://example.com",
      });
      expect(mod.isVaultOrSetupPageSender(sender)).toBe(false);
    });

    it("returns false for wrong runtime.id", () => {
      const sender = makeSender({
        id: "wrong-id",
        url: browser.runtime.getURL("/vault.html"),
      });
      expect(mod.isVaultOrSetupPageSender(sender)).toBe(false);
    });

    it("falls back to tab.url when sender.url is undefined", () => {
      const sender = makeSender({
        url: undefined,
        tab: { id: 1, index: 0, active: true, pinned: false, highlighted: false, incognito: false, selected: false, windowId: 1, discarded: false, autoDiscardable: true, groupId: -1, url: browser.runtime.getURL("/vault.html") },
      });
      expect(mod.isVaultOrSetupPageSender(sender)).toBe(true);
    });

    it("returns false when both sender.url and tab.url are undefined", () => {
      const sender = makeSender({
        url: undefined,
        tab: { id: 1, index: 0, active: true, pinned: false, highlighted: false, incognito: false, selected: false, windowId: 1, discarded: false, autoDiscardable: true, groupId: -1 },
      });
      expect(mod.isVaultOrSetupPageSender(sender)).toBe(false);
    });

    it("returns false when sender has no tab", () => {
      const sender = makeSender({
        url: undefined,
        tab: undefined,
      });
      expect(mod.isVaultOrSetupPageSender(sender)).toBe(false);
    });

    it("tracks vault tab ID but not setup tab ID", async () => {
      const { runtimeState } = await import("./state");
      runtimeState.session.vaultTabs.clear();

      const vaultSender = makeSender({
        url: browser.runtime.getURL("/vault.html"),
        tab: { id: 77, index: 0, active: true, pinned: false, highlighted: false, incognito: false, selected: false, windowId: 1, discarded: false, autoDiscardable: true, groupId: -1 },
      });
      mod.isVaultOrSetupPageSender(vaultSender);
      expect(runtimeState.session.vaultTabs.has(77)).toBe(true);

      const setupSender = makeSender({
        url: browser.runtime.getURL("/setup.html"),
        tab: { id: 88, index: 0, active: true, pinned: false, highlighted: false, incognito: false, selected: false, windowId: 1, discarded: false, autoDiscardable: true, groupId: -1 },
      });
      mod.isVaultOrSetupPageSender(setupSender);
      expect(runtimeState.session.vaultTabs.has(88)).toBe(false);
    });
  });

  describe("isTrustedOverlaySender", () => {
    it("returns true for chatgpt URL", () => {
      const sender = makeSender({
        url: "https://chatgpt.com/c/abc",
      });
      expect(mod.isTrustedOverlaySender(sender)).toBe(true);
    });

    it("returns true for claude URL", () => {
      const sender = makeSender({
        url: "https://claude.ai/chat",
      });
      expect(mod.isTrustedOverlaySender(sender)).toBe(true);
    });

    it("returns false for wrong id", () => {
      const sender = makeSender({
        id: "wrong-id",
        url: "https://chatgpt.com/c/abc",
      });
      expect(mod.isTrustedOverlaySender(sender)).toBe(false);
    });

    it("returns false without tab.id", () => {
      const sender = makeSender({
        url: "https://chatgpt.com/c/abc",
        tab: undefined,
      });
      expect(mod.isTrustedOverlaySender(sender)).toBe(false);
    });

    it("returns false with frameId > 0", () => {
      const sender = makeSender({
        url: "https://chatgpt.com/c/abc",
        frameId: 1,
      });
      expect(mod.isTrustedOverlaySender(sender)).toBe(false);
    });

    it("falls back to tab.url when sender.url is undefined", () => {
      const sender = makeSender({
        url: undefined,
        tab: { id: 1, index: 0, active: true, pinned: false, highlighted: false, incognito: false, selected: false, windowId: 1, discarded: false, autoDiscardable: true, groupId: -1, url: "https://chatgpt.com/c/abc" },
      });
      expect(mod.isTrustedOverlaySender(sender)).toBe(true);
    });
  });

  describe("requireVaultSender", () => {
    it("returns null for vault sender", () => {
      const sender = makeSender({
        url: browser.runtime.getURL("/vault.html"),
      });
      expect(mod.requireVaultSender(sender)).toBeNull();
    });

    it("returns error response for non-vault sender", () => {
      const sender = makeSender({
        url: "https://example.com",
      });
      const result = mod.requireVaultSender(sender);
      expect(result).not.toBeNull();
      expect(result!.ok).toBe(false);
    });
  });

  describe("requireVaultOrSetupSender", () => {
    it("returns null for setup sender", () => {
      const sender = makeSender({
        url: browser.runtime.getURL("/setup.html"),
      });
      expect(mod.requireVaultOrSetupSender(sender)).toBeNull();
    });

    it("returns error response for non-vault/setup sender", () => {
      const sender = makeSender({
        url: "https://example.com",
      });
      const result = mod.requireVaultOrSetupSender(sender);
      expect(result).not.toBeNull();
      expect(result!.ok).toBe(false);
    });
  });
});
