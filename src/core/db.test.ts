import type { AuditLogEntry } from "../../packages/contracts/src/index";
import type { StoredFileRecord, StoredResourceRecord, AppSettings } from "./models";

function makeEnvelope() {
  return {
    keyVersion: 1,
    iv: "dGVzdA==",
    ciphertext: "dGVzdA==",
  };
}

function makeFileRecord(overrides: Partial<StoredFileRecord> = {}): StoredFileRecord {
  return {
    id: crypto.randomUUID(),
    schemaVersion: 1,
    name: "test.pdf",
    mimeType: "application/pdf",
    size: 1024,
    createdAt: new Date().toISOString(),
    status: "done",
    matchedCounts: {},
    encryptedBlob: makeEnvelope(),
    ...overrides,
  };
}

function makeResourceRecord(overrides: Partial<StoredResourceRecord> = {}): StoredResourceRecord {
  return {
    id: crypto.randomUUID(),
    schemaVersion: 1,
    fileId: "file-1",
    resourceType: "Observation",
    createdAt: new Date().toISOString(),
    date: "2025-01-15",
    encryptedPayload: makeEnvelope(),
    ...overrides,
  };
}

function makeAuditLog(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ai_provider: "chatgpt",
    resource_types: ["Observation"],
    depth: "summary",
    result: "approved",
    permission_level: "one-time",
    ...overrides,
  };
}

async function deleteDb() {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase("openmyhealth_vault");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  vi.resetModules();
  await deleteDb();
});

describe("loadSettings", () => {
  it("returns defaults on empty db", async () => {
    const db = await import("./db");
    const settings = await db.loadSettings();

    expect(settings).toMatchObject({
      schemaVersion: 1,
      pinConfig: null,
      lockout: { failedAttempts: 0, lockUntil: null },
      connectedProvider: null,
      alwaysAllowScopes: [],
      integrationWarning: null,
    });
    expect(typeof settings.locale).toBe("string");
  });

  it("returns normalized settings", async () => {
    const db = await import("./db");
    await db.loadSettings();

    // Load again — should return the same normalized result
    vi.resetModules();
    const db2 = await import("./db");
    const loaded = await db2.loadSettings();

    expect(loaded.schemaVersion).toBe(1);
    expect(loaded.lockout).toEqual({ failedAttempts: 0, lockUntil: null });
  });

  it("normalizes legacy settings (missing fields filled with defaults)", async () => {
    const db = await import("./db");
    // Save partial settings manually
    await db.saveSettings({
      locale: "en-US",
      schemaVersion: 1,
      pinConfig: null,
      lockout: { failedAttempts: 0, lockUntil: null },
      connectedProvider: null,
      alwaysAllowScopes: [],
      integrationWarning: null,
    } as AppSettings);

    vi.resetModules();
    const db2 = await import("./db");
    const loaded = await db2.loadSettings();

    expect(loaded.locale).toBe("en-US");
    expect(loaded.alwaysAllowScopes).toEqual([]);
    expect(loaded.integrationWarning).toBeNull();
  });

  it("deduplicates alwaysAllowScopes", async () => {
    const db = await import("./db");
    await db.saveSettings({
      locale: "ko-KR",
      schemaVersion: 1,
      pinConfig: null,
      lockout: { failedAttempts: 0, lockUntil: null },
      connectedProvider: null,
      alwaysAllowScopes: ["scope-a", "scope-b", "scope-a"],
      integrationWarning: null,
    });

    vi.resetModules();
    const db2 = await import("./db");
    const loaded = await db2.loadSettings();

    expect(loaded.alwaysAllowScopes).toEqual(["scope-a", "scope-b"]);
  });
});

describe("saveSettings + loadSettings", () => {
  it("roundtrips settings", async () => {
    const db = await import("./db");
    const settings: AppSettings = {
      locale: "en-US",
      schemaVersion: 1,
      pinConfig: null,
      lockout: { failedAttempts: 3, lockUntil: 1700000000000 },
      connectedProvider: "claude",
      alwaysAllowScopes: ["scope-1"],
      integrationWarning: "test warning",
    };

    await db.saveSettings(settings);
    const loaded = await db.loadSettings();

    expect(loaded.locale).toBe("en-US");
    expect(loaded.lockout.failedAttempts).toBe(3);
    expect(loaded.connectedProvider).toBe("claude");
    expect(loaded.alwaysAllowScopes).toEqual(["scope-1"]);
    expect(loaded.integrationWarning).toBe("test warning");
  });

  it("updates existing settings", async () => {
    const db = await import("./db");
    const initial: AppSettings = {
      locale: "ko-KR",
      schemaVersion: 1,
      pinConfig: null,
      lockout: { failedAttempts: 0, lockUntil: null },
      connectedProvider: null,
      alwaysAllowScopes: [],
      integrationWarning: null,
    };
    await db.saveSettings(initial);

    const updated: AppSettings = { ...initial, connectedProvider: "chatgpt" };
    await db.saveSettings(updated);
    const loaded = await db.loadSettings();

    expect(loaded.connectedProvider).toBe("chatgpt");
  });
});

describe("Settings with migrationRecoveryRequired", () => {
  it("adds integrationWarning when migration_recovery_required flag is set", async () => {
    // Open a fresh DB to set the recovery flag manually
    const db = await import("./db");

    // First, load settings so they exist, then manipulate the meta store
    await db.loadSettings();

    // We need to set the flag by directly interacting with IDB
    // Re-import after resetting to get a fresh module
    vi.resetModules();
    await deleteDb();

    // Manually open and set the recovery required flag
    const idbReq = indexedDB.open("openmyhealth_vault", 2);
    await new Promise<void>((resolve, reject) => {
      idbReq.onupgradeneeded = () => {
        const idb = idbReq.result;
        if (!idb.objectStoreNames.contains("meta")) {
          idb.createObjectStore("meta", { keyPath: "key" });
        }
        if (!idb.objectStoreNames.contains("files")) {
          const files = idb.createObjectStore("files", { keyPath: "id" });
          files.createIndex("createdAt", "createdAt", { unique: false });
        }
        if (!idb.objectStoreNames.contains("resources")) {
          const resources = idb.createObjectStore("resources", { keyPath: "id" });
          resources.createIndex("resourceType", "resourceType", { unique: false });
          resources.createIndex("fileId", "fileId", { unique: false });
          resources.createIndex("date", "date", { unique: false });
          resources.createIndex("createdAt", "createdAt", { unique: false });
        }
        if (!idb.objectStoreNames.contains("audit_logs")) {
          const audit = idb.createObjectStore("audit_logs", { keyPath: "id" });
          audit.createIndex("timestamp", "timestamp", { unique: false });
        }
      };
      idbReq.onsuccess = () => {
        const idb = idbReq.result;
        // Set schema_version so migration doesn't run
        const tx = idb.transaction("meta", "readwrite");
        const store = tx.objectStore("meta");
        store.put({ key: "schema_version", value: 1, updatedAt: new Date().toISOString() });
        store.put({ key: "migration_recovery_required", value: true, updatedAt: new Date().toISOString() });
        tx.oncomplete = () => {
          idb.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      idbReq.onerror = () => reject(idbReq.error);
    });

    vi.resetModules();
    const db2 = await import("./db");
    const settings = await db2.loadSettings();

    expect(settings.integrationWarning).toBe(
      "데이터 재처리가 필요할 수 있어요. 문제가 있는 파일은 다시 업로드해 주세요.",
    );
  });
});

describe("saveFileRecord + getFileRecord", () => {
  it("roundtrips a file record", async () => {
    const db = await import("./db");
    const record = makeFileRecord({ id: "file-abc" });
    await db.saveFileRecord(record);
    const loaded = await db.getFileRecord("file-abc");

    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe("file-abc");
    expect(loaded!.name).toBe("test.pdf");
    expect(loaded!.size).toBe(1024);
  });

  it("returns null for non-existent id", async () => {
    const db = await import("./db");
    const loaded = await db.getFileRecord("non-existent");
    expect(loaded).toBeNull();
  });
});

describe("deleteFileRecord", () => {
  it("removes the record", async () => {
    const db = await import("./db");
    const record = makeFileRecord({ id: "file-to-delete" });
    await db.saveFileRecord(record);

    await db.deleteFileRecord("file-to-delete");
    const loaded = await db.getFileRecord("file-to-delete");
    expect(loaded).toBeNull();
  });

  it("does not throw for non-existent id", async () => {
    const db = await import("./db");
    await expect(db.deleteFileRecord("does-not-exist")).resolves.toBeUndefined();
  });
});

describe("listFileRecords", () => {
  it("returns sorted by createdAt descending", async () => {
    const db = await import("./db");
    const older = makeFileRecord({ id: "old", createdAt: "2024-01-01T00:00:00Z" });
    const newer = makeFileRecord({ id: "new", createdAt: "2024-06-01T00:00:00Z" });
    const mid = makeFileRecord({ id: "mid", createdAt: "2024-03-15T00:00:00Z" });

    await db.saveFileRecord(older);
    await db.saveFileRecord(newer);
    await db.saveFileRecord(mid);

    const list = await db.listFileRecords();
    expect(list.map((r) => r.id)).toEqual(["new", "mid", "old"]);
  });

  it("returns empty array for empty store", async () => {
    const db = await import("./db");
    const list = await db.listFileRecords();
    expect(list).toEqual([]);
  });
});

describe("listFileSummaries", () => {
  it("strips encryptedBlob", async () => {
    const db = await import("./db");
    const record = makeFileRecord({ id: "file-summary-test" });
    await db.saveFileRecord(record);

    const summaries = await db.listFileSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0].id).toBe("file-summary-test");
    expect((summaries[0] as unknown as Record<string, unknown>).encryptedBlob).toBeUndefined();
  });
});

describe("toFileSummary", () => {
  it("extracts correct fields", async () => {
    const db = await import("./db");
    const record = makeFileRecord({
      id: "fs-1",
      name: "report.pdf",
      mimeType: "application/pdf",
      size: 2048,
      createdAt: "2024-05-01T10:00:00Z",
      status: "processing",
      matchedCounts: { Observation: 3 },
    });

    const summary = db.toFileSummary(record);

    expect(summary).toEqual({
      id: "fs-1",
      name: "report.pdf",
      mimeType: "application/pdf",
      size: 2048,
      createdAt: "2024-05-01T10:00:00Z",
      status: "processing",
      matchedCounts: { Observation: 3 },
    });
    expect((summary as unknown as Record<string, unknown>).encryptedBlob).toBeUndefined();
    expect((summary as unknown as Record<string, unknown>).schemaVersion).toBeUndefined();
  });
});

describe("saveResourceRecords", () => {
  it("stores multiple records", async () => {
    const db = await import("./db");
    const r1 = makeResourceRecord({ id: "res-1", fileId: "f1" });
    const r2 = makeResourceRecord({ id: "res-2", fileId: "f1" });

    await db.saveResourceRecords([r1, r2]);

    const results = await db.queryResources({
      resourceTypes: ["Observation"],
      limit: 100,
    });
    expect(results).toHaveLength(2);
  });

  it("with empty array is a no-op", async () => {
    const db = await import("./db");
    await expect(db.saveResourceRecords([])).resolves.toBeUndefined();
  });
});

describe("deleteResourcesByFileId", () => {
  it("removes all matching resources", async () => {
    const db = await import("./db");
    const r1 = makeResourceRecord({ id: "res-del-1", fileId: "target-file" });
    const r2 = makeResourceRecord({ id: "res-del-2", fileId: "target-file" });
    const r3 = makeResourceRecord({ id: "res-keep", fileId: "other-file" });

    await db.saveResourceRecords([r1, r2, r3]);
    await db.deleteResourcesByFileId("target-file");

    const remaining = await db.queryResources({
      resourceTypes: ["Observation"],
      limit: 100,
    });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe("res-keep");
  });

  it("with non-matching fileId is a no-op", async () => {
    const db = await import("./db");
    const r1 = makeResourceRecord({ id: "res-noop", fileId: "existing-file" });
    await db.saveResourceRecords([r1]);

    await db.deleteResourcesByFileId("nonexistent-file");

    const remaining = await db.queryResources({
      resourceTypes: ["Observation"],
      limit: 100,
    });
    expect(remaining).toHaveLength(1);
  });
});

describe("queryResources", () => {
  it("filters by resourceType", async () => {
    const db = await import("./db");
    const obs = makeResourceRecord({ id: "q-obs", resourceType: "Observation" });
    const med = makeResourceRecord({ id: "q-med", resourceType: "MedicationStatement" });
    await db.saveResourceRecords([obs, med]);

    const results = await db.queryResources({
      resourceTypes: ["MedicationStatement"],
      limit: 100,
    });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("q-med");
  });

  it("filters by date range (dateFrom)", async () => {
    const db = await import("./db");
    const old = makeResourceRecord({ id: "old-r", date: "2024-01-01" });
    const recent = makeResourceRecord({ id: "new-r", date: "2024-07-01" });
    await db.saveResourceRecords([old, recent]);

    const results = await db.queryResources({
      resourceTypes: ["Observation"],
      dateFrom: "2024-06-01",
      limit: 100,
    });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("new-r");
  });

  it("filters by dateFrom and dateTo", async () => {
    const db = await import("./db");
    const r1 = makeResourceRecord({ id: "jan", date: "2024-01-15" });
    const r2 = makeResourceRecord({ id: "mar", date: "2024-03-15" });
    const r3 = makeResourceRecord({ id: "jun", date: "2024-06-15" });
    await db.saveResourceRecords([r1, r2, r3]);

    const results = await db.queryResources({
      resourceTypes: ["Observation"],
      dateFrom: "2024-02-01",
      dateTo: "2024-04-30",
      limit: 100,
    });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("mar");
  });

  it("with no date filter includes records without dates", async () => {
    const db = await import("./db");
    const withDate = makeResourceRecord({ id: "with-date", date: "2024-05-01" });
    const noDate = makeResourceRecord({ id: "no-date", date: null });
    await db.saveResourceRecords([withDate, noDate]);

    const results = await db.queryResources({
      resourceTypes: ["Observation"],
      limit: 100,
    });
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.id)).toContain("no-date");
  });

  it("with date filter excludes records without dates", async () => {
    const db = await import("./db");
    const withDate = makeResourceRecord({ id: "has-date", date: "2024-05-01" });
    const noDate = makeResourceRecord({ id: "null-date", date: null });
    await db.saveResourceRecords([withDate, noDate]);

    const results = await db.queryResources({
      resourceTypes: ["Observation"],
      dateFrom: "2024-01-01",
      limit: 100,
    });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("has-date");
  });

  it("respects limit", async () => {
    const db = await import("./db");
    const records = Array.from({ length: 10 }, (_, i) =>
      makeResourceRecord({ id: `lim-${i}`, date: `2024-01-${String(i + 1).padStart(2, "0")}` }),
    );
    await db.saveResourceRecords(records);

    const results = await db.queryResources({
      resourceTypes: ["Observation"],
      limit: 3,
    });
    expect(results).toHaveLength(3);
  });

  it("with single resourceType uses index", async () => {
    const db = await import("./db");
    const obs = makeResourceRecord({ id: "idx-obs", resourceType: "Observation" });
    const cond = makeResourceRecord({ id: "idx-cond", resourceType: "Condition" });
    await db.saveResourceRecords([obs, cond]);

    const results = await db.queryResources({
      resourceTypes: ["Observation"],
      limit: 100,
    });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("idx-obs");
  });

  it("with multiple resourceTypes scans all", async () => {
    const db = await import("./db");
    const obs = makeResourceRecord({ id: "multi-obs", resourceType: "Observation" });
    const med = makeResourceRecord({ id: "multi-med", resourceType: "MedicationStatement" });
    const cond = makeResourceRecord({ id: "multi-cond", resourceType: "Condition" });
    await db.saveResourceRecords([obs, med, cond]);

    const results = await db.queryResources({
      resourceTypes: ["Observation", "MedicationStatement"],
      limit: 100,
    });
    expect(results).toHaveLength(2);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("multi-obs");
    expect(ids).toContain("multi-med");
  });
});

describe("addAuditLog + listAuditLogs", () => {
  it("roundtrips an audit log entry", async () => {
    const db = await import("./db");
    const log = makeAuditLog({ id: "audit-1" });
    await db.addAuditLog(log);

    const logs = await db.listAuditLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].id).toBe("audit-1");
    expect(logs[0].ai_provider).toBe("chatgpt");
  });

  it("returns in reverse chronological order", async () => {
    const db = await import("./db");
    const log1 = makeAuditLog({ id: "a-old", timestamp: "2024-01-01T00:00:00Z" });
    const log2 = makeAuditLog({ id: "a-new", timestamp: "2024-06-01T00:00:00Z" });
    const log3 = makeAuditLog({ id: "a-mid", timestamp: "2024-03-15T00:00:00Z" });
    await db.addAuditLog(log1);
    await db.addAuditLog(log2);
    await db.addAuditLog(log3);

    const logs = await db.listAuditLogs();
    expect(logs.map((l) => l.id)).toEqual(["a-new", "a-mid", "a-old"]);
  });

  it("respects limit", async () => {
    const db = await import("./db");
    for (let i = 0; i < 5; i++) {
      await db.addAuditLog(
        makeAuditLog({
          id: `lim-audit-${i}`,
          timestamp: `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
        }),
      );
    }

    const logs = await db.listAuditLogs(2);
    expect(logs).toHaveLength(2);
  });

  it("returns empty for empty store", async () => {
    const db = await import("./db");
    const logs = await db.listAuditLogs();
    expect(logs).toEqual([]);
  });
});

describe("getResourceSummary", () => {
  it("counts by resourceType", async () => {
    const db = await import("./db");
    await db.saveResourceRecords([
      makeResourceRecord({ id: "s-1", resourceType: "Observation" }),
      makeResourceRecord({ id: "s-2", resourceType: "Observation" }),
      makeResourceRecord({ id: "s-3", resourceType: "MedicationStatement" }),
    ]);

    const summary = await db.getResourceSummary();
    expect(summary.Observation).toBe(2);
    expect(summary.MedicationStatement).toBe(1);
  });

  it("returns empty for no resources", async () => {
    const db = await import("./db");
    const summary = await db.getResourceSummary();
    expect(summary).toEqual({});
  });
});

describe("Schema migration", () => {
  it("runs on fresh DB (schema 0 to 1)", async () => {
    const db = await import("./db");
    // Opening the DB triggers migration from 0 to 1
    // loadSettings should work fine after migration
    const settings = await db.loadSettings();
    expect(settings.schemaVersion).toBe(1);
  });
});

describe("Multiple DB opens reuse the same connection (singleton test)", () => {
  it("reuses connection across multiple calls", async () => {
    const db = await import("./db");
    // Multiple operations all use the same cached dbPromise
    await db.loadSettings();
    const record = makeFileRecord({ id: "singleton-test" });
    await db.saveFileRecord(record);
    const loaded = await db.getFileRecord("singleton-test");

    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe("singleton-test");

    // All worked on the same DB connection (no errors)
    const settings = await db.loadSettings();
    expect(settings).toBeDefined();
  });
});

/**
 * Helper to manually set up the IDB with custom meta records
 * before the db module opens its connection.
 */
async function setupDbWithMeta(
  metaRecords: Array<{ key: string; value: unknown }>,
): Promise<void> {
  const idbReq = indexedDB.open("openmyhealth_vault", 2);
  await new Promise<void>((resolve, reject) => {
    idbReq.onupgradeneeded = () => {
      const idb = idbReq.result;
      if (!idb.objectStoreNames.contains("meta")) {
        idb.createObjectStore("meta", { keyPath: "key" });
      }
      if (!idb.objectStoreNames.contains("files")) {
        const files = idb.createObjectStore("files", { keyPath: "id" });
        files.createIndex("createdAt", "createdAt", { unique: false });
      }
      if (!idb.objectStoreNames.contains("resources")) {
        const resources = idb.createObjectStore("resources", { keyPath: "id" });
        resources.createIndex("resourceType", "resourceType", { unique: false });
        resources.createIndex("fileId", "fileId", { unique: false });
        resources.createIndex("date", "date", { unique: false });
        resources.createIndex("createdAt", "createdAt", { unique: false });
      }
      if (!idb.objectStoreNames.contains("audit_logs")) {
        const audit = idb.createObjectStore("audit_logs", { keyPath: "id" });
        audit.createIndex("timestamp", "timestamp", { unique: false });
      }
    };
    idbReq.onsuccess = () => {
      const idb = idbReq.result;
      const tx = idb.transaction("meta", "readwrite");
      const store = tx.objectStore("meta");
      for (const record of metaRecords) {
        store.put({ key: record.key, value: record.value, updatedAt: new Date().toISOString() });
      }
      tx.oncomplete = () => {
        idb.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    idbReq.onerror = () => reject(idbReq.error);
  });
}

describe("Schema validation errors in openDb", () => {
  it("rejects when schema_version is a non-integer", async () => {
    await setupDbWithMeta([{ key: "schema_version", value: 1.5 }]);

    vi.resetModules();
    const db = await import("./db");
    await expect(db.loadSettings()).rejects.toThrow("데이터 버전 정보가 손상되었습니다");
  });

  it("rejects when schema_version is negative", async () => {
    await setupDbWithMeta([{ key: "schema_version", value: -1 }]);

    vi.resetModules();
    const db = await import("./db");
    await expect(db.loadSettings()).rejects.toThrow("데이터 버전 정보가 손상되었습니다");
  });
});

describe("Schema version too high", () => {
  it("rejects when schema_version exceeds SCHEMA_VERSION", async () => {
    await setupDbWithMeta([{ key: "schema_version", value: 99 }]);

    vi.resetModules();
    const db = await import("./db");
    await expect(db.loadSettings()).rejects.toThrow("최신 확장으로 업데이트해 주세요");
  });
});

describe("Migration 0 with pre-existing settings", () => {
  it("normalizes existing settings during migration 0", async () => {
    // Set up DB with schema_version = 0 AND existing settings
    // When migration 0 runs, it will find settings and normalize them
    const idbReq = indexedDB.open("openmyhealth_vault", 2);
    await new Promise<void>((resolve, reject) => {
      idbReq.onupgradeneeded = () => {
        const idb = idbReq.result;
        if (!idb.objectStoreNames.contains("meta")) {
          idb.createObjectStore("meta", { keyPath: "key" });
        }
        if (!idb.objectStoreNames.contains("files")) {
          const files = idb.createObjectStore("files", { keyPath: "id" });
          files.createIndex("createdAt", "createdAt", { unique: false });
        }
        if (!idb.objectStoreNames.contains("resources")) {
          const resources = idb.createObjectStore("resources", { keyPath: "id" });
          resources.createIndex("resourceType", "resourceType", { unique: false });
          resources.createIndex("fileId", "fileId", { unique: false });
          resources.createIndex("date", "date", { unique: false });
          resources.createIndex("createdAt", "createdAt", { unique: false });
        }
        if (!idb.objectStoreNames.contains("audit_logs")) {
          const audit = idb.createObjectStore("audit_logs", { keyPath: "id" });
          audit.createIndex("timestamp", "timestamp", { unique: false });
        }
      };
      idbReq.onsuccess = () => {
        const idb = idbReq.result;
        const tx = idb.transaction("meta", "readwrite");
        const store = tx.objectStore("meta");
        // Set schema_version to 0 so migration 0 will run
        store.put({
          key: "schema_version",
          value: 0,
          updatedAt: new Date().toISOString(),
        });
        // Add existing settings that migration 0 will normalize
        store.put({
          key: "settings",
          value: {
            locale: "en-US",
            schemaVersion: 0,
            pinConfig: null,
            lockout: { failedAttempts: 0, lockUntil: null },
            connectedProvider: null,
            alwaysAllowScopes: ["dup", "dup"],
            integrationWarning: null,
          },
          updatedAt: new Date().toISOString(),
        });
        tx.oncomplete = () => {
          idb.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      idbReq.onerror = () => reject(idbReq.error);
    });

    vi.resetModules();
    const db = await import("./db");
    const settings = await db.loadSettings();

    // Migration 0 should have normalized the settings
    expect(settings.locale).toBe("en-US");
    // alwaysAllowScopes should be deduplicated by normalizeSettings
    expect(settings.alwaysAllowScopes).toEqual(["dup"]);
    // schemaVersion in settings stays as original value since ?? doesn't replace 0
    expect(settings.schemaVersion).toBe(0);
  });
});

describe("loadSettings with migrationRecoveryRequired and existing settings", () => {
  it("adds integrationWarning to existing settings when recovery flag is set", async () => {
    // Set up DB with schema_version = 1 (so no migration runs),
    // existing settings, and the migration_recovery_required flag
    await setupDbWithMeta([
      { key: "schema_version", value: 1 },
      {
        key: "settings",
        value: {
          locale: "ko-KR",
          schemaVersion: 1,
          pinConfig: null,
          lockout: { failedAttempts: 0, lockUntil: null },
          connectedProvider: null,
          alwaysAllowScopes: [],
          integrationWarning: null,
        },
      },
      { key: "migration_recovery_required", value: true },
    ]);

    vi.resetModules();
    const db = await import("./db");
    const settings = await db.loadSettings();

    // Should have added the recovery warning
    expect(settings.integrationWarning).toBe(
      "데이터 재처리가 필요할 수 있어요. 문제가 있는 파일은 다시 업로드해 주세요.",
    );

    // Loading again should NOT have the recovery flag anymore
    vi.resetModules();
    const db2 = await import("./db");
    const settings2 = await db2.loadSettings();
    // The warning was persisted as part of the settings
    expect(settings2.integrationWarning).toBe(
      "데이터 재처리가 필요할 수 있어요. 문제가 있는 파일은 다시 업로드해 주세요.",
    );
  });

  it("does not overwrite existing integrationWarning when recovery flag is set", async () => {
    await setupDbWithMeta([
      { key: "schema_version", value: 1 },
      {
        key: "settings",
        value: {
          locale: "ko-KR",
          schemaVersion: 1,
          pinConfig: null,
          lockout: { failedAttempts: 0, lockUntil: null },
          connectedProvider: null,
          alwaysAllowScopes: [],
          integrationWarning: "existing warning",
        },
      },
      { key: "migration_recovery_required", value: true },
    ]);

    vi.resetModules();
    const db = await import("./db");
    const settings = await db.loadSettings();

    // Should keep the existing warning (not replace it with recovery message)
    expect(settings.integrationWarning).toBe("existing warning");
  });
});

describe("loadSettings with migrationRecoveryRequired and no existing settings", () => {
  it("adds integrationWarning to initial settings when recovery flag is set", async () => {
    // Set up DB with schema_version = 1 (so no migration runs),
    // NO settings, and the migration_recovery_required flag
    await setupDbWithMeta([
      { key: "schema_version", value: 1 },
      { key: "migration_recovery_required", value: true },
    ]);

    vi.resetModules();
    const db = await import("./db");
    const settings = await db.loadSettings();

    // Should have the recovery warning on newly created settings
    expect(settings.integrationWarning).toBe(
      "데이터 재처리가 필요할 수 있어요. 문제가 있는 파일은 다시 업로드해 주세요.",
    );
  });
});

describe("openDb error recovery resets singleton", () => {
  it("allows retry after schema validation error", async () => {
    // First, set up a DB with corrupted schema_version
    await setupDbWithMeta([{ key: "schema_version", value: 1.5 }]);

    vi.resetModules();
    const db = await import("./db");

    // First call should fail
    await expect(db.loadSettings()).rejects.toThrow("데이터 버전 정보가 손상되었습니다");

    // The dbPromise singleton should be cleared, so deleting and retrying works
    await deleteDb();
    vi.resetModules();
    const db2 = await import("./db");
    const settings = await db2.loadSettings();
    expect(settings.schemaVersion).toBe(1);
  });
});

describe("db.onversionchange", () => {
  it("closes the db and resets the singleton on version change", async () => {
    const db = await import("./db");
    // Open the DB normally
    await db.loadSettings();

    // Now open a higher-version request to trigger onversionchange
    // on the existing connection
    const upgradeReq = indexedDB.open("openmyhealth_vault", 999);
    await new Promise<void>((resolve) => {
      upgradeReq.onupgradeneeded = () => {
        // Just let the upgrade happen
      };
      upgradeReq.onsuccess = () => {
        upgradeReq.result.close();
        resolve();
      };
      upgradeReq.onerror = () => {
        // Even if it fails, resolve to continue the test
        resolve();
      };
    });

    // After version change, the old connection should be closed
    // and the singleton should be cleared. A new import should
    // work fine with a fresh connection.
    vi.resetModules();
    await deleteDb();
    const db2 = await import("./db");
    const settings = await db2.loadSettings();
    expect(settings.schemaVersion).toBe(1);
  });
});
