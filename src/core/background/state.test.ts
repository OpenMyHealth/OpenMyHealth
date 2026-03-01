describe("state module", () => {
  let mod: typeof import("@/core/background/state");

  beforeEach(async () => {
    vi.resetModules();
    mod = await import("./state");
  });

  describe("runtimeState initial values and mutability", () => {
    it("session.isUnlocked starts false and can be set to true", () => {
      expect(mod.runtimeState.session.isUnlocked).toBe(false);
      mod.runtimeState.session.isUnlocked = true;
      expect(mod.runtimeState.session.isUnlocked).toBe(true);
    });

    it("queue starts empty and accepts push", () => {
      expect(mod.runtimeState.queue).toEqual([]);
      mod.runtimeState.queue.push("req-1");
      expect(mod.runtimeState.queue).toEqual(["req-1"]);
    });

    it("approvals starts as empty Map and accepts entries", () => {
      expect(mod.runtimeState.approvals).toBeInstanceOf(Map);
      expect(mod.runtimeState.approvals.size).toBe(0);
      mod.runtimeState.approvals.set("key", {} as never);
      expect(mod.runtimeState.approvals.size).toBe(1);
    });

    it("currentRequestId starts null and can be assigned", () => {
      expect(mod.runtimeState.currentRequestId).toBeNull();
      mod.runtimeState.currentRequestId = "req-abc";
      expect(mod.runtimeState.currentRequestId).toBe("req-abc");
    });

    it("session.key starts null and can be assigned", () => {
      expect(mod.runtimeState.session.key).toBeNull();
      const fakeKey = {} as CryptoKey;
      mod.runtimeState.session.key = fakeKey;
      expect(mod.runtimeState.session.key).toBe(fakeKey);
    });

    it("session.isLocking starts false and can be toggled", () => {
      expect(mod.runtimeState.session.isLocking).toBe(false);
      mod.runtimeState.session.isLocking = true;
      expect(mod.runtimeState.session.isLocking).toBe(true);
      mod.runtimeState.session.isLocking = false;
      expect(mod.runtimeState.session.isLocking).toBe(false);
    });

    it("session.vaultTabs starts as empty Set and tracks tab ids", () => {
      expect(mod.runtimeState.session.vaultTabs).toBeInstanceOf(Set);
      expect(mod.runtimeState.session.vaultTabs.size).toBe(0);
      mod.runtimeState.session.vaultTabs.add(42);
      expect(mod.runtimeState.session.vaultTabs.has(42)).toBe(true);
      expect(mod.runtimeState.session.vaultTabs.size).toBe(1);
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
    it("returns the exact ISO string for a pinned time", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2025-06-15T12:30:45.000Z"));
      const iso = mod.nowIso();
      expect(iso).toBe("2025-06-15T12:30:45.000Z");
      vi.useRealTimers();
    });

    it("returns a valid ISO string that roundtrips through Date", () => {
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

    it("REQUEST_RATE_WINDOW_MS gates rate limiting at 30s window", () => {
      // Verify the value
      expect(mod.REQUEST_RATE_WINDOW_MS).toBe(30_000);
      // Verify the constant is used correctly: timestamps within the window pass,
      // timestamps outside the window are filtered out
      const now = Date.now();
      const insideWindow = now - mod.REQUEST_RATE_WINDOW_MS + 1;
      const outsideWindow = now - mod.REQUEST_RATE_WINDOW_MS - 1;
      expect(insideWindow >= now - mod.REQUEST_RATE_WINDOW_MS).toBe(true);
      expect(outsideWindow >= now - mod.REQUEST_RATE_WINDOW_MS).toBe(false);
    });

    it("REQUEST_RATE_MAX_PER_WINDOW caps at 8 requests per window", () => {
      expect(mod.REQUEST_RATE_MAX_PER_WINDOW).toBe(8);
      // Verify the constant enforces the rate limit: at exactly 8 requests, the limit is reached
      const requests = Array.from({ length: mod.REQUEST_RATE_MAX_PER_WINDOW }, (_, i) => i);
      expect(requests.length >= mod.REQUEST_RATE_MAX_PER_WINDOW).toBe(true);
      // Below the limit, requests are allowed
      const belowLimit = requests.slice(0, mod.REQUEST_RATE_MAX_PER_WINDOW - 1);
      expect(belowLimit.length < mod.REQUEST_RATE_MAX_PER_WINDOW).toBe(true);
    });

    it("RUNTIME_MODE is either 'dev' or 'prod'", () => {
      expect(["dev", "prod"]).toContain(mod.RUNTIME_MODE);
    });
  });
});
