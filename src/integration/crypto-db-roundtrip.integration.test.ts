import "fake-indexeddb/auto";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { fakeBrowser } from "wxt/testing";

// Suppress navigator.language for normalizeSettings
vi.stubGlobal("navigator", { language: "ko-KR" });

describe("crypto-db roundtrip integration", () => {
  const TEST_PIN = "123456";
  const ALT_PIN = "654321";

  let deriveAesKey: typeof import("../core/crypto").deriveAesKey;
  let encryptJson: typeof import("../core/crypto").encryptJson;
  let decryptJson: typeof import("../core/crypto").decryptJson;
  let generateSaltBase64: typeof import("../core/crypto").generateSaltBase64;
  let saveResourceRecords: typeof import("../core/db").saveResourceRecords;
  let queryResources: typeof import("../core/db").queryResources;

  beforeEach(async () => {
    fakeBrowser.reset();
    vi.resetModules();

    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase("openmyhealth_vault");
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve();
    });

    const cryptoMod = await import("../core/crypto");
    deriveAesKey = cryptoMod.deriveAesKey;
    encryptJson = cryptoMod.encryptJson;
    decryptJson = cryptoMod.decryptJson;
    generateSaltBase64 = cryptoMod.generateSaltBase64;

    const db = await import("../core/db");
    saveResourceRecords = db.saveResourceRecords;
    queryResources = db.queryResources;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("derives key, encrypts JSON, stores in DB, queries, and decrypts to verify roundtrip", async () => {
    const salt = generateSaltBase64();
    const key = await deriveAesKey(TEST_PIN, salt);

    const payload = { id: "rec-1", display: "Hemoglobin", value: 14.5, unit: "g/dL" };
    const envelope = await encryptJson(key, payload);

    await saveResourceRecords([
      {
        id: "res-1",
        schemaVersion: 1,
        fileId: "file-1",
        resourceType: "Observation",
        createdAt: new Date().toISOString(),
        date: "2025-01-15",
        encryptedPayload: envelope,
      },
    ]);

    const results = await queryResources({
      resourceTypes: ["Observation"],
      limit: 10,
    });

    expect(results).toHaveLength(1);
    const decrypted = await decryptJson(key, results[0].encryptedPayload);
    expect(decrypted).toEqual(payload);
  });

  it("fails to decrypt with a different PIN", async () => {
    const salt = generateSaltBase64();
    const correctKey = await deriveAesKey(TEST_PIN, salt);
    const wrongKey = await deriveAesKey(ALT_PIN, salt);

    const payload = { id: "rec-2", display: "WBC", value: 7.5 };
    const envelope = await encryptJson(correctKey, payload);

    await saveResourceRecords([
      {
        id: "res-2",
        schemaVersion: 1,
        fileId: "file-1",
        resourceType: "Observation",
        createdAt: new Date().toISOString(),
        date: "2025-01-15",
        encryptedPayload: envelope,
      },
    ]);

    const results = await queryResources({
      resourceTypes: ["Observation"],
      limit: 10,
    });

    expect(results).toHaveLength(1);
    await expect(decryptJson(wrongKey, results[0].encryptedPayload)).rejects.toThrow();
  });

  it("stores and retrieves multiple records correctly", async () => {
    const salt = generateSaltBase64();
    const key = await deriveAesKey(TEST_PIN, salt);

    const records = await Promise.all(
      Array.from({ length: 5 }, async (_, i) => {
        const payload = { id: `multi-${i}`, display: `Record ${i}`, value: i * 10 };
        const envelope = await encryptJson(key, payload);
        return {
          id: `res-multi-${i}`,
          schemaVersion: 1,
          fileId: "file-multi",
          resourceType: "Observation" as const,
          createdAt: new Date().toISOString(),
          date: "2025-01-15",
          encryptedPayload: envelope,
        };
      }),
    );

    await saveResourceRecords(records);

    const results = await queryResources({
      resourceTypes: ["Observation"],
      limit: 50,
    });

    expect(results).toHaveLength(5);

    for (const result of results) {
      const decrypted = await decryptJson<{ id: string; display: string; value: number }>(key, result.encryptedPayload);
      expect(decrypted.display).toMatch(/^Record \d$/);
      expect(typeof decrypted.value).toBe("number");
    }
  });

  it("fails to decrypt when AAD is tampered", async () => {
    const salt = generateSaltBase64();
    const key = await deriveAesKey(TEST_PIN, salt);

    const payload = { id: "aad-1", display: "Platelet", value: 250 };
    const envelope = await encryptJson(key, payload, "file-aad-original");

    const tampered = { ...envelope, aad: "file-aad-tampered" };

    await expect(decryptJson(key, tampered)).rejects.toThrow();
  });

  it("encrypts with AAD and decrypts correctly with matching AAD", async () => {
    const salt = generateSaltBase64();
    const key = await deriveAesKey(TEST_PIN, salt);

    const payload = { id: "aad-2", display: "RBC", value: 4.8, unit: "M/uL" };
    const aad = "file-aad-correct";
    const envelope = await encryptJson(key, payload, aad);

    const decrypted = await decryptJson(key, envelope);
    expect(decrypted).toEqual(payload);
  });

  it("generates unique salts each time", () => {
    const salt1 = generateSaltBase64();
    const salt2 = generateSaltBase64();
    expect(salt1).not.toBe(salt2);
  });

  it("derives different keys from same PIN with different salts", async () => {
    const salt1 = generateSaltBase64();
    const salt2 = generateSaltBase64();
    const key1 = await deriveAesKey(TEST_PIN, salt1);
    const key2 = await deriveAesKey(TEST_PIN, salt2);

    const payload = { id: "diff-salt", display: "test" };
    const envelope = await encryptJson(key1, payload);

    await expect(decryptJson(key2, envelope)).rejects.toThrow();
  });

  it("query filters by resourceType correctly after storing mixed types", async () => {
    const salt = generateSaltBase64();
    const key = await deriveAesKey(TEST_PIN, salt);

    const obsPayload = { id: "obs-1", display: "Hemoglobin", value: 14.5 };
    const medPayload = { id: "med-1", display: "Aspirin 100mg" };

    const obsEnvelope = await encryptJson(key, obsPayload);
    const medEnvelope = await encryptJson(key, medPayload);

    await saveResourceRecords([
      {
        id: "mixed-obs",
        schemaVersion: 1,
        fileId: "file-mixed",
        resourceType: "Observation",
        createdAt: new Date().toISOString(),
        date: "2025-01-15",
        encryptedPayload: obsEnvelope,
      },
      {
        id: "mixed-med",
        schemaVersion: 1,
        fileId: "file-mixed",
        resourceType: "MedicationStatement",
        createdAt: new Date().toISOString(),
        date: "2025-01-15",
        encryptedPayload: medEnvelope,
      },
    ]);

    const obsResults = await queryResources({
      resourceTypes: ["Observation"],
      limit: 10,
    });
    expect(obsResults).toHaveLength(1);
    const decObs = await decryptJson(key, obsResults[0].encryptedPayload);
    expect(decObs).toEqual(obsPayload);

    const medResults = await queryResources({
      resourceTypes: ["MedicationStatement"],
      limit: 10,
    });
    expect(medResults).toHaveLength(1);
    const decMed = await decryptJson(key, medResults[0].encryptedPayload);
    expect(decMed).toEqual(medPayload);
  });
});
