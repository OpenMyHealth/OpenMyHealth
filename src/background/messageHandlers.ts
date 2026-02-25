import { APPROVAL_DEFAULT_LIMIT } from "../shared/constants";
import { findAdapterById } from "../shared/adapters";
import type { RuntimeMessage, RuntimeResponse } from "../shared/messages";
import type { AIPlatform, AppState, SourceStatus } from "../shared/types";
import { buildApprovalPreview } from "../shared/safety/contextBuilder";
import { searchRecords, ensureRecordEmbedding } from "../shared/retrieval/search";
import { normalizeDate } from "../shared/utils/date";
import type { VaultStore } from "../shared/storage/vaultStore";

export interface MessageHandlerDependencies {
  vault: VaultStore;
  getAppState: () => Promise<AppState>;
  getActiveSourceStatus: () => Promise<SourceStatus | null>;
  getActiveTab: () => Promise<chrome.tabs.Tab | null>;
  sendToTab: <T>(tabId: number, message: RuntimeMessage) => Promise<T>;
  openSidePanel: (tabId: number) => Promise<void>;
  resolveTargetAiTabId: () => Promise<number | null>;
  getLastAiPlatform: () => AIPlatform | null;
  setLastAiContext: (tabId: number, platform: AIPlatform) => void;
}

function ok<T extends object>(payload: T): RuntimeResponse {
  return { ok: true, ...payload } as unknown as RuntimeResponse;
}

export function failRuntimeResponse(error: unknown): RuntimeResponse {
  if (error instanceof Error) {
    return { ok: false, error: error.message };
  }
  return { ok: false, error: String(error) };
}

export function createRuntimeMessageHandler(deps: MessageHandlerDependencies) {
  return async (message: RuntimeMessage, sender: chrome.runtime.MessageSender): Promise<RuntimeResponse> => {
    switch (message.type) {
      case "OMH_GET_APP_STATE": {
        return ok({ state: await deps.getAppState() });
      }

      case "OMH_SET_PASSPHRASE": {
        await deps.vault.setPassphrase(message.passphrase);
        return ok({ unlocked: true });
      }

      case "OMH_UNLOCK_VAULT": {
        const unlocked = await deps.vault.unlock(message.passphrase);
        return ok({ unlocked });
      }

      case "OMH_LOCK_VAULT": {
        deps.vault.lock();
        return ok({ unlocked: false });
      }

      case "OMH_START_SOURCE_GUIDE": {
        const adapter = findAdapterById(message.sourceId);
        if (!adapter) {
          return failRuntimeResponse(new Error("지원되지 않는 소스입니다."));
        }

        const activeTab = await deps.getActiveTab();
        if (!activeTab?.id) {
          return failRuntimeResponse(new Error("활성 탭을 찾을 수 없습니다."));
        }

        await chrome.tabs.update(activeTab.id, { url: adapter.entryUrl });
        await deps.openSidePanel(activeTab.id);
        return ok({ message: "소스 가이드를 시작했습니다." });
      }

      case "OMH_GET_ACTIVE_SOURCE_STATUS": {
        return ok({ sourceStatus: await deps.getActiveSourceStatus() });
      }

      case "OMH_CAPTURE_ACTIVE_SOURCE": {
        if (!deps.vault.isUnlocked()) {
          return failRuntimeResponse(new Error("금고가 잠겨 있습니다. 먼저 잠금을 해제하세요."));
        }

        const adapter = findAdapterById(message.sourceId);
        if (!adapter) {
          return failRuntimeResponse(new Error("지원되지 않는 소스입니다."));
        }

        const tab = await deps.getActiveTab();
        if (!tab?.id) {
          return failRuntimeResponse(new Error("활성 탭을 찾을 수 없습니다."));
        }

        const capture = await deps.sendToTab<{
          ok: boolean;
          records?: Array<{ sourcePath: string; payload: Record<string, unknown> }>;
          error?: string;
        }>(tab.id, {
          type: "OMH_CAPTURE_SOURCE_PAGE",
          sourceId: adapter.id,
        });

        if (!capture.ok || !capture.records) {
          return failRuntimeResponse(new Error(capture.error || "페이지 데이터를 읽지 못했습니다."));
        }

        const normalized = adapter.normalize(capture.records).map((record) => ensureRecordEmbedding(record));
        const capturedCount = await deps.vault.upsertRecords(adapter.id, adapter.name, normalized);
        return ok({ capturedCount });
      }

      case "OMH_SEARCH_CANDIDATES": {
        if (!deps.vault.isUnlocked()) {
          return failRuntimeResponse(new Error("금고가 잠겨 있습니다."));
        }

        const payload = await deps.vault.getPayload();
        const limit = message.limit ?? APPROVAL_DEFAULT_LIMIT;
        const records = payload.records.map((record) => ensureRecordEmbedding(record));
        const candidates = searchRecords(message.query, records, limit);
        return ok({ candidates });
      }

      case "OMH_BUILD_APPROVAL_PREVIEW": {
        if (!deps.vault.isUnlocked()) {
          return failRuntimeResponse(new Error("금고가 잠겨 있습니다."));
        }

        const payload = await deps.vault.getPayload();
        const selected = payload.records.filter((record) => message.ids.includes(record.id));
        if (!selected.length) {
          return failRuntimeResponse(new Error("선택된 레코드가 없습니다."));
        }

        const preview = buildApprovalPreview(message.query, selected);
        return ok({ preview });
      }

      case "OMH_INSERT_CONTEXT_TO_CHAT": {
        const targetTabId = await deps.resolveTargetAiTabId();
        if (!targetTabId) {
          return failRuntimeResponse(new Error("AI 채팅 탭을 찾을 수 없습니다."));
        }

        const response = await deps.sendToTab<{ ok: boolean; inserted?: boolean; error?: string }>(targetTabId, {
          type: "OMH_INSERT_CONTEXT",
          payload: {
            contextText: message.preview.contextText,
            query: message.preview.query,
          },
        });

        if (!response.ok) {
          return failRuntimeResponse(new Error(response.error || "채팅 입력창에 컨텍스트를 넣지 못했습니다."));
        }

        try {
          await deps.vault.appendTransferAudit({
            platform: deps.getLastAiPlatform() ?? "unknown",
            query: message.preview.query,
            recordIds: message.preview.ids,
            recordCount: message.preview.ids.length,
            redactionCount: message.preview.redactionCount,
          });
        } catch {
          // Non-fatal: context insertion should still succeed even when audit append fails.
        }

        return ok({ inserted: Boolean(response.inserted) });
      }

      case "OMH_ADD_MANUAL_RECORD": {
        if (!deps.vault.isUnlocked()) {
          return failRuntimeResponse(new Error("금고가 잠겨 있습니다."));
        }

        const title = message.input.title.trim();
        const summary = message.input.summary.trim();
        const date = normalizeDate(message.input.date.trim()) || new Date().toISOString().slice(0, 10);
        if (!title || !summary) {
          return failRuntimeResponse(new Error("제목과 내용을 입력하세요."));
        }

        await deps.vault.addManualRecord({
          title,
          summary,
          date,
          tags: message.input.tags,
        });
        return ok({ message: "수동 기록이 저장되었습니다." });
      }

      case "OMH_LIST_RECORDS": {
        if (!deps.vault.isUnlocked()) {
          return failRuntimeResponse(new Error("금고가 잠겨 있습니다."));
        }
        const records = await deps.vault.listRecords(message.limit ?? 30);
        return ok({
          records: records.map((record) => ({
            id: record.id,
            title: record.title,
            date: record.date,
            sourceName: record.sourceName,
            type: record.type,
          })),
        });
      }

      case "OMH_DELETE_RECORD": {
        if (!deps.vault.isUnlocked()) {
          return failRuntimeResponse(new Error("금고가 잠겨 있습니다."));
        }
        const deleted = await deps.vault.deleteRecord(message.id);
        return ok({ deleted });
      }

      case "OMH_AI_PAGE_READY": {
        const tabId = sender.tab?.id;
        if (tabId !== undefined) {
          deps.setLastAiContext(tabId, message.platform);
        }
        return ok({ message: "AI 페이지 연결됨" });
      }

      case "OMH_SOURCE_PAGE_READY": {
        return ok({ message: "Source page ready" });
      }

      default:
        return failRuntimeResponse(new Error("지원되지 않는 메시지입니다."));
    }
  };
}
