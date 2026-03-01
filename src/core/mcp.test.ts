import type {
  McpDataRecord,
  ReadHealthRecordsRequest,
  ResourceType,
} from "../../packages/contracts/src/index";
import type { StoredResourceRecord } from "./models";
import type { Mock } from "vitest";

vi.mock("./crypto", () => ({
  decryptJson: vi.fn(),
}));

vi.mock("./db", () => ({
  queryResources: vi.fn(),
}));

import { buildMcpResponse } from "./mcp";
import { decryptJson } from "./crypto";
import { queryResources } from "./db";

const mockQueryResources = queryResources as Mock;
const mockDecryptJson = decryptJson as Mock;

function makeEnvelope() {
  return {
    keyVersion: 1,
    iv: "dGVzdA==",
    ciphertext: "dGVzdA==",
  };
}

function makeStoredResource(overrides: Partial<StoredResourceRecord> = {}): StoredResourceRecord {
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

function makeDataRecord(overrides: Partial<McpDataRecord> = {}): McpDataRecord {
  return {
    id: crypto.randomUUID(),
    code: "12345",
    system: "http://loinc.org",
    display: "Hemoglobin",
    value: 14.5,
    unit: "g/dL",
    date: "2025-01-15",
    flag: "normal",
    notes: "within normal range",
    ...overrides,
  };
}

// A fake CryptoKey for testing (we mock decryptJson so the key is never used)
const fakeKey = {} as CryptoKey;

function makeRequest(overrides: Partial<ReadHealthRecordsRequest> = {}): ReadHealthRecordsRequest {
  return {
    resource_types: ["Observation"] as ResourceType[],
    depth: "detail",
    limit: 50,
    ...overrides,
  };
}

describe("buildMcpResponse", () => {
  beforeEach(() => {
    mockQueryResources.mockReset();
    mockDecryptJson.mockReset();
  });

  it("with no records returns empty response, status ok", async () => {
    mockQueryResources.mockResolvedValue([]);

    const response = await buildMcpResponse(fakeKey, makeRequest());

    expect(response.status).toBe("ok");
    expect(response.count).toBe(0);
    expect(response.resources[0].data).toEqual([]);
    expect(response.meta.total_available).toBe(0);
  });

  it("with depth 'codes' returns only id, code, system in records", async () => {
    const stored = makeStoredResource();
    const payload = makeDataRecord({ id: "rec-codes", code: "C001", system: "loinc" });
    mockQueryResources.mockResolvedValue([stored]);
    mockDecryptJson.mockResolvedValue(payload);

    const response = await buildMcpResponse(fakeKey, makeRequest({ depth: "codes" }));

    expect(response.depth).toBe("codes");
    const record = response.resources[0].data[0];
    expect(record.id).toBe("rec-codes");
    expect(record.code).toBe("C001");
    expect(record.system).toBe("loinc");
    expect(record.display).toBeUndefined();
    expect(record.value).toBeUndefined();
    expect(record.unit).toBeUndefined();
    expect(record.date).toBeUndefined();
    expect(record.flag).toBeUndefined();
    expect(record.notes).toBeUndefined();
  });

  it("with depth 'summary' includes display, value, unit, date, flag", async () => {
    const stored = makeStoredResource();
    const payload = makeDataRecord({
      id: "rec-summary",
      display: "Glucose",
      value: 90,
      unit: "mg/dL",
      date: "2025-03-01",
      flag: "normal",
      notes: "should be stripped",
      performer: "Dr. Kim",
    });
    mockQueryResources.mockResolvedValue([stored]);
    mockDecryptJson.mockResolvedValue(payload);

    const response = await buildMcpResponse(fakeKey, makeRequest({ depth: "summary" }));

    const record = response.resources[0].data[0];
    expect(record.id).toBe("rec-summary");
    expect(record.display).toBe("Glucose");
    expect(record.value).toBe(90);
    expect(record.unit).toBe("mg/dL");
    expect(record.date).toBe("2025-03-01");
    expect(record.flag).toBe("normal");
    // summary should not include notes or performer
    expect(record.notes).toBeUndefined();
    expect(record.performer).toBeUndefined();
  });

  it("with depth 'detail' returns full record", async () => {
    const stored = makeStoredResource();
    const payload = makeDataRecord({
      id: "rec-detail",
      notes: "detailed notes",
      performer: "Dr. Kim",
    });
    mockQueryResources.mockResolvedValue([stored]);
    mockDecryptJson.mockResolvedValue(payload);

    const response = await buildMcpResponse(fakeKey, makeRequest({ depth: "detail" }));

    const record = response.resources[0].data[0];
    expect(record.id).toBe("rec-detail");
    expect(record.notes).toBe("detailed notes");
    expect(record.performer).toBe("Dr. Kim");
  });

  it("groups records by resourceType", async () => {
    const storedObs = makeStoredResource({ resourceType: "Observation" });
    const storedMed = makeStoredResource({ resourceType: "MedicationStatement" });
    const obsPayload = makeDataRecord({ id: "obs-1", display: "Hemoglobin" });
    const medPayload = makeDataRecord({ id: "med-1", display: "Aspirin" });

    mockQueryResources.mockResolvedValue([storedObs, storedMed]);
    mockDecryptJson
      .mockResolvedValueOnce(obsPayload)
      .mockResolvedValueOnce(medPayload);

    const response = await buildMcpResponse(
      fakeKey,
      makeRequest({ resource_types: ["Observation", "MedicationStatement"] }),
    );

    const obsGroup = response.resources.find((r) => r.resource_type === "Observation");
    const medGroup = response.resources.find((r) => r.resource_type === "MedicationStatement");
    expect(obsGroup!.count).toBe(1);
    expect(obsGroup!.data[0].id).toBe("obs-1");
    expect(medGroup!.count).toBe(1);
    expect(medGroup!.data[0].id).toBe("med-1");
  });

  it("with query filters by matchesQuery", async () => {
    const stored = makeStoredResource();
    const payload = makeDataRecord({ display: "Hemoglobin", value: 14.5 });
    mockQueryResources.mockResolvedValue([stored]);
    mockDecryptJson.mockResolvedValue(payload);

    const response = await buildMcpResponse(fakeKey, makeRequest({ query: "Hemoglobin" }));

    expect(response.count).toBe(1);
    expect(response.meta.query_matched).toBe(true);
  });

  it("with query that matches display field", async () => {
    const stored = makeStoredResource();
    const payload = makeDataRecord({ display: "Glucose Level" });
    mockQueryResources.mockResolvedValue([stored]);
    mockDecryptJson.mockResolvedValue(payload);

    const response = await buildMcpResponse(fakeKey, makeRequest({ query: "glucose" }));

    expect(response.count).toBe(1);
    expect(response.meta.query_matched).toBe(true);
  });

  it("with query that matches notes field", async () => {
    const stored = makeStoredResource();
    const payload = makeDataRecord({ display: "Test", notes: "patient has diabetes" });
    mockQueryResources.mockResolvedValue([stored]);
    mockDecryptJson.mockResolvedValue(payload);

    const response = await buildMcpResponse(fakeKey, makeRequest({ query: "diabetes" }));

    expect(response.count).toBe(1);
    expect(response.meta.query_matched).toBe(true);
  });

  it("with query no match returns empty but still ok", async () => {
    const stored = makeStoredResource();
    const payload = makeDataRecord({ display: "Hemoglobin" });
    mockQueryResources.mockResolvedValue([stored]);
    mockDecryptJson.mockResolvedValue(payload);

    const response = await buildMcpResponse(fakeKey, makeRequest({ query: "zzz_no_match" }));

    expect(response.status).toBe("ok");
    expect(response.count).toBe(0);
    expect(response.meta.query_matched).toBe(false);
    expect(response.meta.filtered_count).toBe(0);
  });

  it("respects MAX_RECORDS_PER_RESPONSE limit (50)", async () => {
    const storedRecords = Array.from({ length: 60 }, () => makeStoredResource());
    mockQueryResources.mockResolvedValue(storedRecords);

    let callIndex = 0;
    mockDecryptJson.mockImplementation(async () => {
      return makeDataRecord({ id: `rec-${callIndex++}` });
    });

    const response = await buildMcpResponse(fakeKey, makeRequest({ limit: 50 }));

    expect(response.count).toBeLessThanOrEqual(50);
  });

  it("corrupted record is skipped (decryptJson throws)", async () => {
    const good = makeStoredResource({ id: "good-rec" });
    const bad = makeStoredResource({ id: "bad-rec" });
    const goodPayload = makeDataRecord({ id: "good-data" });

    mockQueryResources.mockResolvedValue([good, bad]);
    mockDecryptJson
      .mockResolvedValueOnce(goodPayload)
      .mockRejectedValueOnce(new Error("decryption failed"));

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await buildMcpResponse(fakeKey, makeRequest());

    expect(response.count).toBe(1);
    expect(response.resources[0].data[0].id).toBe("good-data");
    consoleSpy.mockRestore();
  });

  it("with multiple resource types", async () => {
    const obs = makeStoredResource({ resourceType: "Observation" });
    const cond = makeStoredResource({ resourceType: "Condition" });
    const obsPayload = makeDataRecord({ id: "obs-rec" });
    const condPayload = makeDataRecord({ id: "cond-rec" });

    mockQueryResources.mockResolvedValue([obs, cond]);
    mockDecryptJson
      .mockResolvedValueOnce(obsPayload)
      .mockResolvedValueOnce(condPayload);

    const response = await buildMcpResponse(
      fakeKey,
      makeRequest({ resource_types: ["Observation", "Condition"] }),
    );

    expect(response.resources).toHaveLength(2);
    expect(response.count).toBe(2);
  });

  it("meta.total_available reflects DB query count", async () => {
    const storedRecords = Array.from({ length: 7 }, () => makeStoredResource());
    mockQueryResources.mockResolvedValue(storedRecords);

    let callIndex = 0;
    mockDecryptJson.mockImplementation(async () => {
      return makeDataRecord({ id: `meta-${callIndex++}` });
    });

    const response = await buildMcpResponse(fakeKey, makeRequest());

    expect(response.meta.total_available).toBe(7);
  });

  it("meta.filtered_count reflects post-decrypt count", async () => {
    const stored1 = makeStoredResource();
    const stored2 = makeStoredResource();
    const payload1 = makeDataRecord({ display: "Hemoglobin" });
    const payload2 = makeDataRecord({ display: "Glucose" });

    mockQueryResources.mockResolvedValue([stored1, stored2]);
    mockDecryptJson
      .mockResolvedValueOnce(payload1)
      .mockResolvedValueOnce(payload2);

    const response = await buildMcpResponse(fakeKey, makeRequest({ query: "hemoglobin" }));

    expect(response.meta.total_available).toBe(2);
    expect(response.meta.filtered_count).toBe(1);
  });

  it("uses MAX_RECORDS_PER_RESPONSE when request.limit is not set", async () => {
    const stored = makeStoredResource();
    const payload = makeDataRecord();
    mockQueryResources.mockResolvedValue([stored]);
    mockDecryptJson.mockResolvedValue(payload);

    const response = await buildMcpResponse(fakeKey, {
      resource_types: ["Observation"],
      depth: "detail",
    } as ReadHealthRecordsRequest);

    expect(response.status).toBe("ok");
    expect(response.count).toBe(1);
  });

  it("matchesQuery handles string value fields", async () => {
    const stored = makeStoredResource();
    const payload = makeDataRecord({ value: "positive" as unknown as number, display: "Test" });
    mockQueryResources.mockResolvedValue([stored]);
    mockDecryptJson.mockResolvedValue(payload);

    const response = await buildMcpResponse(fakeKey, makeRequest({ query: "positive" }));
    expect(response.count).toBe(1);
  });

  it("meta.query_matched is true when query matches", async () => {
    const stored = makeStoredResource();
    const payload = makeDataRecord({ display: "Hemoglobin" });

    mockQueryResources.mockResolvedValue([stored]);
    mockDecryptJson.mockResolvedValue(payload);

    const response = await buildMcpResponse(fakeKey, makeRequest({ query: "hemoglobin" }));
    expect(response.meta.query_matched).toBe(true);

    // Without query
    mockQueryResources.mockResolvedValue([stored]);
    mockDecryptJson.mockResolvedValue(payload);

    const response2 = await buildMcpResponse(fakeKey, makeRequest());
    expect(response2.meta.query_matched).toBe(false);
  });
});
