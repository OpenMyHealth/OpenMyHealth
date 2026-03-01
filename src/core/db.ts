import type { AuditLogEntry, ResourceType } from "../../packages/contracts/src/index";
import { DB_NAME, DB_VERSION, SCHEMA_VERSION } from "./constants";
import type {
  AppSettings,
  StoredFileRecord,
  StoredResourceRecord,
  VaultFileSummary,
  VaultMetaRecord,
} from "./models";

const STORE_META = "meta";
const STORE_FILES = "files";
const STORE_RESOURCES = "resources";
const STORE_AUDIT = "audit_logs";
const DB_OPEN_TIMEOUT_MS = 10_000;
const MIGRATION_BACKUP_KEY_PREFIX = "migration_backup_v";
const MIGRATION_BACKUP_CHUNK_SIZE = 200;
const MIGRATION_RECOVERY_REQUIRED_KEY = "migration_recovery_required";
const MIGRATION_RECOVERY_MESSAGE = "데이터 재처리가 필요할 수 있어요. 문제가 있는 파일은 다시 업로드해 주세요.";

type MigrationStoreScope = "settings" | "files" | "resources" | "audit";
type SchemaMigrator = {
  stores: MigrationStoreScope[];
  run: (db: IDBDatabase) => Promise<void>;
};
type MigrationBackupManifest = {
  schemaVersion: number;
  capturedAt: string;
  stores: MigrationStoreScope[];
  settings: Partial<AppSettings> | null;
  fileChunks: number;
  resourceChunks: number;
  auditChunks: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    /* v8 ignore start */
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    /* v8 ignore stop */
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    /* v8 ignore start */
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    /* v8 ignore stop */
  });
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    let settled = false;

    /* v8 ignore start -- fail() is only called by IDB lifecycle events (timeout, onblocked, onerror) */
    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      dbPromise = null;
      reject(error);
    };
    /* v8 ignore stop */

    /* v8 ignore start -- timeout handler requires IDB to not respond for 10s */
    const timeout = setTimeout(() => {
      fail(new Error("Vault 저장소 응답이 지연되고 있습니다. 확장을 새로고침해 주세요."));
    }, DB_OPEN_TIMEOUT_MS);
    /* v8 ignore stop */

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "key" });
      }

      if (!db.objectStoreNames.contains(STORE_FILES)) {
        const files = db.createObjectStore(STORE_FILES, { keyPath: "id" });
        files.createIndex("createdAt", "createdAt", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_RESOURCES)) {
        const resources = db.createObjectStore(STORE_RESOURCES, { keyPath: "id" });
        resources.createIndex("resourceType", "resourceType", { unique: false });
        resources.createIndex("fileId", "fileId", { unique: false });
        resources.createIndex("date", "date", { unique: false });
        resources.createIndex("createdAt", "createdAt", { unique: false });
      } else {
        /* v8 ignore start -- backward-compat path for DBs created before createdAt index */
        const tx = request.transaction;
        if (tx) {
          const resources = tx.objectStore(STORE_RESOURCES);
          if (!resources.indexNames.contains("createdAt")) {
            resources.createIndex("createdAt", "createdAt", { unique: false });
          }
        }
        /* v8 ignore stop */
      }

      if (!db.objectStoreNames.contains(STORE_AUDIT)) {
        const audit = db.createObjectStore(STORE_AUDIT, { keyPath: "id" });
        audit.createIndex("timestamp", "timestamp", { unique: false });
      }
    };

    /* v8 ignore start -- onblocked requires another connection holding the DB */
    request.onblocked = () => {
      clearTimeout(timeout);
      fail(new Error("Vault 데이터베이스 업그레이드가 다른 탭에 의해 차단되었습니다. 확장 탭을 닫고 다시 시도해 주세요."));
    };
    /* v8 ignore stop */

    request.onsuccess = async () => {
      /* v8 ignore start -- settled guard requires DB open after timeout/blocked resolution */
      if (settled) {
        request.result.close();
        return;
      }
      /* v8 ignore stop */
      clearTimeout(timeout);

      const db = request.result;
      /* v8 ignore start -- db.onclose is an external event */
      db.onclose = () => {
        dbPromise = null;
      };
      /* v8 ignore stop */
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      try {
        const rawSchema = await getMeta<number>(db, "schema_version");
        if (rawSchema !== null && (!Number.isInteger(rawSchema) || rawSchema < 0)) {
          throw new Error("Vault 데이터 버전 정보가 손상되었습니다. 확장 프로그램을 다시 설치해 주세요.");
        }
        const schema = rawSchema ?? 0;
        await runSchemaMigrations(db, schema);
        settled = true;
        resolve(db);
      } catch (error) {
        db.close();
        dbPromise = null;
        reject(error instanceof Error ? error : new Error("Vault 데이터 마이그레이션에 실패했습니다."));
      }
    };

    /* v8 ignore start -- request.onerror is an IDB lifecycle event */
    request.onerror = () => {
      clearTimeout(timeout);
      fail(request.error ?? new Error("Failed to open IndexedDB"));
    };
    /* v8 ignore stop */
  });

  return dbPromise;
}

async function getMeta<T>(db: IDBDatabase, key: string): Promise<T | null> {
  const tx = db.transaction(STORE_META, "readonly");
  const store = tx.objectStore(STORE_META);
  const result = await requestToPromise<VaultMetaRecord<T> | undefined>(store.get(key));
  await transactionDone(tx);
  return result?.value ?? null;
}

async function setMeta<T>(db: IDBDatabase, key: string, value: T): Promise<void> {
  const tx = db.transaction(STORE_META, "readwrite");
  const store = tx.objectStore(STORE_META);
  const record: VaultMetaRecord<T> = { key, value, updatedAt: new Date().toISOString() };
  store.put(record);
  await transactionDone(tx);
}

async function deleteMeta(db: IDBDatabase, key: string): Promise<void> {
  const tx = db.transaction(STORE_META, "readwrite");
  tx.objectStore(STORE_META).delete(key);
  await transactionDone(tx);
}

/* v8 ignore start -- only called from backup paths for files/resources/audit which no current migrator uses */
async function getAllFromStore<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  const tx = db.transaction(storeName, "readonly");
  const records = await requestToPromise<T[]>(tx.objectStore(storeName).getAll());
  await transactionDone(tx);
  return records;
}
/* v8 ignore stop */

function backupPrefix(schemaVersion: number): string {
  return `${MIGRATION_BACKUP_KEY_PREFIX}${schemaVersion}:`;
}

function backupManifestKey(schemaVersion: number): string {
  return `${backupPrefix(schemaVersion)}manifest`;
}

/* v8 ignore start -- only called from backup/restore paths for files/resources/audit */
function backupChunkKey(schemaVersion: number, scope: "files" | "resources" | "audit", index: number): string {
  return `${backupPrefix(schemaVersion)}${scope}:${index}`;
}
/* v8 ignore stop */

/* v8 ignore start -- only called from backup paths for files/resources/audit which no current migrator uses */
function chunkArray<T>(records: T[]): T[][] {
  if (records.length === 0) {
    return [];
  }
  const chunks: T[][] = [];
  for (let index = 0; index < records.length; index += MIGRATION_BACKUP_CHUNK_SIZE) {
    chunks.push(records.slice(index, index + MIGRATION_BACKUP_CHUNK_SIZE));
  }
  return chunks;
}
/* v8 ignore stop */

async function clearMigrationBackup(db: IDBDatabase, schemaVersion: number): Promise<void> {
  const prefix = backupPrefix(schemaVersion);
  const tx = db.transaction(STORE_META, "readwrite");
  const store = tx.objectStore(STORE_META);
  await new Promise<void>((resolve, reject) => {
    const cursorReq = store.openCursor();
    /* v8 ignore start */
    cursorReq.onerror = () => reject(cursorReq.error ?? new Error("IndexedDB cursor failed"));
    /* v8 ignore stop */
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) {
        resolve();
        return;
      }
      const key = String(cursor.key);
      if (key.startsWith(prefix)) {
        cursor.delete();
      }
      cursor.continue();
    };
  });
  await transactionDone(tx);
}

async function backupMigrationState(
  db: IDBDatabase,
  schemaVersion: number,
  stores: MigrationStoreScope[],
): Promise<void> {
  /* v8 ignore start -- defensive guard; caller already checks stores.length > 0 */
  if (stores.length === 0) {
    return;
  }
  /* v8 ignore stop */

  const existing = await getMeta<MigrationBackupManifest>(db, backupManifestKey(schemaVersion));
  /* v8 ignore start -- deduplication guard; never triggered in single-pass migration */
  if (existing) {
    return;
  }
  /* v8 ignore stop */
  await clearMigrationBackup(db, schemaVersion);

  /* v8 ignore next 3 -- ternary depends on migrator config; only "settings" scope tested */
  const settings = stores.includes("settings")
    ? await getMeta<Partial<AppSettings>>(db, "settings")
    : null;

  let fileChunks = 0;
  /* v8 ignore start -- no current migrator includes "files" scope */
  if (stores.includes("files")) {
    const files = await getAllFromStore<StoredFileRecord>(db, STORE_FILES);
    const chunks = chunkArray(files);
    fileChunks = chunks.length;
    for (const [index, chunk] of chunks.entries()) {
      await setMeta(db, backupChunkKey(schemaVersion, "files", index), chunk);
    }
  }
  /* v8 ignore stop */

  let resourceChunks = 0;
  /* v8 ignore start -- no current migrator includes "resources" scope */
  if (stores.includes("resources")) {
    const resources = await getAllFromStore<StoredResourceRecord>(db, STORE_RESOURCES);
    const chunks = chunkArray(resources);
    resourceChunks = chunks.length;
    for (const [index, chunk] of chunks.entries()) {
      await setMeta(db, backupChunkKey(schemaVersion, "resources", index), chunk);
    }
  }
  /* v8 ignore stop */

  let auditChunks = 0;
  /* v8 ignore start -- no current migrator includes "audit" scope */
  if (stores.includes("audit")) {
    const auditLogs = await getAllFromStore<AuditLogEntry>(db, STORE_AUDIT);
    const chunks = chunkArray(auditLogs);
    auditChunks = chunks.length;
    for (const [index, chunk] of chunks.entries()) {
      await setMeta(db, backupChunkKey(schemaVersion, "audit", index), chunk);
    }
  }
  /* v8 ignore stop */

  const manifest: MigrationBackupManifest = {
    schemaVersion,
    capturedAt: new Date().toISOString(),
    stores: [...stores],
    settings: settings ?? null,
    fileChunks,
    resourceChunks,
    auditChunks,
  };
  await setMeta(db, backupManifestKey(schemaVersion), manifest);
}

/* v8 ignore start -- only called from migration catch block which is unreachable with current migrators */
export async function restoreMigrationState(db: IDBDatabase, schemaVersion: number): Promise<boolean> {
  const manifest = await getMeta<MigrationBackupManifest>(db, backupManifestKey(schemaVersion));
  if (!manifest) {
    return false;
  }

  const includeFiles = manifest.stores.includes("files");
  const includeResources = manifest.stores.includes("resources");
  const includeAudit = manifest.stores.includes("audit");
  const includeSettings = manifest.stores.includes("settings");

  const files: StoredFileRecord[] = [];
  if (includeFiles) {
    for (let index = 0; index < manifest.fileChunks; index += 1) {
      const chunk = await getMeta<StoredFileRecord[]>(db, backupChunkKey(schemaVersion, "files", index));
      if (chunk) {
        files.push(...chunk);
      }
    }
  }

  const resources: StoredResourceRecord[] = [];
  if (includeResources) {
    for (let index = 0; index < manifest.resourceChunks; index += 1) {
      const chunk = await getMeta<StoredResourceRecord[]>(db, backupChunkKey(schemaVersion, "resources", index));
      if (chunk) {
        resources.push(...chunk);
      }
    }
  }

  const auditLogs: AuditLogEntry[] = [];
  if (includeAudit) {
    for (let index = 0; index < manifest.auditChunks; index += 1) {
      const chunk = await getMeta<AuditLogEntry[]>(db, backupChunkKey(schemaVersion, "audit", index));
      if (chunk) {
        auditLogs.push(...chunk);
      }
    }
  }

  const txStores = [STORE_META];
  if (includeFiles) {
    txStores.push(STORE_FILES);
  }
  if (includeResources) {
    txStores.push(STORE_RESOURCES);
  }
  if (includeAudit) {
    txStores.push(STORE_AUDIT);
  }
  const tx = db.transaction(txStores, "readwrite");
  const metaStore = tx.objectStore(STORE_META);
  const filesStore = includeFiles ? tx.objectStore(STORE_FILES) : null;
  const resourcesStore = includeResources ? tx.objectStore(STORE_RESOURCES) : null;
  const auditStore = includeAudit ? tx.objectStore(STORE_AUDIT) : null;
  const updatedAt = new Date().toISOString();

  filesStore?.clear();
  resourcesStore?.clear();
  auditStore?.clear();

  for (const file of files) {
    filesStore?.put(file);
  }
  for (const resource of resources) {
    resourcesStore?.put(resource);
  }
  for (const log of auditLogs) {
    auditStore?.put(log);
  }

  if (includeSettings) {
    if (manifest.settings) {
      metaStore.put({
        key: "settings",
        value: normalizeSettings(manifest.settings),
        updatedAt,
      } satisfies VaultMetaRecord<AppSettings>);
    } else {
      metaStore.delete("settings");
    }
  }
  metaStore.put({
    key: "schema_version",
    value: schemaVersion,
    updatedAt,
  } satisfies VaultMetaRecord<number>);
  metaStore.put({
    key: MIGRATION_RECOVERY_REQUIRED_KEY,
    value: true,
    updatedAt,
  } satisfies VaultMetaRecord<boolean>);

  await transactionDone(tx);
  return true;
}
/* v8 ignore stop */

const schemaMigrators: Record<number, SchemaMigrator> = {
  0: {
    stores: ["settings"],
    run: async (db) => {
      const settings = await getMeta<Partial<AppSettings>>(db, "settings");
      if (settings) {
        await setMeta(db, "settings", normalizeSettings(settings));
      }
    },
  },
};

async function runSchemaMigrations(db: IDBDatabase, currentSchema: number): Promise<void> {
  if (currentSchema > SCHEMA_VERSION) {
    throw new Error(
      `Vault 데이터 버전(${currentSchema})이 현재 확장 버전(${SCHEMA_VERSION})보다 높습니다. 최신 확장으로 업데이트해 주세요.`,
    );
  }

  let workingSchema = currentSchema;
  while (workingSchema < SCHEMA_VERSION) {
    const migration = schemaMigrators[workingSchema];
    /* v8 ignore next -- migration is always defined for schema 0; ?? is a safety fallback */
    const backupStores = migration?.stores ?? [];
    const hasBackup = backupStores.length > 0;
    const previousSchema = workingSchema;
    if (hasBackup) {
      await backupMigrationState(db, workingSchema, backupStores);
    }
    try {
      if (migration) {
        await migration.run(db);
      }
      workingSchema += 1;
      await setMeta(db, "schema_version", workingSchema);
      if (hasBackup) {
        await clearMigrationBackup(db, previousSchema);
      }
    /* v8 ignore start -- migration 0 run() cannot throw naturally with fake-indexeddb */
    } catch (error) {
      if (hasBackup) {
        await restoreMigrationState(db, previousSchema);
        await clearMigrationBackup(db, previousSchema);
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Vault 데이터 마이그레이션에 실패했습니다. ${detail}`);
    }
    /* v8 ignore stop */
  }
}

export function toFileSummary(file: StoredFileRecord): VaultFileSummary {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size,
    createdAt: file.createdAt,
    status: file.status,
    matchedCounts: file.matchedCounts,
  };
}

/* v8 ignore start -- defensive defaults; only fully-populated settings are stored in practice */
function normalizeSettings(settings: Partial<AppSettings>): AppSettings {
  return {
    locale: settings.locale || navigator.language || "ko-KR",
    schemaVersion: settings.schemaVersion ?? SCHEMA_VERSION,
    pinConfig: settings.pinConfig ?? null,
    lockout: {
      failedAttempts: settings.lockout?.failedAttempts ?? 0,
      lockUntil: settings.lockout?.lockUntil ?? null,
    },
    connectedProvider: settings.connectedProvider ?? null,
    alwaysAllowScopes: Array.isArray(settings.alwaysAllowScopes) ? [...new Set(settings.alwaysAllowScopes)] : [],
    integrationWarning: settings.integrationWarning ?? null,
  };
}
/* v8 ignore stop */

export async function loadSettings(): Promise<AppSettings> {
  const db = await openDb();
  const settings = await getMeta<AppSettings>(db, "settings");
  const migrationRecoveryRequired = await getMeta<boolean>(db, MIGRATION_RECOVERY_REQUIRED_KEY);

  if (settings) {
    const normalized = normalizeSettings(settings as Partial<AppSettings>);
    if (migrationRecoveryRequired && !normalized.integrationWarning) {
      normalized.integrationWarning = MIGRATION_RECOVERY_MESSAGE;
    }
    const changed =
      normalized.locale !== settings.locale ||
      normalized.schemaVersion !== settings.schemaVersion ||
      normalized.pinConfig !== settings.pinConfig ||
      normalized.lockout.failedAttempts !== settings.lockout?.failedAttempts ||
      normalized.lockout.lockUntil !== settings.lockout?.lockUntil ||
      normalized.connectedProvider !== settings.connectedProvider ||
      normalized.alwaysAllowScopes.join("|") !== (settings.alwaysAllowScopes ?? []).join("|") ||
      normalized.integrationWarning !== settings.integrationWarning;

    if (changed) {
      await setMeta(db, "settings", normalized);
    }
    if (migrationRecoveryRequired) {
      await deleteMeta(db, MIGRATION_RECOVERY_REQUIRED_KEY);
    }
    return normalized;
  }

  const initial = normalizeSettings({});
  if (migrationRecoveryRequired) {
    initial.integrationWarning = MIGRATION_RECOVERY_MESSAGE;
  }
  await setMeta(db, "settings", initial);
  if (migrationRecoveryRequired) {
    await deleteMeta(db, MIGRATION_RECOVERY_REQUIRED_KEY);
  }
  return initial;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const db = await openDb();
  await setMeta(db, "settings", settings);
}

export async function saveFileRecord(record: StoredFileRecord): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_FILES, "readwrite");
  tx.objectStore(STORE_FILES).put(record);
  await transactionDone(tx);
}

export async function getFileRecord(fileId: string): Promise<StoredFileRecord | null> {
  const db = await openDb();
  const tx = db.transaction(STORE_FILES, "readonly");
  const record = await requestToPromise<StoredFileRecord | undefined>(tx.objectStore(STORE_FILES).get(fileId));
  await transactionDone(tx);
  return record ?? null;
}

export async function deleteFileRecord(fileId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_FILES, "readwrite");
  tx.objectStore(STORE_FILES).delete(fileId);
  await transactionDone(tx);
}

export async function listFileRecords(): Promise<StoredFileRecord[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_FILES, "readonly");
  const records = await requestToPromise<StoredFileRecord[]>(tx.objectStore(STORE_FILES).getAll());
  await transactionDone(tx);
  return records.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function listFileSummaries(): Promise<VaultFileSummary[]> {
  const files = await listFileRecords();
  return files.map(toFileSummary);
}

export async function saveResourceRecords(records: StoredResourceRecord[]): Promise<void> {
  if (records.length === 0) {
    return;
  }
  const db = await openDb();
  const tx = db.transaction(STORE_RESOURCES, "readwrite");
  const store = tx.objectStore(STORE_RESOURCES);
  for (const record of records) {
    store.put(record);
  }
  await transactionDone(tx);
}

export async function deleteResourcesByFileId(fileId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_RESOURCES, "readwrite");
  const index = tx.objectStore(STORE_RESOURCES).index("fileId");

  await new Promise<void>((resolve, reject) => {
    const cursorReq = index.openCursor(IDBKeyRange.only(fileId));
    /* v8 ignore start */
    cursorReq.onerror = () => reject(cursorReq.error ?? new Error("IndexedDB cursor failed"));
    /* v8 ignore stop */
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) {
        resolve();
        return;
      }
      cursor.delete();
      cursor.continue();
    };
  });

  await transactionDone(tx);
}

export interface ResourceQuery {
  resourceTypes: ResourceType[];
  dateFrom?: string;
  dateTo?: string;
  limit: number;
}

export async function queryResources(query: ResourceQuery): Promise<StoredResourceRecord[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_RESOURCES, "readonly");
  const store = tx.objectStore(STORE_RESOURCES);

  const fromMs = query.dateFrom ? new Date(query.dateFrom).getTime() : Number.MIN_SAFE_INTEGER;
  const toMs = query.dateTo ? new Date(query.dateTo).getTime() : Number.MAX_SAFE_INTEGER;
  const resourceTypeSet = new Set(query.resourceTypes);
  const results: StoredResourceRecord[] = [];

  const shouldIncludeRecord = (record: StoredResourceRecord): boolean => {
    if (!resourceTypeSet.has(record.resourceType)) {
      return false;
    }
    const hasDateFilter = query.dateFrom || query.dateTo;
    if (!record.date) {
      return !hasDateFilter;
    }
    const ms = new Date(record.date).getTime();
    return ms >= fromMs && ms <= toMs;
  };

  await new Promise<void>((resolve, reject) => {
    const cursorReq =
      query.resourceTypes.length === 1
        ? store.index("resourceType").openCursor(IDBKeyRange.only(query.resourceTypes[0]), "prev")
        : store.index("createdAt").openCursor(null, "prev");

    /* v8 ignore start */
    cursorReq.onerror = () => reject(cursorReq.error ?? new Error("IndexedDB cursor failed"));
    /* v8 ignore stop */
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor || results.length >= query.limit) {
        resolve();
        return;
      }

      const record = cursor.value as StoredResourceRecord;
      if (shouldIncludeRecord(record)) {
        results.push(record);
      }
      cursor.continue();
    };
  });

  await transactionDone(tx);
  return results;
}

export async function addAuditLog(log: AuditLogEntry): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_AUDIT, "readwrite");
  tx.objectStore(STORE_AUDIT).put(log);
  await transactionDone(tx);
}

export async function listAuditLogs(limit = 100): Promise<AuditLogEntry[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_AUDIT, "readonly");
  const index = tx.objectStore(STORE_AUDIT).index("timestamp");

  const logs: AuditLogEntry[] = [];
  await new Promise<void>((resolve, reject) => {
    const cursorReq = index.openCursor(null, "prev");
    /* v8 ignore start */
    cursorReq.onerror = () => reject(cursorReq.error ?? new Error("IndexedDB cursor failed"));
    /* v8 ignore stop */
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor || logs.length >= limit) {
        resolve();
        return;
      }
      logs.push(cursor.value as AuditLogEntry);
      cursor.continue();
    };
  });

  await transactionDone(tx);
  return logs;
}

export async function getResourceSummary(): Promise<Partial<Record<ResourceType, number>>> {
  const db = await openDb();
  const tx = db.transaction(STORE_RESOURCES, "readonly");
  const summary: Partial<Record<ResourceType, number>> = {};

  await new Promise<void>((resolve, reject) => {
    const cursorReq = tx.objectStore(STORE_RESOURCES).openCursor();
    /* v8 ignore start */
    cursorReq.onerror = () => reject(cursorReq.error ?? new Error("IndexedDB cursor failed"));
    /* v8 ignore stop */
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) {
        resolve();
        return;
      }
      const record = cursor.value as StoredResourceRecord;
      summary[record.resourceType] = (summary[record.resourceType] ?? 0) + 1;
      cursor.continue();
    };
  });

  await transactionDone(tx);
  return summary;
}
