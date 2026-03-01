import type {
  AiProvider,
  AuditLogEntry,
  McpDataRecord,
  McpDepth,
  PermissionLevel,
  ResourceType,
} from "../../packages/contracts/src/index";

export interface EncryptedEnvelope {
  keyVersion: number;
  iv: string;
  ciphertext: string;
  aad?: string;
}

export interface PinConfig {
  salt: string;
  verifier: string;
}

export interface PinLockoutState {
  failedAttempts: number;
  lockUntil: number | null;
}

export interface VaultMetaRecord<T = unknown> {
  key: string;
  value: T;
  updatedAt: string;
}

export interface StoredFileRecord {
  id: string;
  schemaVersion: number;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
  status: "processing" | "done" | "error";
  matchedCounts: Partial<Record<ResourceType, number>>;
  encryptedBlob: EncryptedEnvelope;
}

export interface VaultFileSummary {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
  status: "processing" | "done" | "error";
  matchedCounts: Partial<Record<ResourceType, number>>;
}

export interface StoredResourceRecord {
  id: string;
  schemaVersion: number;
  fileId: string;
  resourceType: ResourceType;
  createdAt: string;
  date: string | null;
  encryptedPayload: EncryptedEnvelope;
}

export interface StoredEmbeddingRecord {
  id: string;
  resourceId: string;
  dims: number;
  vector: number[];
  createdAt: string;
}

export interface AppSettings {
  locale: string;
  schemaVersion: number;
  pinConfig: PinConfig | null;
  lockout: PinLockoutState;
  connectedProvider: AiProvider | null;
  alwaysAllowScopes: string[];
  integrationWarning: string | null;
}

export type PublicAppSettings = Omit<AppSettings, "pinConfig" | "alwaysAllowScopes">;

export interface VaultPermissionScope {
  key: string;
  provider: AiProvider;
  resourceType: ResourceType;
  depth: McpDepth;
  query?: string;
  dateFrom?: string;
  dateTo?: string;
  legacy: boolean;
}

export interface ResourceDraft {
  resourceType: ResourceType;
  date: string | null;
  payload: McpDataRecord;
}

export interface UploadPipelineResult {
  resources: ResourceDraft[];
  matchedCounts: Partial<Record<ResourceType, number>>;
  preview: string;
}

export interface ApprovalItemOption {
  id: string;
  label: string;
}

export interface ApprovalResourceOption {
  resourceType: ResourceType;
  count: number;
  items: ApprovalItemOption[];
}

export interface McpApprovalRequest {
  id: string;
  provider: AiProvider;
  resourceTypes: ResourceType[];
  depth: McpDepth;
  query?: string;
  dateFrom?: string;
  dateTo?: string;
  aiDescription: string;
  extensionSummary: string;
  resourceOptions?: ApprovalResourceOption[];
  createdAt: string;
  deadlineAt: number;
}

export interface ApprovalDecision {
  requestId: string;
  decision: "approved" | "denied";
  selectedResourceTypes?: ResourceType[];
  permissionLevel?: PermissionLevel;
}

export type AuditEntry = AuditLogEntry;
