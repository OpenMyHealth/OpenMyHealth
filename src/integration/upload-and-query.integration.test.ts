import "fake-indexeddb/auto";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { fakeBrowser } from "wxt/testing";

vi.stubGlobal("navigator", { language: "ko-KR" });

describe("upload-and-query integration", () => {
  const PIN = "123456";

  let deriveAesKey: typeof import("../core/crypto").deriveAesKey;
  let encryptJson: typeof import("../core/crypto").encryptJson;
  let generateSaltBase64: typeof import("../core/crypto").generateSaltBase64;
  let saveResourceRecords: typeof import("../core/db").saveResourceRecords;
  let parseUploadPipeline: typeof import("../core/pipeline").parseUploadPipeline;
  let buildMcpResponse: typeof import("../core/mcp").buildMcpResponse;

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

    const cryptoMod = await import("../core/crypto");
    deriveAesKey = cryptoMod.deriveAesKey;
    encryptJson = cryptoMod.encryptJson;
    generateSaltBase64 = cryptoMod.generateSaltBase64;

    const db = await import("../core/db");
    saveResourceRecords = db.saveResourceRecords;

    const pipeline = await import("../core/pipeline");
    parseUploadPipeline = pipeline.parseUploadPipeline;

    const mcp = await import("../core/mcp");
    buildMcpResponse = mcp.buildMcpResponse;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function storeUpload(text: string, fileName: string, key: CryptoKey) {
    const bytes = new TextEncoder().encode(text);
    const result = await parseUploadPipeline(fileName, "text/plain", bytes);

    const records = await Promise.all(
      result.resources.map(async (draft) => ({
        id: crypto.randomUUID(),
        schemaVersion: 1,
        fileId: "file-upload",
        resourceType: draft.resourceType,
        createdAt: new Date().toISOString(),
        date: draft.date,
        encryptedPayload: await encryptJson(key, draft.payload),
      })),
    );

    await saveResourceRecords(records);
    return result;
  }

  it("uploads observation text, queries via MCP, and returns parsed record", async () => {
    const salt = generateSaltBase64();
    const key = await deriveAesKey(PIN, salt);

    const uploadResult = await storeUpload("Hemoglobin: 14.5 g/dL", "lab-results.txt", key);
    expect(uploadResult.matchedCounts).toHaveProperty("Observation");

    const response = await buildMcpResponse(key, {
      resource_types: ["Observation"],
      depth: "detail",
      limit: 50,
    });

    expect(response.status).toBe("ok");
    expect(response.count).toBeGreaterThan(0);

    const obsResource = response.resources.find((r) => r.resource_type === "Observation");
    expect(obsResource).toBeTruthy();
    expect(obsResource!.data.length).toBeGreaterThan(0);

    const record = obsResource!.data[0];
    expect(record.display).toBe("Hemoglobin");
    expect(record.value).toBe(14.5);
    expect(record.unit).toBe("g/dL");
  });

  it("uploads medication text and queries MedicationStatement", async () => {
    const salt = generateSaltBase64();
    const key = await deriveAesKey(PIN, salt);

    await storeUpload("Aspirin 100 mg daily\nMetformin 500 mg twice daily", "prescriptions.txt", key);

    const response = await buildMcpResponse(key, {
      resource_types: ["MedicationStatement"],
      depth: "detail",
      limit: 50,
    });

    expect(response.status).toBe("ok");
    expect(response.count).toBeGreaterThan(0);

    const medResource = response.resources.find((r) => r.resource_type === "MedicationStatement");
    expect(medResource).toBeTruthy();
    expect(medResource!.data.length).toBeGreaterThan(0);

    const displays = medResource!.data.map((d) => d.display);
    expect(displays.some((d) => d?.includes("Aspirin"))).toBe(true);
  });

  it("returns only id/code/system at depth 'codes'", async () => {
    const salt = generateSaltBase64();
    const key = await deriveAesKey(PIN, salt);

    await storeUpload("Hemoglobin: 14.5 g/dL", "lab.txt", key);

    const response = await buildMcpResponse(key, {
      resource_types: ["Observation"],
      depth: "codes",
      limit: 50,
    });

    expect(response.status).toBe("ok");
    expect(response.depth).toBe("codes");

    for (const resource of response.resources) {
      for (const record of resource.data) {
        expect(record).toHaveProperty("id");
        expect(record.display).toBeUndefined();
        expect(record.value).toBeUndefined();
        expect(record.unit).toBeUndefined();
      }
    }
  });

  it("returns summary fields at depth 'summary' but no notes", async () => {
    const salt = generateSaltBase64();
    const key = await deriveAesKey(PIN, salt);

    await storeUpload("Hemoglobin: 14.5 g/dL", "lab.txt", key);

    const response = await buildMcpResponse(key, {
      resource_types: ["Observation"],
      depth: "summary",
      limit: 50,
    });

    expect(response.status).toBe("ok");
    expect(response.depth).toBe("summary");

    for (const resource of response.resources) {
      for (const record of resource.data) {
        expect(record).toHaveProperty("id");
        expect(record).toHaveProperty("display");
        expect(record.notes).toBeUndefined();
        expect(record.performer).toBeUndefined();
        expect(record.reference_range).toBeUndefined();
      }
    }
  });

  it("classifies condition text as Condition resource", async () => {
    const salt = generateSaltBase64();
    const key = await deriveAesKey(PIN, salt);

    const result = await storeUpload("진단: cancer stage II", "diagnosis.txt", key);
    expect(result.matchedCounts).toHaveProperty("Condition");

    const response = await buildMcpResponse(key, {
      resource_types: ["Condition"],
      depth: "detail",
      limit: 50,
    });

    expect(response.status).toBe("ok");
    expect(response.count).toBeGreaterThan(0);
  });

  it("query with text filter matches relevant records", async () => {
    const salt = generateSaltBase64();
    const key = await deriveAesKey(PIN, salt);

    await storeUpload("Hemoglobin: 14.5 g/dL\nPlatelet: 250 10^3/uL", "lab.txt", key);

    const response = await buildMcpResponse(key, {
      resource_types: ["Observation"],
      depth: "detail",
      query: "hemoglobin",
      limit: 50,
    });

    expect(response.status).toBe("ok");
    expect(response.meta.query_matched).toBe(true);

    const obsResource = response.resources.find((r) => r.resource_type === "Observation");
    expect(obsResource).toBeTruthy();
    for (const record of obsResource!.data) {
      expect(record.display?.toLowerCase()).toContain("hemoglobin");
    }
  });

  it("returns empty results for unmatched resource type", async () => {
    const salt = generateSaltBase64();
    const key = await deriveAesKey(PIN, salt);

    await storeUpload("Hemoglobin: 14.5 g/dL", "lab.txt", key);

    const response = await buildMcpResponse(key, {
      resource_types: ["DiagnosticReport"],
      depth: "detail",
      limit: 50,
    });

    expect(response.status).toBe("ok");
    expect(response.count).toBe(0);
  });

  it("detail depth includes all fields", async () => {
    const salt = generateSaltBase64();
    const key = await deriveAesKey(PIN, salt);

    await storeUpload("Hemoglobin: 14.5 g/dL", "lab.txt", key);

    const response = await buildMcpResponse(key, {
      resource_types: ["Observation"],
      depth: "detail",
      limit: 50,
    });

    expect(response.status).toBe("ok");
    expect(response.depth).toBe("detail");

    const obsResource = response.resources.find((r) => r.resource_type === "Observation");
    expect(obsResource).toBeTruthy();

    const record = obsResource!.data[0];
    expect(record.id).toBeTruthy();
    expect(record.display).toBe("Hemoglobin");
    expect(record.value).toBe(14.5);
    expect(record.unit).toBe("g/dL");
  });
});
