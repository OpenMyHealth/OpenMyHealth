import type { AIPlatform, ApprovalPreview, AppState, SearchCandidate, SourceStatus } from "./types";

export type RuntimeMessage =
  | { type: "OMH_GET_APP_STATE" }
  | { type: "OMH_SET_PASSPHRASE"; passphrase: string }
  | { type: "OMH_UNLOCK_VAULT"; passphrase: string }
  | { type: "OMH_LOCK_VAULT" }
  | { type: "OMH_START_SOURCE_GUIDE"; sourceId: string }
  | { type: "OMH_GET_ACTIVE_SOURCE_STATUS" }
  | { type: "OMH_CAPTURE_ACTIVE_SOURCE"; sourceId: string }
  | { type: "OMH_SEARCH_CANDIDATES"; query: string; limit?: number }
  | { type: "OMH_BUILD_APPROVAL_PREVIEW"; query: string; ids: string[] }
  | { type: "OMH_INSERT_CONTEXT_TO_CHAT"; preview: ApprovalPreview }
  | {
      type: "OMH_ADD_MANUAL_RECORD";
      input: {
        title: string;
        summary: string;
        date: string;
        tags: string[];
      };
    }
  | { type: "OMH_DELETE_RECORD"; id: string }
  | { type: "OMH_LIST_RECORDS"; limit?: number }
  | { type: "OMH_AI_PAGE_READY"; platform: AIPlatform }
  | { type: "OMH_SOURCE_PAGE_READY" }
  | { type: "OMH_GET_SOURCE_STATUS"; sourceId: string }
  | { type: "OMH_CAPTURE_SOURCE_PAGE"; sourceId: string }
  | { type: "OMH_INSERT_CONTEXT"; payload: { contextText: string; query: string } };

export type RuntimeResponse =
  | { ok: true; state: AppState }
  | { ok: true; unlocked: boolean }
  | { ok: true; sourceStatus: SourceStatus | null }
  | { ok: true; candidates: SearchCandidate[] }
  | { ok: true; preview: ApprovalPreview }
  | { ok: true; inserted: boolean }
  | { ok: true; records: Array<{ id: string; title: string; date: string; sourceName: string; type: string }> }
  | { ok: true; capturedCount: number }
  | { ok: true; deleted: boolean }
  | { ok: true; message: string }
  | { ok: false; error: string };
