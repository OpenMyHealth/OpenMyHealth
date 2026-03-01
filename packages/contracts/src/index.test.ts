import { describe, it, expect } from "vitest";
import {
  MAX_RECORDS_PER_RESPONSE,
  AiProviderSchema,
  ResourceTypeSchema,
  McpDepthSchema,
  McpStatusSchema,
  McpErrorCodeSchema,
  ReadHealthRecordsRequestSchema,
  McpDataRecordSchema,
  ReadHealthRecordsResponseSchema,
  AuditLogEntrySchema,
  AuditResultSchema,
  PermissionLevelSchema,
  ResourceCountMapSchema,
  McpResourceResultSchema,
  buildMcpErrorResponse,
  buildMcpDeniedResponse,
  buildMcpTimeoutResponse,
} from "./index";

describe("MAX_RECORDS_PER_RESPONSE", () => {
  it("equals 50", () => {
    expect(MAX_RECORDS_PER_RESPONSE).toBe(50);
  });
});

describe("AiProviderSchema", () => {
  it.each(["chatgpt", "claude", "gemini"])("accepts '%s'", (v) => {
    expect(AiProviderSchema.parse(v)).toBe(v);
  });

  it("rejects unknown provider", () => {
    expect(() => AiProviderSchema.parse("bard")).toThrow();
  });

  it("rejects empty string", () => {
    expect(() => AiProviderSchema.parse("")).toThrow();
  });

  it("rejects number", () => {
    expect(() => AiProviderSchema.parse(1)).toThrow();
  });
});

describe("ResourceTypeSchema", () => {
  const validTypes = [
    "Observation",
    "MedicationStatement",
    "Condition",
    "DiagnosticReport",
    "DocumentReference",
  ];

  it.each(validTypes)("accepts '%s'", (v) => {
    expect(ResourceTypeSchema.parse(v)).toBe(v);
  });

  it("rejects 'Patient'", () => {
    expect(() => ResourceTypeSchema.parse("Patient")).toThrow();
  });

  it("rejects 'unknown'", () => {
    expect(() => ResourceTypeSchema.parse("unknown")).toThrow();
  });

  it("rejects lowercase variant", () => {
    expect(() => ResourceTypeSchema.parse("observation")).toThrow();
  });
});

describe("McpDepthSchema", () => {
  it.each(["codes", "summary", "detail"])("accepts '%s'", (v) => {
    expect(McpDepthSchema.parse(v)).toBe(v);
  });

  it("rejects 'verbose'", () => {
    expect(() => McpDepthSchema.parse("verbose")).toThrow();
  });
});

describe("McpStatusSchema", () => {
  it.each(["ok", "denied", "timeout", "error"])("accepts '%s'", (v) => {
    expect(McpStatusSchema.parse(v)).toBe(v);
  });

  it("rejects 'pending'", () => {
    expect(() => McpStatusSchema.parse("pending")).toThrow();
  });
});

describe("McpErrorCodeSchema", () => {
  const codes = [
    "LOCKED_SESSION",
    "SETUP_REQUIRED",
    "APPROVAL_TIMEOUT",
    "CONTENT_SCRIPT_UNAVAILABLE",
    "CONTENT_SCRIPT_RENDER_FAILED",
    "NETWORK_UNAVAILABLE",
    "INVALID_REQUEST",
    "INTERNAL_ERROR",
  ];

  it.each(codes)("accepts '%s'", (v) => {
    expect(McpErrorCodeSchema.parse(v)).toBe(v);
  });

  it("rejects unknown code", () => {
    expect(() => McpErrorCodeSchema.parse("UNKNOWN_CODE")).toThrow();
  });
});

describe("ResourceCountMapSchema", () => {
  it("accepts empty object", () => {
    expect(ResourceCountMapSchema.parse({})).toEqual({});
  });

  it("accepts all fields set", () => {
    const input = {
      Observation: 10,
      MedicationStatement: 5,
      Condition: 3,
      DiagnosticReport: 0,
      DocumentReference: 1,
    };
    expect(ResourceCountMapSchema.parse(input)).toEqual(input);
  });

  it("accepts partial fields", () => {
    const input = { Observation: 2 };
    expect(ResourceCountMapSchema.parse(input)).toEqual(input);
  });

  it("rejects negative numbers", () => {
    expect(() => ResourceCountMapSchema.parse({ Observation: -1 })).toThrow();
  });

  it("rejects non-integer numbers", () => {
    expect(() => ResourceCountMapSchema.parse({ Observation: 1.5 })).toThrow();
  });
});

describe("ReadHealthRecordsRequestSchema", () => {
  const validBase = {
    resource_types: ["Observation"],
    depth: "summary",
  };

  it("accepts minimal valid request", () => {
    const result = ReadHealthRecordsRequestSchema.parse(validBase);
    expect(result.resource_types).toEqual(["Observation"]);
    expect(result.depth).toBe("summary");
  });

  it("defaults limit to 50", () => {
    const result = ReadHealthRecordsRequestSchema.parse(validBase);
    expect(result.limit).toBe(50);
  });

  it("accepts explicit limit within range", () => {
    const result = ReadHealthRecordsRequestSchema.parse({ ...validBase, limit: 10 });
    expect(result.limit).toBe(10);
  });

  it("accepts limit of 1", () => {
    const result = ReadHealthRecordsRequestSchema.parse({ ...validBase, limit: 1 });
    expect(result.limit).toBe(1);
  });

  it("accepts limit of 50", () => {
    const result = ReadHealthRecordsRequestSchema.parse({ ...validBase, limit: 50 });
    expect(result.limit).toBe(50);
  });

  it("rejects limit of 0", () => {
    expect(() => ReadHealthRecordsRequestSchema.parse({ ...validBase, limit: 0 })).toThrow();
  });

  it("rejects limit of 51", () => {
    expect(() => ReadHealthRecordsRequestSchema.parse({ ...validBase, limit: 51 })).toThrow();
  });

  it("rejects negative limit", () => {
    expect(() => ReadHealthRecordsRequestSchema.parse({ ...validBase, limit: -1 })).toThrow();
  });

  it("requires resource_types min length 1", () => {
    expect(() =>
      ReadHealthRecordsRequestSchema.parse({ resource_types: [], depth: "summary" }),
    ).toThrow();
  });

  it("accepts multiple resource_types", () => {
    const result = ReadHealthRecordsRequestSchema.parse({
      resource_types: ["Observation", "Condition"],
      depth: "detail",
    });
    expect(result.resource_types).toHaveLength(2);
  });

  it("requires depth", () => {
    expect(() =>
      ReadHealthRecordsRequestSchema.parse({ resource_types: ["Observation"] }),
    ).toThrow();
  });

  it("accepts optional query", () => {
    const result = ReadHealthRecordsRequestSchema.parse({ ...validBase, query: "blood pressure" });
    expect(result.query).toBe("blood pressure");
  });

  it("trims query whitespace", () => {
    const result = ReadHealthRecordsRequestSchema.parse({ ...validBase, query: "  hello  " });
    expect(result.query).toBe("hello");
  });

  it("rejects query exceeding 500 chars", () => {
    const longQuery = "a".repeat(501);
    expect(() =>
      ReadHealthRecordsRequestSchema.parse({ ...validBase, query: longQuery }),
    ).toThrow();
  });

  it("accepts query of exactly 500 chars", () => {
    const query = "a".repeat(500);
    const result = ReadHealthRecordsRequestSchema.parse({ ...validBase, query });
    expect(result.query).toBe(query);
  });

  it("rejects query that is only whitespace (becomes empty after trim)", () => {
    expect(() =>
      ReadHealthRecordsRequestSchema.parse({ ...validBase, query: "   " }),
    ).toThrow();
  });

  it("accepts valid ISO date_from", () => {
    const result = ReadHealthRecordsRequestSchema.parse({
      ...validBase,
      date_from: "2024-01-01",
    });
    expect(result.date_from).toBe("2024-01-01");
  });

  it("accepts ISO datetime date_from", () => {
    const result = ReadHealthRecordsRequestSchema.parse({
      ...validBase,
      date_from: "2024-01-01T00:00:00Z",
    });
    expect(result.date_from).toBe("2024-01-01T00:00:00Z");
  });

  it("rejects invalid date_from", () => {
    expect(() =>
      ReadHealthRecordsRequestSchema.parse({ ...validBase, date_from: "not-a-date" }),
    ).toThrow();
  });

  it("accepts valid date_to", () => {
    const result = ReadHealthRecordsRequestSchema.parse({
      ...validBase,
      date_to: "2024-12-31",
    });
    expect(result.date_to).toBe("2024-12-31");
  });

  it("rejects invalid date_to", () => {
    expect(() =>
      ReadHealthRecordsRequestSchema.parse({ ...validBase, date_to: "invalid" }),
    ).toThrow();
  });
});

describe("McpDataRecordSchema", () => {
  it("accepts minimal record (id only)", () => {
    const result = McpDataRecordSchema.parse({ id: "rec-1" });
    expect(result.id).toBe("rec-1");
  });

  it("accepts fully populated record", () => {
    const full = {
      id: "rec-1",
      code: "12345-6",
      system: "http://loinc.org",
      display: "Blood Glucose",
      value: 120,
      unit: "mg/dL",
      date: "2024-01-15",
      flag: "high",
      reference_range: { low: 70, high: 100 },
      performer: "Dr. Kim",
      notes: "Fasting glucose",
    };
    const result = McpDataRecordSchema.parse(full);
    expect(result).toEqual(full);
  });

  it("rejects missing id", () => {
    expect(() => McpDataRecordSchema.parse({ code: "12345" })).toThrow();
  });

  it("accepts string value", () => {
    const result = McpDataRecordSchema.parse({ id: "rec-1", value: "positive" });
    expect(result.value).toBe("positive");
  });

  it("accepts numeric value", () => {
    const result = McpDataRecordSchema.parse({ id: "rec-1", value: 99.5 });
    expect(result.value).toBe(99.5);
  });

  it("rejects boolean value", () => {
    expect(() => McpDataRecordSchema.parse({ id: "rec-1", value: true })).toThrow();
  });

  it.each(["low", "high", "normal", "unknown"])("accepts flag '%s'", (flag) => {
    expect(McpDataRecordSchema.parse({ id: "r", flag }).flag).toBe(flag);
  });

  it("rejects invalid flag", () => {
    expect(() => McpDataRecordSchema.parse({ id: "r", flag: "critical" })).toThrow();
  });

  it("accepts reference_range with only low", () => {
    const result = McpDataRecordSchema.parse({ id: "r", reference_range: { low: 10 } });
    expect(result.reference_range).toEqual({ low: 10 });
  });

  it("accepts reference_range with only high", () => {
    const result = McpDataRecordSchema.parse({ id: "r", reference_range: { high: 200 } });
    expect(result.reference_range).toEqual({ high: 200 });
  });

  it("accepts empty reference_range", () => {
    const result = McpDataRecordSchema.parse({ id: "r", reference_range: {} });
    expect(result.reference_range).toEqual({});
  });
});

describe("McpResourceResultSchema", () => {
  it("accepts valid resource result", () => {
    const input = {
      resource_type: "Observation",
      count: 1,
      data: [{ id: "r1" }],
    };
    expect(McpResourceResultSchema.parse(input)).toEqual(input);
  });

  it("accepts empty data array", () => {
    const input = { resource_type: "Condition", count: 0, data: [] };
    expect(McpResourceResultSchema.parse(input).data).toEqual([]);
  });

  it("rejects invalid resource_type", () => {
    expect(() =>
      McpResourceResultSchema.parse({ resource_type: "Invalid", count: 0, data: [] }),
    ).toThrow();
  });

  it("rejects negative count", () => {
    expect(() =>
      McpResourceResultSchema.parse({ resource_type: "Observation", count: -1, data: [] }),
    ).toThrow();
  });
});

describe("ReadHealthRecordsResponseSchema", () => {
  const validResponse = {
    schema_version: "1.0" as const,
    status: "ok" as const,
    depth: "summary" as const,
    resources: [],
    count: 0,
    meta: {
      total_available: 10,
      filtered_count: 5,
      query_matched: true,
    },
  };

  it("accepts minimal valid response", () => {
    expect(ReadHealthRecordsResponseSchema.parse(validResponse)).toEqual(validResponse);
  });

  it("requires schema_version to be '1.0'", () => {
    expect(() =>
      ReadHealthRecordsResponseSchema.parse({ ...validResponse, schema_version: "2.0" }),
    ).toThrow();
  });

  it("rejects missing schema_version", () => {
    const { schema_version: _, ...rest } = validResponse;
    expect(() => ReadHealthRecordsResponseSchema.parse(rest)).toThrow();
  });

  it("accepts all status values", () => {
    for (const status of ["ok", "denied", "timeout", "error"]) {
      expect(
        ReadHealthRecordsResponseSchema.parse({ ...validResponse, status }),
      ).toBeTruthy();
    }
  });

  it("rejects count exceeding 50", () => {
    expect(() =>
      ReadHealthRecordsResponseSchema.parse({ ...validResponse, count: 51 }),
    ).toThrow();
  });

  it("accepts count of 50", () => {
    expect(
      ReadHealthRecordsResponseSchema.parse({ ...validResponse, count: 50 }).count,
    ).toBe(50);
  });

  it("accepts optional message", () => {
    const result = ReadHealthRecordsResponseSchema.parse({
      ...validResponse,
      message: "Success",
    });
    expect(result.message).toBe("Success");
  });

  it("accepts optional error object", () => {
    const result = ReadHealthRecordsResponseSchema.parse({
      ...validResponse,
      status: "error",
      error: {
        code: "INTERNAL_ERROR",
        message: "Something failed",
        retryable: false,
      },
    });
    expect(result.error?.code).toBe("INTERNAL_ERROR");
    expect(result.error?.retryable).toBe(false);
  });

  it("accepts response with resources", () => {
    const result = ReadHealthRecordsResponseSchema.parse({
      ...validResponse,
      count: 1,
      resources: [
        {
          resource_type: "Observation",
          count: 1,
          data: [{ id: "obs-1", value: 120, unit: "mg/dL" }],
        },
      ],
    });
    expect(result.resources).toHaveLength(1);
  });

  it("requires meta object", () => {
    const { meta: _, ...rest } = validResponse;
    expect(() => ReadHealthRecordsResponseSchema.parse(rest)).toThrow();
  });
});

describe("AuditResultSchema", () => {
  it.each(["approved", "denied", "timeout", "error"])("accepts '%s'", (v) => {
    expect(AuditResultSchema.parse(v)).toBe(v);
  });

  it("rejects 'pending'", () => {
    expect(() => AuditResultSchema.parse("pending")).toThrow();
  });
});

describe("PermissionLevelSchema", () => {
  it.each(["one-time", "always"])("accepts '%s'", (v) => {
    expect(PermissionLevelSchema.parse(v)).toBe(v);
  });

  it("rejects 'session'", () => {
    expect(() => PermissionLevelSchema.parse("session")).toThrow();
  });
});

describe("AuditLogEntrySchema", () => {
  const validEntry = {
    id: "audit-1",
    timestamp: "2024-06-15T12:00:00Z",
    ai_provider: "chatgpt",
    resource_types: ["Observation"],
    depth: "summary",
    result: "approved",
    permission_level: "one-time",
  };

  it("accepts minimal valid entry", () => {
    expect(AuditLogEntrySchema.parse(validEntry)).toEqual(validEntry);
  });

  it("accepts entry with all optional fields", () => {
    const full = {
      ...validEntry,
      requested_resource_counts: { Observation: 5 },
      shared_resource_types: ["Observation"],
      shared_resource_counts: { Observation: 3 },
      reason: "User approved sharing",
    };
    const result = AuditLogEntrySchema.parse(full);
    expect(result.reason).toBe("User approved sharing");
    expect(result.shared_resource_types).toEqual(["Observation"]);
  });

  it("rejects missing id", () => {
    const { id: _, ...rest } = validEntry;
    expect(() => AuditLogEntrySchema.parse(rest)).toThrow();
  });

  it("rejects invalid timestamp format", () => {
    expect(() =>
      AuditLogEntrySchema.parse({ ...validEntry, timestamp: "not-a-datetime" }),
    ).toThrow();
  });

  it("rejects invalid ai_provider", () => {
    expect(() =>
      AuditLogEntrySchema.parse({ ...validEntry, ai_provider: "bard" }),
    ).toThrow();
  });

  it("rejects invalid result", () => {
    expect(() =>
      AuditLogEntrySchema.parse({ ...validEntry, result: "pending" }),
    ).toThrow();
  });

  it("rejects invalid permission_level", () => {
    expect(() =>
      AuditLogEntrySchema.parse({ ...validEntry, permission_level: "session" }),
    ).toThrow();
  });

  it("accepts all depth values", () => {
    for (const depth of ["codes", "summary", "detail"]) {
      expect(AuditLogEntrySchema.parse({ ...validEntry, depth })).toBeTruthy();
    }
  });
});

describe("buildMcpErrorResponse", () => {
  it("returns valid ReadHealthRecordsResponse", () => {
    const result = buildMcpErrorResponse("summary", "INTERNAL_ERROR", "fail", true);
    expect(() => ReadHealthRecordsResponseSchema.parse(result)).not.toThrow();
  });

  it("sets status to 'error'", () => {
    const result = buildMcpErrorResponse("summary", "INTERNAL_ERROR", "fail", true);
    expect(result.status).toBe("error");
  });

  it("sets schema_version to '1.0'", () => {
    const result = buildMcpErrorResponse("summary", "INTERNAL_ERROR", "fail", true);
    expect(result.schema_version).toBe("1.0");
  });

  it("sets depth from argument", () => {
    const result = buildMcpErrorResponse("detail", "INTERNAL_ERROR", "fail", true);
    expect(result.depth).toBe("detail");
  });

  it("sets error code from argument", () => {
    const result = buildMcpErrorResponse("summary", "LOCKED_SESSION", "locked", false);
    expect(result.error?.code).toBe("LOCKED_SESSION");
  });

  it("sets error message from argument", () => {
    const result = buildMcpErrorResponse("summary", "INTERNAL_ERROR", "custom msg", true);
    expect(result.error?.message).toBe("custom msg");
    expect(result.message).toBe("custom msg");
  });

  it("sets retryable flag", () => {
    expect(buildMcpErrorResponse("summary", "NETWORK_UNAVAILABLE", "m", true).error?.retryable).toBe(true);
    expect(buildMcpErrorResponse("summary", "INVALID_REQUEST", "m", false).error?.retryable).toBe(false);
  });

  it("returns empty resources and zero count", () => {
    const result = buildMcpErrorResponse("summary", "INTERNAL_ERROR", "fail", true);
    expect(result.resources).toEqual([]);
    expect(result.count).toBe(0);
  });

  it("returns zeroed meta", () => {
    const result = buildMcpErrorResponse("summary", "INTERNAL_ERROR", "fail", true);
    expect(result.meta).toEqual({
      total_available: 0,
      filtered_count: 0,
      query_matched: false,
    });
  });

  it.each([
    "LOCKED_SESSION",
    "SETUP_REQUIRED",
    "APPROVAL_TIMEOUT",
    "CONTENT_SCRIPT_UNAVAILABLE",
    "CONTENT_SCRIPT_RENDER_FAILED",
    "NETWORK_UNAVAILABLE",
    "INVALID_REQUEST",
    "INTERNAL_ERROR",
  ] as const)("produces valid response for code '%s'", (code) => {
    const result = buildMcpErrorResponse("codes", code, `error: ${code}`, true);
    expect(() => ReadHealthRecordsResponseSchema.parse(result)).not.toThrow();
    expect(result.error?.code).toBe(code);
  });
});

describe("buildMcpDeniedResponse", () => {
  it("returns valid ReadHealthRecordsResponse", () => {
    const result = buildMcpDeniedResponse("summary");
    expect(() => ReadHealthRecordsResponseSchema.parse(result)).not.toThrow();
  });

  it("sets status to 'denied'", () => {
    expect(buildMcpDeniedResponse("summary").status).toBe("denied");
  });

  it("sets Korean denied message", () => {
    expect(buildMcpDeniedResponse("summary").message).toBe("요청이 거절되었습니다.");
  });

  it("sets depth from argument", () => {
    expect(buildMcpDeniedResponse("detail").depth).toBe("detail");
  });

  it("has no error object", () => {
    expect(buildMcpDeniedResponse("summary").error).toBeUndefined();
  });

  it("returns empty resources and zero count", () => {
    const result = buildMcpDeniedResponse("codes");
    expect(result.resources).toEqual([]);
    expect(result.count).toBe(0);
  });
});

describe("buildMcpTimeoutResponse", () => {
  it("returns valid ReadHealthRecordsResponse", () => {
    const result = buildMcpTimeoutResponse("summary");
    expect(() => ReadHealthRecordsResponseSchema.parse(result)).not.toThrow();
  });

  it("sets status to 'timeout'", () => {
    expect(buildMcpTimeoutResponse("summary").status).toBe("timeout");
  });

  it("sets Korean timeout message", () => {
    expect(buildMcpTimeoutResponse("summary").message).toBe("요청 시간이 초과되었습니다.");
  });

  it("sets depth from argument", () => {
    expect(buildMcpTimeoutResponse("codes").depth).toBe("codes");
  });

  it("has no error object", () => {
    expect(buildMcpTimeoutResponse("summary").error).toBeUndefined();
  });

  it("returns empty resources and zero count", () => {
    const result = buildMcpTimeoutResponse("detail");
    expect(result.resources).toEqual([]);
    expect(result.count).toBe(0);
  });
});
