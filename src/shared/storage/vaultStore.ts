import { STORAGE_KEYS, VAULT_VERSION } from "../constants";
import type { NormalizedRecord, SourceSyncState, TransferAudit, VaultPayload } from "../types";
import { createId } from "../utils/id";
import {
  base64ToInt8,
  decryptObject,
  deriveVaultKey,
  encryptObject,
  int8ToBase64,
  randomSalt,
  saltFromEnvelope,
  type VaultEnvelope,
} from "./crypto";

interface SerializedRecord extends Omit<NormalizedRecord, "embedding"> {
  embedding?: string;
}

interface SerializedPayload extends Omit<VaultPayload, "records"> {
  records: SerializedRecord[];
}

async function storageGet<T>(key: string): Promise<T | undefined> {
  const result = await chrome.storage.local.get(key);
  return result[key] as T | undefined;
}

async function storageSet(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

function serializePayload(payload: VaultPayload): SerializedPayload {
  return {
    ...payload,
    records: payload.records.map((record) => ({
      ...record,
      embedding: record.embedding ? int8ToBase64(record.embedding) : undefined,
    })),
  };
}

function deserializePayload(payload: SerializedPayload): VaultPayload {
  return {
    ...payload,
    records: payload.records.map((record) => ({
      ...record,
      embedding: record.embedding ? base64ToInt8(record.embedding) : undefined,
    })),
    transferAudits: Array.isArray((payload as VaultPayload).transferAudits)
      ? (payload as VaultPayload).transferAudits
      : [],
  };
}

function emptyPayload(): VaultPayload {
  return {
    version: VAULT_VERSION,
    records: [],
    sources: [],
    transferAudits: [],
  };
}

export class VaultStore {
  private key: CryptoKey | null = null;

  async isInitialized(): Promise<boolean> {
    const envelope = await storageGet<VaultEnvelope>(STORAGE_KEYS.VAULT_ENVELOPE);
    return Boolean(envelope?.ciphertext && envelope?.salt && envelope?.iv);
  }

  isUnlocked(): boolean {
    return this.key !== null;
  }

  lock(): void {
    this.key = null;
  }

  async setPassphrase(passphrase: string): Promise<void> {
    const normalized = passphrase.trim();
    if (normalized.length < 8) {
      throw new Error("비밀번호는 8자 이상이어야 합니다.");
    }

    const salt = randomSalt();
    this.key = await deriveVaultKey(normalized, salt);
    const envelope = await encryptObject(serializePayload(emptyPayload()), this.key, salt);
    await storageSet(STORAGE_KEYS.VAULT_ENVELOPE, envelope);
  }

  async unlock(passphrase: string): Promise<boolean> {
    const envelope = await storageGet<VaultEnvelope>(STORAGE_KEYS.VAULT_ENVELOPE);
    if (!envelope) {
      return false;
    }

    try {
      const key = await deriveVaultKey(passphrase.trim(), saltFromEnvelope(envelope));
      await decryptObject<SerializedPayload>(envelope, key);
      this.key = key;
      return true;
    } catch {
      return false;
    }
  }

  private async readPayload(): Promise<VaultPayload> {
    if (!this.key) {
      throw new Error("Vault is locked.");
    }

    const envelope = await storageGet<VaultEnvelope>(STORAGE_KEYS.VAULT_ENVELOPE);
    if (!envelope) {
      throw new Error("Vault is not initialized.");
    }

    const serialized = await decryptObject<SerializedPayload>(envelope, this.key);
    return deserializePayload(serialized);
  }

  private async writePayload(payload: VaultPayload): Promise<void> {
    if (!this.key) {
      throw new Error("Vault is locked.");
    }

    const envelope = await storageGet<VaultEnvelope>(STORAGE_KEYS.VAULT_ENVELOPE);
    if (!envelope) {
      throw new Error("Vault is not initialized.");
    }

    const serialized = serializePayload(payload);
    const encrypted = await encryptObject(serialized, this.key, saltFromEnvelope(envelope));
    await storageSet(STORAGE_KEYS.VAULT_ENVELOPE, encrypted);
  }

  async getPayload(): Promise<VaultPayload> {
    return this.readPayload();
  }

  async listRecords(limit = 50): Promise<NormalizedRecord[]> {
    const payload = await this.readPayload();
    return payload.records
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, Math.max(1, limit));
  }

  async upsertRecords(sourceId: string, sourceName: string, records: NormalizedRecord[]): Promise<number> {
    const payload = await this.readPayload();
    const map = new Map(payload.records.map((record) => [record.id, record]));

    for (const record of records) {
      map.set(record.id, record);
    }

    const merged = Array.from(map.values());
    const nextSources = payload.sources.filter((source) => source.sourceId !== sourceId);
    nextSources.push({
      sourceId,
      sourceName,
      lastSyncedAt: new Date().toISOString(),
      recordCount: records.length,
    });

    const nextPayload: VaultPayload = {
      ...payload,
      records: merged,
      sources: nextSources,
    };

    await this.writePayload(nextPayload);
    return records.length;
  }

  async addManualRecord(input: {
    title: string;
    summary: string;
    date: string;
    tags: string[];
  }): Promise<string> {
    const payload = await this.readPayload();
    const id = createId("manual");

    const record: NormalizedRecord = {
      id,
      sourceId: "manual",
      sourceName: "수동 입력",
      type: "document",
      date: input.date,
      title: input.title,
      summary: input.summary,
      tags: input.tags,
      fhir: {
        resourceType: "DocumentReference",
        description: input.title,
      },
      raw: {
        title: input.title,
        summary: input.summary,
      },
    };

    const nextPayload: VaultPayload = {
      ...payload,
      records: [record, ...payload.records],
      sources: mergeSourceSync(payload.sources, {
        sourceId: "manual",
        sourceName: "수동 입력",
        lastSyncedAt: new Date().toISOString(),
        recordCount: payload.records.filter((item) => item.sourceId === "manual").length + 1,
      }),
    };

    await this.writePayload(nextPayload);
    return id;
  }

  async deleteRecord(id: string): Promise<boolean> {
    const payload = await this.readPayload();
    const before = payload.records.length;
    const records = payload.records.filter((record) => record.id !== id);
    if (records.length === before) {
      return false;
    }

    const nextSources = recomputeSourceSync(payload.sources, records);
    await this.writePayload({
      ...payload,
      records,
      sources: nextSources,
    });
    return true;
  }

  async getSourceSync(): Promise<SourceSyncState[]> {
    const payload = await this.readPayload();
    return payload.sources;
  }

  async listTransferAudits(limit = 20): Promise<TransferAudit[]> {
    const payload = await this.readPayload();
    return payload.transferAudits
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.max(1, limit));
  }

  async appendTransferAudit(audit: Omit<TransferAudit, "id" | "createdAt">): Promise<void> {
    const payload = await this.readPayload();
    const row: TransferAudit = {
      id: createId("audit"),
      createdAt: new Date().toISOString(),
      ...audit,
    };

    const transferAudits = [row, ...payload.transferAudits].slice(0, 200);
    await this.writePayload({
      ...payload,
      transferAudits,
    });
  }
}

function mergeSourceSync(current: SourceSyncState[], next: SourceSyncState): SourceSyncState[] {
  const filtered = current.filter((item) => item.sourceId !== next.sourceId);
  return [next, ...filtered];
}

function recomputeSourceSync(current: SourceSyncState[], records: NormalizedRecord[]): SourceSyncState[] {
  const map = new Map<string, SourceSyncState>();

  for (const source of current) {
    map.set(source.sourceId, { ...source, recordCount: 0 });
  }

  for (const record of records) {
    const existing = map.get(record.sourceId);
    if (existing) {
      existing.recordCount += 1;
      if (!existing.lastSyncedAt) {
        existing.lastSyncedAt = new Date().toISOString();
      }
    } else {
      map.set(record.sourceId, {
        sourceId: record.sourceId,
        sourceName: record.sourceName,
        lastSyncedAt: new Date().toISOString(),
        recordCount: 1,
      });
    }
  }

  return Array.from(map.values()).filter((item) => item.recordCount > 0);
}
