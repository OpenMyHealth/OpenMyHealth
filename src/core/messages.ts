import type {
  AiProvider,
  PermissionLevel,
  ReadHealthRecordsResponse,
  ReadHealthRecordsRequest,
  ResourceType,
} from "../../packages/contracts/src/index";
import type {
  AuditEntry,
  McpApprovalRequest,
  PublicAppSettings,
  VaultPermissionScope,
  VaultFileSummary,
} from "./models";

export type RuntimeRequest =
  | { type: "runtime:ping" }
  | { type: "vault:get-state" }
  | { type: "session:setup-pin"; pin: string; locale: string }
  | { type: "session:unlock"; pin: string }
  | { type: "session:lock" }
  | {
      type: "vault:upload-file";
      name: string;
      mimeType: string;
      size: number;
      bytes: string;
    }
  | { type: "vault:download-file"; fileId: string }
  | { type: "vault:delete-file"; fileId: string }
  | { type: "vault:list-files" }
  | { type: "vault:list-audit-logs"; limit?: number }
  | { type: "vault:list-permissions" }
  | { type: "vault:revoke-permission"; key: string }
  | { type: "vault:set-provider"; provider: AiProvider }
  | {
      type: "mcp:enqueue-request";
      provider: AiProvider;
      resourceTypes: ReadHealthRecordsRequest["resource_types"];
      depth: ReadHealthRecordsRequest["depth"];
      query?: ReadHealthRecordsRequest["query"];
      dateFrom?: ReadHealthRecordsRequest["date_from"];
      dateTo?: ReadHealthRecordsRequest["date_to"];
      allowAlways?: boolean;
      awaitResult?: boolean;
    }
  | {
      type: "approval:decision";
      requestId: string;
      decision: "approved" | "denied";
      selectedResourceTypes?: ResourceType[];
      selectedItemIds?: string[];
      permissionLevel?: PermissionLevel;
    }
  | { type: "overlay:ready"; provider: AiProvider }
  | { type: "overlay:approval-rendered"; requestId: string }
  | { type: "overlay:render-failed"; requestId: string }
  | { type: "overlay:open-vault" };

export interface UnlockSessionResponse {
  ok: true;
  isUnlocked: boolean;
  lockoutUntil: number | null;
}

export interface VaultStateResponse {
  ok: true;
  settings: PublicAppSettings;
  session: { isUnlocked: boolean; hasPin: boolean; lockoutUntil: number | null };
  files: VaultFileSummary[];
  auditLogs: AuditEntry[];
  summary: Partial<Record<ResourceType, number>>;
}

export type RuntimeResponse =
  | { ok: true; service: "background"; mode: "dev" | "prod"; version: string }
  | VaultStateResponse
  | UnlockSessionResponse
  | { ok: true; uploaded: VaultFileSummary }
  | { ok: true; file: { name: string; mimeType: string; bytes: string } }
  | { ok: true; deletedFileId: string }
  | { ok: true; files: VaultFileSummary[] }
  | { ok: true; logs: AuditEntry[] }
  | { ok: true; permissions: VaultPermissionScope[] }
  | { ok: true; provider: AiProvider }
  | { ok: true; requestId: string; queued: true }
  | { ok: true; result: ReadHealthRecordsResponse }
  | { ok: true; status: "approved" | "denied" | "error" }
  | { ok: true }
  | { ok: false; error: string; lockoutUntil?: number | null };

export type OverlayEvent =
  | {
      type: "overlay:show-approval";
      request: McpApprovalRequest;
      queueLength: number;
    }
  | {
      type: "overlay:update-approval";
      request: McpApprovalRequest;
      queueLength: number;
    }
  | {
      type: "overlay:request-unlock";
      request: McpApprovalRequest;
      queueLength: number;
      lockoutUntil: number | null;
    }
  | { type: "overlay:connection-success"; provider: AiProvider }
  | { type: "overlay:ping" }
  | { type: "overlay:resolved"; requestId: string; status: "approved" | "denied" | "timeout" | "error" }
  | { type: "overlay:queue"; queueLength: number };
