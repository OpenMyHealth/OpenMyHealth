export type AIPlatform = "chatgpt" | "gemini" | "claude";

export type RecordType =
  | "condition"
  | "medication"
  | "procedure"
  | "claim"
  | "observation"
  | "document";

export interface FhirCoding {
  system: string;
  code: string;
  display?: string;
}

export interface FhirResource {
  resourceType: string;
  id?: string;
  code?: {
    coding?: FhirCoding[];
    text?: string;
  };
  [key: string]: unknown;
}

export interface RawSourceRecord {
  sourcePath: string;
  payload: Record<string, unknown>;
}

export interface NormalizedRecord {
  id: string;
  sourceId: string;
  sourceName: string;
  type: RecordType;
  date: string;
  title: string;
  summary: string;
  tags: string[];
  fhir: FhirResource;
  raw: Record<string, unknown>;
  embedding?: Int8Array;
}

export interface SourceSyncState {
  sourceId: string;
  sourceName: string;
  lastSyncedAt: string | null;
  recordCount: number;
}

export interface VaultPayload {
  version: number;
  records: NormalizedRecord[];
  sources: SourceSyncState[];
  transferAudits: TransferAudit[];
}

export interface TransferAudit {
  id: string;
  createdAt: string;
  platform: AIPlatform | "unknown";
  query: string;
  recordIds: string[];
  recordCount: number;
  redactionCount: number;
}

export interface SourceGuideStep {
  id: string;
  title: string;
  description: string;
  selector?: string;
  optional?: boolean;
}

export interface SourceStatus {
  sourceId: string;
  supported: boolean;
  url: string;
  stepState: Record<string, boolean>;
  estimatedRecordCount?: number;
}

export interface SourceAdapter {
  id: string;
  country: string;
  name: string;
  description: string;
  entryUrl: string;
  match: RegExp[];
  guideSteps: SourceGuideStep[];
  detectStepState(document: Document): Record<string, boolean>;
  parseRawRecords(document: Document): RawSourceRecord[];
  normalize(records: RawSourceRecord[]): NormalizedRecord[];
}

export interface SearchCandidate {
  id: string;
  score: number;
  lexicalScore: number;
  denseScore: number;
  recencyBoost: number;
  title: string;
  summary: string;
  date: string;
  sourceName: string;
  type: RecordType;
}

export interface ApprovalPreview {
  ids: string[];
  query: string;
  contextText: string;
  redactionCount: number;
}

export interface AppState {
  vaultInitialized: boolean;
  unlocked: boolean;
  sourceSync: SourceSyncState[];
  recentTransfers: TransferAudit[];
  adapters: Array<{
    id: string;
    country: string;
    name: string;
    description: string;
    connected: boolean;
    lastSyncedAt: string | null;
    recordCount: number;
  }>;
  activeSourceStatus: SourceStatus | null;
  lastAiPlatform: AIPlatform | null;
}
