import { z } from "zod";

export const MAX_RECORDS_PER_RESPONSE = 50;

export const AiProviderSchema = z.enum(["chatgpt", "claude", "gemini"]);
export type AiProvider = z.infer<typeof AiProviderSchema>;

export const ResourceTypeSchema = z.enum([
  "Observation",
  "MedicationStatement",
  "Condition",
  "DiagnosticReport",
  "DocumentReference",
]);
export type ResourceType = z.infer<typeof ResourceTypeSchema>;

export const ResourceCountMapSchema = z.object({
  Observation: z.number().int().nonnegative().optional(),
  MedicationStatement: z.number().int().nonnegative().optional(),
  Condition: z.number().int().nonnegative().optional(),
  DiagnosticReport: z.number().int().nonnegative().optional(),
  DocumentReference: z.number().int().nonnegative().optional(),
});
export type ResourceCountMap = z.infer<typeof ResourceCountMapSchema>;

export const McpDepthSchema = z.enum(["codes", "summary", "detail"]);
export type McpDepth = z.infer<typeof McpDepthSchema>;

export const McpStatusSchema = z.enum(["ok", "denied", "timeout", "error"]);
export type McpStatus = z.infer<typeof McpStatusSchema>;

export const McpErrorCodeSchema = z.enum([
  "LOCKED_SESSION",
  "SETUP_REQUIRED",
  "APPROVAL_TIMEOUT",
  "CONTENT_SCRIPT_UNAVAILABLE",
  "CONTENT_SCRIPT_RENDER_FAILED",
  "NETWORK_UNAVAILABLE",
  "INVALID_REQUEST",
  "INTERNAL_ERROR",
]);
export type McpErrorCode = z.infer<typeof McpErrorCodeSchema>;

const IsoDateSchema = z.string().refine(
  (val) => !Number.isNaN(Date.parse(val)),
  { message: "ISO 8601 date or datetime expected" },
);

export const ReadHealthRecordsRequestSchema = z.object({
  resource_types: z.array(ResourceTypeSchema).min(1),
  query: z.string().trim().min(1).max(500).optional(),
  date_from: IsoDateSchema.optional(),
  date_to: IsoDateSchema.optional(),
  depth: McpDepthSchema,
  limit: z.number().int().positive().max(MAX_RECORDS_PER_RESPONSE).default(MAX_RECORDS_PER_RESPONSE),
});
export type ReadHealthRecordsRequest = z.infer<typeof ReadHealthRecordsRequestSchema>;

export const McpDataRecordSchema = z.object({
  id: z.string(),
  code: z.string().optional(),
  system: z.string().optional(),
  display: z.string().optional(),
  value: z.union([z.number(), z.string()]).optional(),
  unit: z.string().optional(),
  date: z.string().optional(),
  flag: z.enum(["low", "high", "normal", "unknown"]).optional(),
  reference_range: z
    .object({
      low: z.number().optional(),
      high: z.number().optional(),
    })
    .optional(),
  performer: z.string().optional(),
  notes: z.string().optional(),
});
export type McpDataRecord = z.infer<typeof McpDataRecordSchema>;

export const McpResourceResultSchema = z.object({
  resource_type: ResourceTypeSchema,
  count: z.number().int().nonnegative(),
  data: z.array(McpDataRecordSchema),
});
export type McpResourceResult = z.infer<typeof McpResourceResultSchema>;

export const ReadHealthRecordsResponseSchema = z.object({
  schema_version: z.literal("1.0"),
  status: McpStatusSchema,
  depth: McpDepthSchema,
  resources: z.array(McpResourceResultSchema),
  count: z.number().int().nonnegative().max(MAX_RECORDS_PER_RESPONSE),
  message: z.string().optional(),
  meta: z.object({
    total_available: z.number().int().nonnegative(),
    filtered_count: z.number().int().nonnegative(),
    query_matched: z.boolean(),
  }),
  error: z
    .object({
      code: McpErrorCodeSchema,
      message: z.string(),
      retryable: z.boolean(),
    })
    .optional(),
});
export type ReadHealthRecordsResponse = z.infer<typeof ReadHealthRecordsResponseSchema>;

export function buildMcpErrorResponse(
  depth: McpDepth,
  code: McpErrorCode,
  message: string,
  retryable: boolean,
): ReadHealthRecordsResponse {
  return {
    schema_version: "1.0",
    status: "error",
    depth,
    resources: [],
    count: 0,
    message,
    meta: {
      total_available: 0,
      filtered_count: 0,
      query_matched: false,
    },
    error: {
      code,
      message,
      retryable,
    },
  };
}

export function buildMcpDeniedResponse(depth: McpDepth): ReadHealthRecordsResponse {
  return {
    schema_version: "1.0",
    status: "denied",
    depth,
    resources: [],
    count: 0,
    message: "요청이 거절되었습니다.",
    meta: {
      total_available: 0,
      filtered_count: 0,
      query_matched: false,
    },
  };
}

export function buildMcpTimeoutResponse(depth: McpDepth): ReadHealthRecordsResponse {
  return {
    schema_version: "1.0",
    status: "timeout",
    depth,
    resources: [],
    count: 0,
    message: "요청 시간이 초과되었습니다.",
    meta: {
      total_available: 0,
      filtered_count: 0,
      query_matched: false,
    },
  };
}

export const AuditResultSchema = z.enum(["approved", "denied", "timeout", "error"]);
export type AuditResult = z.infer<typeof AuditResultSchema>;

// Spec label is "always"; implementation can scope it to current session by policy.
export const PermissionLevelSchema = z.enum(["one-time", "always"]);
export type PermissionLevel = z.infer<typeof PermissionLevelSchema>;

export const AuditLogEntrySchema = z.object({
  id: z.string(),
  timestamp: z.string().datetime(),
  ai_provider: AiProviderSchema,
  // Requested resource types shown on approval card.
  resource_types: z.array(ResourceTypeSchema),
  requested_resource_counts: ResourceCountMapSchema.optional(),
  // Actual shared subset after user selection (when approved).
  shared_resource_types: z.array(ResourceTypeSchema).optional(),
  shared_resource_counts: ResourceCountMapSchema.optional(),
  depth: McpDepthSchema,
  result: AuditResultSchema,
  permission_level: PermissionLevelSchema,
  reason: z.string().optional(),
});
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;
