import {
  permissionKey,
  legacyPermissionKey,
  decodeSegment,
  asProvider,
  asDepth,
  asResourceType,
  parsePermissionScope,
} from "./permission-scope";
import type { AlwaysAllowScope } from "./state";

describe("permissionKey", () => {
  it("produces correct v2 format for a basic scope", () => {
    const scope: AlwaysAllowScope = {
      provider: "chatgpt",
      resourceType: "Observation",
      depth: "summary",
    };
    const key = permissionKey(scope);
    expect(key).toBe("v2|chatgpt|Observation|summary|q:|from:|to:");
  });

  it("encodes query", () => {
    const scope: AlwaysAllowScope = {
      provider: "claude",
      resourceType: "Condition",
      depth: "detail",
      query: "blood pressure",
    };
    const key = permissionKey(scope);
    expect(key).toContain("q:blood%20pressure");
  });

  it("encodes special characters in query via encodeURIComponent", () => {
    const scope: AlwaysAllowScope = {
      provider: "chatgpt",
      resourceType: "Observation",
      depth: "codes",
      query: "a&b=c",
    };
    const key = permissionKey(scope);
    expect(key).toContain("q:a%26b%3Dc");
  });

  it("includes dateFrom and dateTo", () => {
    const scope: AlwaysAllowScope = {
      provider: "chatgpt",
      resourceType: "Observation",
      depth: "summary",
      dateFrom: "2024-01-01",
      dateTo: "2024-12-31",
    };
    const key = permissionKey(scope);
    expect(key).toContain("from:2024-01-01");
    expect(key).toContain("to:2024-12-31");
  });

  it("produces empty segments for optional fields", () => {
    const scope: AlwaysAllowScope = {
      provider: "gemini",
      resourceType: "MedicationStatement",
      depth: "codes",
    };
    const key = permissionKey(scope);
    expect(key).toBe("v2|gemini|MedicationStatement|codes|q:|from:|to:");
  });
});

describe("legacyPermissionKey", () => {
  it("produces 3-part key", () => {
    const key = legacyPermissionKey({
      provider: "chatgpt",
      resourceType: "Observation",
      depth: "summary",
    });
    expect(key).toBe("chatgpt|Observation|summary");
  });
});

describe("permissionKey + parsePermissionScope roundtrip (v2)", () => {
  it("roundtrips with all fields", () => {
    const scope: AlwaysAllowScope = {
      provider: "claude",
      resourceType: "Condition",
      depth: "detail",
      query: "diabetes",
      dateFrom: "2024-01-01",
      dateTo: "2024-06-30",
    };
    const key = permissionKey(scope);
    const parsed = parsePermissionScope(key);
    expect(parsed).not.toBeNull();
    expect(parsed!.provider).toBe("claude");
    expect(parsed!.resourceType).toBe("Condition");
    expect(parsed!.depth).toBe("detail");
    expect(parsed!.query).toBe("diabetes");
    expect(parsed!.dateFrom).toBe("2024-01-01");
    expect(parsed!.dateTo).toBe("2024-06-30");
    expect(parsed!.legacy).toBe(false);
  });
});

describe("legacyPermissionKey + parsePermissionScope roundtrip", () => {
  it("roundtrips legacy format", () => {
    const key = legacyPermissionKey({
      provider: "chatgpt",
      resourceType: "Observation",
      depth: "summary",
    });
    const parsed = parsePermissionScope(key);
    expect(parsed).not.toBeNull();
    expect(parsed!.provider).toBe("chatgpt");
    expect(parsed!.resourceType).toBe("Observation");
    expect(parsed!.depth).toBe("summary");
    expect(parsed!.legacy).toBe(true);
  });
});

describe("parsePermissionScope edge cases", () => {
  it("returns null for invalid format", () => {
    expect(parsePermissionScope("completely-invalid")).toBeNull();
  });

  it("returns null for wrong part count (4 parts)", () => {
    expect(parsePermissionScope("a|b|c|d")).toBeNull();
  });

  it("returns null for v2 with invalid provider", () => {
    expect(parsePermissionScope("v2|badprovider|Observation|summary|q:|from:|to:")).toBeNull();
  });

  it("returns null for v2 with invalid resourceType", () => {
    expect(parsePermissionScope("v2|chatgpt|Invalid|summary|q:|from:|to:")).toBeNull();
  });

  it("returns null for v2 with invalid depth", () => {
    expect(parsePermissionScope("v2|chatgpt|Observation|invalid|q:|from:|to:")).toBeNull();
  });

  it("returns null for legacy format with invalid depth", () => {
    expect(parsePermissionScope("chatgpt|Observation|invalid")).toBeNull();
  });
});

describe("decodeSegment", () => {
  it("decodes an encoded value", () => {
    expect(decodeSegment("hello%20world")).toBe("hello world");
  });

  it("returns empty string for undefined", () => {
    expect(decodeSegment(undefined)).toBe("");
  });

  it("returns raw value for malformed encoding", () => {
    expect(decodeSegment("%ZZ")).toBe("%ZZ");
  });
});

describe("asProvider", () => {
  it("returns chatgpt for 'chatgpt'", () => {
    expect(asProvider("chatgpt")).toBe("chatgpt");
  });

  it("returns claude for 'claude'", () => {
    expect(asProvider("claude")).toBe("claude");
  });

  it("returns gemini for 'gemini'", () => {
    expect(asProvider("gemini")).toBe("gemini");
  });

  it("returns null for invalid provider", () => {
    expect(asProvider("openai")).toBeNull();
  });
});

describe("asDepth", () => {
  it("returns codes for 'codes'", () => {
    expect(asDepth("codes")).toBe("codes");
  });

  it("returns summary for 'summary'", () => {
    expect(asDepth("summary")).toBe("summary");
  });

  it("returns detail for 'detail'", () => {
    expect(asDepth("detail")).toBe("detail");
  });

  it("returns null for invalid depth", () => {
    expect(asDepth("full")).toBeNull();
  });
});

describe("asResourceType", () => {
  it("returns valid resource types", () => {
    expect(asResourceType("Observation")).toBe("Observation");
    expect(asResourceType("MedicationStatement")).toBe("MedicationStatement");
    expect(asResourceType("Condition")).toBe("Condition");
    expect(asResourceType("DiagnosticReport")).toBe("DiagnosticReport");
    expect(asResourceType("DocumentReference")).toBe("DocumentReference");
  });

  it("returns null for invalid resource type", () => {
    expect(asResourceType("Patient")).toBeNull();
    expect(asResourceType("")).toBeNull();
  });
});
