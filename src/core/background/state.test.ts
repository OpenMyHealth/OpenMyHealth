describe("state module", () => {
  let mod: typeof import("@/core/background/state");

  beforeEach(async () => {
    vi.resetModules();
    mod = await import("./state");
  });

  describe("runtimeState initial values", () => {
    it("has session.isUnlocked false", () => {
      expect(mod.runtimeState.session.isUnlocked).toBe(false);
    });

    it("has empty queue", () => {
      expect(mod.runtimeState.queue).toEqual([]);
    });

    it("has empty approvals map", () => {
      expect(mod.runtimeState.approvals).toBeInstanceOf(Map);
      expect(mod.runtimeState.approvals.size).toBe(0);
    });

    it("has null currentRequestId", () => {
      expect(mod.runtimeState.currentRequestId).toBeNull();
    });

    it("has session.key as null", () => {
      expect(mod.runtimeState.session.key).toBeNull();
    });

    it("has session.isLocking as false", () => {
      expect(mod.runtimeState.session.isLocking).toBe(false);
    });

    it("has session.vaultTabs as a Set", () => {
      expect(mod.runtimeState.session.vaultTabs).toBeInstanceOf(Set);
      expect(mod.runtimeState.session.vaultTabs.size).toBe(0);
    });
  });

  describe("getSettingsCache / setSettingsCache", () => {
    it("returns null initially", () => {
      expect(mod.getSettingsCache()).toBeNull();
    });

    it("roundtrips a value", () => {
      const settings = {
        locale: "en",
        schemaVersion: 1,
        pinConfig: null,
        lockout: { failedAttempts: 0, lockUntil: null },
        connectedProvider: null,
        alwaysAllowScopes: [],
        integrationWarning: null,
      } as import("@/core/models").AppSettings;

      mod.setSettingsCache(settings);
      expect(mod.getSettingsCache()).toBe(settings);
    });
  });

  describe("getUnlockInFlight / setUnlockInFlight", () => {
    it("returns a resolved promise initially", async () => {
      const result = mod.getUnlockInFlight();
      expect(result).toBeInstanceOf(Promise);
      await expect(result).resolves.toBeUndefined();
    });

    it("stores a new promise", () => {
      const p = new Promise(() => {});
      mod.setUnlockInFlight(p);
      expect(mod.getUnlockInFlight()).toBe(p);
    });
  });

  describe("getBackgroundInitPromise / setBackgroundInitPromise", () => {
    it("returns null initially", () => {
      expect(mod.getBackgroundInitPromise()).toBeNull();
    });

    it("stores a value", () => {
      const p = Promise.resolve();
      mod.setBackgroundInitPromise(p);
      expect(mod.getBackgroundInitPromise()).toBe(p);
    });
  });

  describe("nowIso", () => {
    it("returns a valid ISO string", () => {
      const iso = mod.nowIso();
      expect(typeof iso).toBe("string");
      const parsed = new Date(iso);
      expect(parsed.toISOString()).toBe(iso);
    });
  });

  describe("constants", () => {
    it("APPROVAL_STATE_STORAGE_KEY is correct", () => {
      expect(mod.APPROVAL_STATE_STORAGE_KEY).toBe("pending-approvals-v1");
    });

    it("REQUEST_RATE_WINDOW_MS is 30000", () => {
      expect(mod.REQUEST_RATE_WINDOW_MS).toBe(30_000);
    });

    it("REQUEST_RATE_MAX_PER_WINDOW is 8", () => {
      expect(mod.REQUEST_RATE_MAX_PER_WINDOW).toBe(8);
    });
  });
});
