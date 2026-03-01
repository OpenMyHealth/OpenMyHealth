import type {
  AiProvider,
  McpDepth,
  ResourceType,
} from "../../../packages/contracts/src/index";
import type { VaultPermissionScope } from "../models";
import type { AlwaysAllowScope } from "./state";

export function permissionKey(scope: AlwaysAllowScope): string {
  const normalizedQuery = scope.query?.trim().toLowerCase() ?? "";
  const normalizedFrom = scope.dateFrom?.trim() ?? "";
  const normalizedTo = scope.dateTo?.trim() ?? "";
  return [
    "v2",
    scope.provider,
    scope.resourceType,
    scope.depth,
    `q:${encodeURIComponent(normalizedQuery)}`,
    `from:${encodeURIComponent(normalizedFrom)}`,
    `to:${encodeURIComponent(normalizedTo)}`,
  ].join("|");
}

export function legacyPermissionKey(scope: Omit<AlwaysAllowScope, "query" | "dateFrom" | "dateTo">): string {
  return [
    scope.provider,
    scope.resourceType,
    scope.depth,
  ].join("|");
}

export function decodeSegment(value: string | undefined): string {
  if (!value) {
    return "";
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function asProvider(value: string): AiProvider | null {
  if (value === "chatgpt" || value === "claude" || value === "gemini") {
    return value;
  }
  return null;
}

export function asDepth(value: string): McpDepth | null {
  if (value === "codes" || value === "summary" || value === "detail") {
    return value;
  }
  return null;
}

export function asResourceType(value: string): ResourceType | null {
  if (
    value === "Observation"
    || value === "MedicationStatement"
    || value === "Condition"
    || value === "DiagnosticReport"
    || value === "DocumentReference"
  ) {
    return value;
  }
  return null;
}

export function parsePermissionScope(key: string): VaultPermissionScope | null {
  const parts = key.split("|");
  if (parts[0] === "v2" && parts.length === 7) {
    const provider = asProvider(parts[1]);
    const resourceType = asResourceType(parts[2]);
    const depth = asDepth(parts[3]);
    if (!provider || !resourceType || !depth) {
      return null;
    }
    const query = decodeSegment(parts[4].replace(/^q:/, ""));
    const dateFrom = decodeSegment(parts[5].replace(/^from:/, ""));
    const dateTo = decodeSegment(parts[6].replace(/^to:/, ""));
    return {
      key,
      provider,
      resourceType,
      depth,
      query: query || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      legacy: false,
    };
  }

  if (parts.length === 3) {
    const provider = asProvider(parts[0]);
    const resourceType = asResourceType(parts[1]);
    const depth = asDepth(parts[2]);
    if (!provider || !resourceType || !depth) {
      return null;
    }
    return {
      key,
      provider,
      resourceType,
      depth,
      legacy: true,
    };
  }
  return null;
}
