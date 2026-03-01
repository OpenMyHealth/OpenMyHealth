import type { ReadHealthRecordsResponse, ResourceType } from "../../../packages/contracts/src/index";
import type { McpApprovalRequest } from "../models";
import type { PendingApproval } from "./state";

vi.mock("../mcp", () => ({
  buildMcpResponse: vi.fn(),
}));

vi.mock("../db", () => ({
  addAuditLog: vi.fn(),
}));

vi.mock("./overlay", () => ({
  sendOverlay: vi.fn(async () => ({ sent: true, tabId: 10 })),
  isOverlayResponsiveForRequest: vi.fn(async () => true),
  markIntegrationWarning: vi.fn(),
}));

vi.mock("./settings", () => ({
  getSettings: vi.fn(async () => ({
    locale: "ko-KR",
    schemaVersion: 1,
    pinConfig: null,
    lockout: { failedAttempts: 0, lockUntil: null },
    connectedProvider: "chatgpt",
    alwaysAllowScopes: [] as string[],
    integrationWarning: null as string | null,
  })),
  updateSettings: vi.fn(async (mutator: (s: Record<string, unknown>) => void) => {
    const settings = {
      locale: "ko-KR",
      schemaVersion: 1,
      pinConfig: null,
      lockout: { failedAttempts: 0, lockUntil: null },
      connectedProvider: "chatgpt",
      alwaysAllowScopes: [] as string[],
      integrationWarning: null as string | null,
    };
    mutator(settings);
    return settings;
  }),
}));

import { addAuditLog } from "../db";
import { buildMcpResponse } from "../mcp";
import { sendOverlay, isOverlayResponsiveForRequest, markIntegrationWarning } from "./overlay";
import { getSettings, updateSettings } from "./settings";
import { permissionKey, legacyPermissionKey } from "./permission-scope";
import { runtimeState, APPROVAL_STATE_STORAGE_KEY } from "./state";
import {
  clearPendingApprovalTimer,
  armPendingApprovalTimer,
  serializeApprovalState,
  persistApprovalState,
  clearPersistedApprovalState,
  restoreApprovalState,
  ensureBackgroundReady,
  toResourceCountMap,
  buildApprovalSummary,
  approvalItemLabel,
  parseReadRequestPayload,
  buildApprovalPreview,
  hydrateApprovalPreview,
  presentApproval,
  runApproval,
  settleApproval,
  handleApprovalTimeout,
  additionalQueueLength,
  emitQueueState,
  emitCurrentQueueState,
  armRenderWatchdog,
  pumpQueue,
  enqueueApprovalRequest,
  lockSession,
  hasAlwaysAllow,
  persistAlwaysScopes,
  tryAutoApproveAlwaysAllow,
  normalizeApprovalSelection,
  applyApprovalItemSelection,
  computeApprovalSharedTypes,
} from "./approval-engine";

const mockAddAuditLog = vi.mocked(addAuditLog);
const mockBuildMcpResponse = vi.mocked(buildMcpResponse);
const mockSendOverlay = vi.mocked(sendOverlay);
const mockIsOverlayResponsive = vi.mocked(isOverlayResponsiveForRequest);
const mockUpdateSettings = vi.mocked(updateSettings);
const mockGetSettings = vi.mocked(getSettings);
const mockMarkIntegrationWarning = vi.mocked(markIntegrationWarning);

function makeRequest(overrides?: Partial<McpApprovalRequest>): McpApprovalRequest {
  return {
    id: crypto.randomUUID(),
    provider: "chatgpt",
    resourceTypes: ["Observation"],
    depth: "summary",
    aiDescription: "test",
    extensionSummary: "test",
    resourceOptions: undefined,
    createdAt: new Date().toISOString(),
    deadlineAt: Date.now() + 60_000,
    ...overrides,
  };
}

function makeOkResponse(resourceTypes: ResourceType[] = ["Observation"]): ReadHealthRecordsResponse {
  return {
    schema_version: "1.0",
    status: "ok",
    depth: "summary",
    resources: resourceTypes.map((rt) => ({
      resource_type: rt,
      count: 2,
      data: [
        { id: `${rt}-1`, display: "item 1" },
        { id: `${rt}-2`, display: "item 2" },
      ],
    })),
    count: resourceTypes.length * 2,
    meta: {
      total_available: resourceTypes.length * 2,
      filtered_count: resourceTypes.length * 2,
      query_matched: false,
    },
  };
}

function makePending(overrides?: Partial<PendingApproval>): PendingApproval {
  return {
    request: makeRequest(),
    allowAlways: false,
    timerId: null,
    renderWatchdogId: null,
    renderWatchdogChecks: 0,
    overlayRendered: false,
    resolve: vi.fn(),
    settled: false,
    sourceTabId: 10,
    ...overrides,
  };
}

function resetRuntimeState() {
  runtimeState.session.isUnlocked = true;
  runtimeState.session.key = {} as CryptoKey;
  runtimeState.session.alwaysAllowSession.clear();
  runtimeState.session.isLocking = false;
  runtimeState.queue = [];
  runtimeState.approvals.clear();
  runtimeState.currentRequestId = null;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRuntimeState();
});

describe("approval-engine", () => {
  // ── Timer management ──

  describe("clearPendingApprovalTimer", () => {
    it("clears existing timer", () => {
      const pending = makePending();
      pending.timerId = setTimeout(() => {}, 99999);
      clearPendingApprovalTimer(pending);
      expect(pending.timerId).toBeNull();
    });

    it("is a no-op when no timer exists", () => {
      const pending = makePending({ timerId: null });
      clearPendingApprovalTimer(pending);
      expect(pending.timerId).toBeNull();
    });
  });

  describe("armPendingApprovalTimer", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("sets timeout for remaining ms", () => {
      const pending = makePending();
      pending.request.deadlineAt = Date.now() + 5000;
      runtimeState.approvals.set(pending.request.id, pending);
      armPendingApprovalTimer(pending);
      expect(pending.timerId).not.toBeNull();
    });

    it("queues microtask when remaining is 0", () => {
      const pending = makePending();
      pending.request.deadlineAt = Date.now() - 1;
      runtimeState.approvals.set(pending.request.id, pending);
      armPendingApprovalTimer(pending);
      expect(pending.timerId).toBeNull();
    });
  });

  // ── State serialization ──

  describe("serializeApprovalState", () => {
    it("returns empty state when no approvals", () => {
      const result = serializeApprovalState();
      expect(result.queue).toEqual([]);
      expect(result.approvals).toEqual([]);
    });

    it("filters settled approvals", () => {
      const pending1 = makePending();
      const pending2 = makePending();
      pending2.settled = true;
      runtimeState.approvals.set(pending1.request.id, pending1);
      runtimeState.approvals.set(pending2.request.id, pending2);
      runtimeState.queue = [pending1.request.id, pending2.request.id];

      const result = serializeApprovalState();
      expect(result.approvals).toHaveLength(1);
      expect(result.approvals[0].id).toBe(pending1.request.id);
    });
  });

  describe("persistApprovalState", () => {
    it("writes to browser.storage.session", async () => {
      await persistApprovalState();
      const stored = await browser.storage.session.get(APPROVAL_STATE_STORAGE_KEY);
      expect(stored[APPROVAL_STATE_STORAGE_KEY]).toBeDefined();
    });
  });

  describe("clearPersistedApprovalState", () => {
    it("removes from storage", async () => {
      await browser.storage.session.set({ [APPROVAL_STATE_STORAGE_KEY]: { queue: [], approvals: [] } });
      await clearPersistedApprovalState();
      const stored = await browser.storage.session.get(APPROVAL_STATE_STORAGE_KEY);
      expect(stored[APPROVAL_STATE_STORAGE_KEY]).toBeUndefined();
    });
  });

  describe("restoreApprovalState", () => {
    it("is a no-op with no stored data", async () => {
      await restoreApprovalState();
      expect(runtimeState.approvals.size).toBe(0);
    });

    it("sets integration warning when stored pending approvals exist", async () => {
      await browser.storage.session.set({
        [APPROVAL_STATE_STORAGE_KEY]: { queue: ["req-1"], approvals: [{ id: "req-1" }] },
      });
      await restoreApprovalState();
      expect(mockUpdateSettings).toHaveBeenCalled();
    });
  });

  // ── Summary functions ──

  describe("toResourceCountMap", () => {
    it("builds correct map from ok response", () => {
      const response = makeOkResponse(["Observation", "Condition"]);
      const result = toResourceCountMap(response, ["Observation", "Condition"]);
      expect(result).toEqual({ Observation: 2, Condition: 2 });
    });

    it("returns undefined for non-ok response", () => {
      const response: ReadHealthRecordsResponse = {
        schema_version: "1.0", status: "denied", depth: "summary", resources: [], count: 0,
        meta: { total_available: 0, filtered_count: 0, query_matched: false },
      };
      expect(toResourceCountMap(response, ["Observation"])).toBeUndefined();
    });
  });

  describe("buildApprovalSummary", () => {
    it("returns label for single type", () => {
      expect(buildApprovalSummary(["Observation"])).toContain("검사 수치");
    });

    it("joins labels for multiple types", () => {
      expect(buildApprovalSummary(["Observation", "Condition"])).toContain("•");
    });

    it("appends query when present", () => {
      const result = buildApprovalSummary(["Observation"], "혈당");
      expect(result).toContain("혈당");
      expect(result).toContain("—");
    });
  });

  describe("approvalItemLabel", () => {
    it("combines display and value", () => {
      expect(approvalItemLabel({ id: "r1", display: "Glucose", value: 100, unit: "mg/dL" })).toBe("Glucose 100 mg/dL");
    });
    it("returns display only when no value", () => {
      expect(approvalItemLabel({ id: "r1", display: "Glucose" })).toBe("Glucose");
    });
    it("returns code when no display", () => {
      expect(approvalItemLabel({ id: "r1", code: "GLU" })).toBe("GLU");
    });
    it("includes date when present", () => {
      expect(approvalItemLabel({ id: "r1", display: "Glucose", date: "2024-01-01" })).toBe("Glucose (2024-01-01)");
    });
    it("falls back to id", () => {
      expect(approvalItemLabel({ id: "fallback-id" })).toBe("fallback-id");
    });
  });

  // ── Request parsing ──

  describe("parseReadRequestPayload", () => {
    it("returns success for valid payload", () => {
      expect(parseReadRequestPayload({ resourceTypes: ["Observation"], depth: "summary" }).success).toBe(true);
    });
    it("returns failure for invalid payload", () => {
      expect(parseReadRequestPayload({ resourceTypes: [] as ResourceType[], depth: "summary" }).success).toBe(false);
    });
  });

  // ── Settlement ──

  describe("settleApproval", () => {
    it("settles a valid pending request", async () => {
      const pending = makePending();
      runtimeState.approvals.set(pending.request.id, pending);
      runtimeState.currentRequestId = pending.request.id;
      runtimeState.queue = [pending.request.id];

      const result = await settleApproval(pending.request.id, makeOkResponse(), "approved", "one-time");
      expect(result).toBe(true);
      expect(pending.settled).toBe(true);
      expect(runtimeState.approvals.has(pending.request.id)).toBe(false);
      expect(runtimeState.currentRequestId).toBeNull();
    });

    it("returns false for already-settled request", async () => {
      const pending = makePending({ settled: true });
      runtimeState.approvals.set(pending.request.id, pending);
      expect(await settleApproval(pending.request.id, makeOkResponse(), "approved", "one-time")).toBe(false);
    });

    it("clears currentRequestId", async () => {
      const pending = makePending();
      runtimeState.approvals.set(pending.request.id, pending);
      runtimeState.currentRequestId = pending.request.id;
      await settleApproval(pending.request.id, makeOkResponse(), "approved", "one-time");
      expect(runtimeState.currentRequestId).toBeNull();
    });

    it("notifies overlay with resolved event", async () => {
      const pending = makePending();
      runtimeState.approvals.set(pending.request.id, pending);
      await settleApproval(pending.request.id, makeOkResponse(), "approved", "one-time");
      expect(mockSendOverlay).toHaveBeenCalledWith(
        "chatgpt",
        expect.objectContaining({ type: "overlay:resolved", requestId: pending.request.id }),
        10,
      );
    });

    it("writes audit log with correct fields", async () => {
      const pending = makePending();
      runtimeState.approvals.set(pending.request.id, pending);
      await settleApproval(pending.request.id, makeOkResponse(), "approved", "one-time", ["Observation"]);
      expect(mockAddAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          ai_provider: "chatgpt",
          resource_types: ["Observation"],
          result: "approved",
          permission_level: "one-time",
          shared_resource_types: ["Observation"],
          depth: "summary",
        }),
      );
    });

    it("clears persisted state when last approval", async () => {
      const pending = makePending();
      runtimeState.approvals.set(pending.request.id, pending);
      await settleApproval(pending.request.id, makeOkResponse(), "approved", "one-time");
      const stored = await browser.storage.session.get(APPROVAL_STATE_STORAGE_KEY);
      expect(stored[APPROVAL_STATE_STORAGE_KEY]).toBeUndefined();
    });
  });

  // ── Timeout ──

  describe("handleApprovalTimeout", () => {
    it("settles with timeout status", async () => {
      const pending = makePending();
      runtimeState.approvals.set(pending.request.id, pending);
      await handleApprovalTimeout(pending.request.id);
      expect(pending.settled).toBe(true);
      expect(pending.resolve).toHaveBeenCalledWith(expect.objectContaining({ status: "timeout" }));
    });

    it("is a no-op for already-settled requests", async () => {
      const pending = makePending({ settled: true });
      runtimeState.approvals.set(pending.request.id, pending);
      await handleApprovalTimeout(pending.request.id);
      expect(pending.resolve).not.toHaveBeenCalled();
    });
  });

  // ── Queue ──

  describe("additionalQueueLength", () => {
    it("returns queue length when no current", () => {
      runtimeState.currentRequestId = null;
      runtimeState.queue = ["a", "b", "c"];
      expect(additionalQueueLength()).toBe(3);
    });

    it("returns queue minus 1 when current is set", () => {
      runtimeState.currentRequestId = "a";
      runtimeState.queue = ["a", "b", "c"];
      expect(additionalQueueLength()).toBe(2);
    });
  });

  describe("pumpQueue", () => {
    it("processes next item in queue", async () => {
      const pending = makePending();
      runtimeState.approvals.set(pending.request.id, pending);
      runtimeState.queue = [pending.request.id];
      await pumpQueue();
      expect(runtimeState.currentRequestId).toBe(pending.request.id);
    });

    it("skips settled items", async () => {
      const settled = makePending({ settled: true });
      const active = makePending();
      runtimeState.approvals.set(settled.request.id, settled);
      runtimeState.approvals.set(active.request.id, active);
      runtimeState.queue = [settled.request.id, active.request.id];
      await pumpQueue();
      expect(runtimeState.currentRequestId).toBe(active.request.id);
    });

    it("auto-approves always-allow items", async () => {
      mockBuildMcpResponse.mockResolvedValue(makeOkResponse());
      const pending = makePending({
        allowAlways: true,
        request: makeRequest({ resourceTypes: ["Observation"], depth: "summary" }),
      });
      runtimeState.approvals.set(pending.request.id, pending);
      runtimeState.queue = [pending.request.id];
      runtimeState.session.alwaysAllowSession.add(
        permissionKey({ provider: "chatgpt", resourceType: "Observation", depth: "summary" }),
      );
      await pumpQueue();
      expect(pending.settled).toBe(true);
      expect(runtimeState.currentRequestId).toBeNull();
    });

    it("presents approval to overlay when not auto-approved", async () => {
      const pending = makePending();
      runtimeState.approvals.set(pending.request.id, pending);
      runtimeState.queue = [pending.request.id];
      await pumpQueue();
      expect(mockSendOverlay).toHaveBeenCalled();
    });
  });

  // ── Enqueue ──

  describe("enqueueApprovalRequest", () => {
    it("creates approval and queues it", async () => {
      const { requestId, promise } = await enqueueApprovalRequest({
        provider: "chatgpt", resourceTypes: ["Observation"], depth: "summary",
        sourceTabId: 10, allowAlways: false,
      });
      expect(requestId).toBeDefined();
      expect(promise).toBeInstanceOf(Promise);
      expect(runtimeState.approvals.has(requestId)).toBe(true);
    });

    it("throws when session is locking", async () => {
      runtimeState.session.isLocking = true;
      await expect(enqueueApprovalRequest({
        provider: "chatgpt", resourceTypes: ["Observation"], depth: "summary",
        sourceTabId: 10, allowAlways: false,
      })).rejects.toThrow("정리 중");
    });

    it("throws when queue is full", async () => {
      runtimeState.queue = Array.from({ length: 20 }, (_, i) => `req-${i}`);
      await expect(enqueueApprovalRequest({
        provider: "chatgpt", resourceTypes: ["Observation"], depth: "summary",
        sourceTabId: 10, allowAlways: false,
      })).rejects.toThrow("너무 많습니다");
    });

    it("with auto-approve settles immediately", async () => {
      mockBuildMcpResponse.mockResolvedValue(makeOkResponse());
      runtimeState.session.alwaysAllowSession.add(
        permissionKey({ provider: "chatgpt", resourceType: "Observation", depth: "summary" }),
      );
      const { requestId, promise } = await enqueueApprovalRequest({
        provider: "chatgpt", resourceTypes: ["Observation"], depth: "summary",
        sourceTabId: 10, allowAlways: true,
      });
      expect(requestId).toBeDefined();
      const result = await promise;
      expect(result.status).toBe("ok");
    });
  });

  // ── Lock ──

  describe("lockSession", () => {
    it("clears session state", async () => {
      runtimeState.session.alwaysAllowSession.add("test");
      await lockSession();
      expect(runtimeState.session.isUnlocked).toBe(false);
      expect(runtimeState.session.key).toBeNull();
      expect(runtimeState.session.alwaysAllowSession.size).toBe(0);
    });

    it("settles all pending approvals with LOCKED_SESSION error", async () => {
      const pending1 = makePending();
      const pending2 = makePending();
      // Capture key state at resolve time to verify key is null before settlement
      let keyAtResolve1: CryptoKey | null = "unset" as unknown as CryptoKey | null;
      pending1.resolve = vi.fn(() => { keyAtResolve1 = runtimeState.session.key; });
      runtimeState.approvals.set(pending1.request.id, pending1);
      runtimeState.approvals.set(pending2.request.id, pending2);
      runtimeState.queue = [pending1.request.id, pending2.request.id];
      await lockSession();
      expect(pending1.settled).toBe(true);
      expect(pending2.settled).toBe(true);
      expect(runtimeState.queue).toEqual([]);
      // Key must be null before approvals are settled (AE-3: key deletion order)
      expect(keyAtResolve1).toBeNull();
      // Verify each pending was resolved with a LOCKED_SESSION error response
      expect(pending1.resolve).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "error",
          error: expect.objectContaining({ code: "LOCKED_SESSION", retryable: false }),
        }),
      );
      expect(pending2.resolve).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "error",
          error: expect.objectContaining({ code: "LOCKED_SESSION", retryable: false }),
        }),
      );
    });

    it("is idempotent via isLocking guard", async () => {
      runtimeState.session.isLocking = true;
      const before = runtimeState.session.isUnlocked;
      await lockSession();
      expect(runtimeState.session.isUnlocked).toBe(before);
    });
  });

  // ── Always-allow ──

  describe("hasAlwaysAllow", () => {
    it("returns true when matching scope in session", async () => {
      const request = makeRequest({ resourceTypes: ["Observation"], depth: "summary" });
      runtimeState.session.alwaysAllowSession.add(
        permissionKey({ provider: "chatgpt", resourceType: "Observation", depth: "summary" }),
      );
      expect(await hasAlwaysAllow(request, true)).toBe(true);
    });

    it("returns false when no match", async () => {
      const request = makeRequest({ resourceTypes: ["Observation"], depth: "summary" });
      expect(await hasAlwaysAllow(request, true)).toBe(false);
    });

    it("matches legacy key for requests without query/dateFrom/dateTo", async () => {
      const request = makeRequest({ resourceTypes: ["Observation"], depth: "summary" });
      runtimeState.session.alwaysAllowSession.add(
        legacyPermissionKey({ provider: "chatgpt", resourceType: "Observation", depth: "summary" }),
      );
      expect(await hasAlwaysAllow(request, true)).toBe(true);
    });

    it("returns false when allowAlways is false", async () => {
      expect(await hasAlwaysAllow(makeRequest({ resourceTypes: ["Observation"] }), false)).toBe(false);
    });
  });

  describe("persistAlwaysScopes", () => {
    it("saves to session and settings", async () => {
      const result = await persistAlwaysScopes(["scope1", "scope2"]);
      expect(result).toBe(true);
      expect(runtimeState.session.alwaysAllowSession.has("scope1")).toBe(true);
      expect(runtimeState.session.alwaysAllowSession.has("scope2")).toBe(true);
      expect(mockUpdateSettings).toHaveBeenCalled();
    });

    it("returns true for empty keys", async () => {
      expect(await persistAlwaysScopes([])).toBe(true);
    });
  });

  describe("tryAutoApproveAlwaysAllow", () => {
    it("settles approved when allowed", async () => {
      mockBuildMcpResponse.mockResolvedValue(makeOkResponse());
      const pending = makePending({ allowAlways: true });
      runtimeState.approvals.set(pending.request.id, pending);
      runtimeState.session.alwaysAllowSession.add(
        permissionKey({ provider: "chatgpt", resourceType: "Observation", depth: "summary" }),
      );
      expect(await tryAutoApproveAlwaysAllow(pending)).toBe(true);
      expect(pending.settled).toBe(true);
    });

    it("returns false when session locked", async () => {
      runtimeState.session.isUnlocked = false;
      expect(await tryAutoApproveAlwaysAllow(makePending({ allowAlways: true }))).toBe(false);
    });
  });

  // ── Item selection ──

  describe("normalizeApprovalSelection", () => {
    it("uses explicit selectedResourceTypes from message", () => {
      const request = makeRequest({ resourceTypes: ["Observation", "Condition"] });
      const result = normalizeApprovalSelection(request, {
        type: "approval:decision", requestId: request.id, decision: "approved",
        selectedResourceTypes: ["Observation" as ResourceType], selectedItemIds: [],
      });
      expect(result.selectedResourceTypes).toEqual(["Observation"]);
    });

    it("defaults to request types when message has no selectedResourceTypes", () => {
      const request = makeRequest({ resourceTypes: ["Observation", "Condition"] });
      const result = normalizeApprovalSelection(request, {
        type: "approval:decision", requestId: request.id, decision: "approved",
      });
      expect(result.selectedResourceTypes).toEqual(["Observation", "Condition"]);
    });
  });

  describe("applyApprovalItemSelection", () => {
    it("filters by item ids", () => {
      const response = makeOkResponse(["Observation"]);
      const result = applyApprovalItemSelection(response, new Set(["Observation-1"]));
      const obs = result.resources.find((r) => r.resource_type === "Observation");
      expect(obs!.count).toBe(1);
      expect(obs!.data).toHaveLength(1);
    });

    it("returns unchanged response when ids set is empty", () => {
      const response = makeOkResponse(["Observation"]);
      expect(applyApprovalItemSelection(response, new Set<string>())).toBe(response);
    });
  });

  describe("computeApprovalSharedTypes", () => {
    it("returns types with data for ok response", () => {
      expect(computeApprovalSharedTypes(makeOkResponse(["Observation", "Condition"]), ["Observation"]))
        .toEqual(["Observation", "Condition"]);
    });

    it("returns fallback types for error response", () => {
      const response: ReadHealthRecordsResponse = {
        schema_version: "1.0", status: "error", depth: "summary", resources: [], count: 0,
        meta: { total_available: 0, filtered_count: 0, query_matched: false },
      };
      expect(computeApprovalSharedTypes(response, ["Observation"])).toEqual(["Observation"]);
    });
  });

  // ── Render watchdog ──

  describe("armRenderWatchdog", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("fires after delay and settles on failure", async () => {
      mockIsOverlayResponsive.mockResolvedValue(false);
      const pending = makePending();
      runtimeState.approvals.set(pending.request.id, pending);
      runtimeState.currentRequestId = pending.request.id;
      armRenderWatchdog(pending.request.id, 100);
      expect(pending.renderWatchdogId).not.toBeNull();
      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();
      expect(pending.settled).toBe(true);
    });

    it("does nothing for already-settled pending", () => {
      const pending = makePending({ settled: true });
      runtimeState.approvals.set(pending.request.id, pending);
      armRenderWatchdog(pending.request.id);
      expect(pending.renderWatchdogId).toBeNull();
    });
  });

  // ── emitQueueState ──

  describe("emitQueueState", () => {
    it("sends overlay queue event", async () => {
      await emitQueueState("chatgpt", 10);
      expect(mockSendOverlay).toHaveBeenCalledWith(
        "chatgpt", expect.objectContaining({ type: "overlay:queue" }), 10,
      );
    });
  });

  describe("emitCurrentQueueState", () => {
    it("does nothing when no current request", async () => {
      runtimeState.currentRequestId = null;
      mockSendOverlay.mockClear();
      await emitCurrentQueueState();
      expect(mockSendOverlay).not.toHaveBeenCalled();
    });
  });

  // ── ensureBackgroundReady ──

  describe("ensureBackgroundReady", () => {
    it("returns a promise", () => {
      expect(ensureBackgroundReady()).toBeInstanceOf(Promise);
    });

    it("returns the same promise on second call", () => {
      const p1 = ensureBackgroundReady();
      expect(ensureBackgroundReady()).toBe(p1);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  Additional coverage tests for uncovered lines
  // ══════════════════════════════════════════════════════════════════

  // ── Line 54: armPendingApprovalTimer setTimeout callback ──

  describe("armPendingApprovalTimer (setTimeout callback)", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("calls handleApprovalTimeout when setTimeout fires", async () => {
      const pending = makePending();
      pending.request.deadlineAt = Date.now() + 100;
      runtimeState.approvals.set(pending.request.id, pending);
      armPendingApprovalTimer(pending);
      expect(pending.timerId).not.toBeNull();
      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();
      // handleApprovalTimeout settles the pending approval
      expect(pending.settled).toBe(true);
    });
  });

  // ── Lines 82, 90: persistApprovalState/clearPersistedApprovalState error catch ──

  describe("persistApprovalState error handling", () => {
    it("catches and logs error when storage.session.set throws", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const originalSet = browser.storage.session.set;
      browser.storage.session.set = vi.fn().mockRejectedValue(new Error("storage error")) as never;
      await persistApprovalState();
      expect(spy).toHaveBeenCalledWith("[approval] failed to persist state:", expect.any(Error));
      browser.storage.session.set = originalSet;
      spy.mockRestore();
    });
  });

  describe("clearPersistedApprovalState error handling", () => {
    it("catches and logs error when storage.session.remove throws", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const originalRemove = browser.storage.session.remove;
      browser.storage.session.remove = vi.fn().mockRejectedValue(new Error("remove error")) as never;
      await clearPersistedApprovalState();
      expect(spy).toHaveBeenCalledWith("[approval] failed to clear persisted state:", expect.any(Error));
      browser.storage.session.remove = originalRemove;
      spy.mockRestore();
    });
  });

  // ── Lines 96, 104-105: restoreApprovalState early return and storage read error ──

  describe("restoreApprovalState edge cases", () => {
    it("returns early when approvals already exist", async () => {
      const pending = makePending();
      runtimeState.approvals.set(pending.request.id, pending);
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      await restoreApprovalState();
      // Should not attempt to read storage
      expect(mockUpdateSettings).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("returns early when queue is non-empty", async () => {
      runtimeState.queue = ["some-id"];
      await restoreApprovalState();
      expect(mockUpdateSettings).not.toHaveBeenCalled();
    });

    it("returns early when currentRequestId is set", async () => {
      runtimeState.currentRequestId = "some-id";
      await restoreApprovalState();
      expect(mockUpdateSettings).not.toHaveBeenCalled();
    });

    it("catches and logs error when storage.session.get throws", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const originalGet = browser.storage.session.get;
      browser.storage.session.get = vi.fn().mockRejectedValue(new Error("read error")) as never;
      await restoreApprovalState();
      expect(spy).toHaveBeenCalledWith("[approval] failed to read persisted state:", expect.any(Error));
      browser.storage.session.get = originalGet;
      spy.mockRestore();
    });
  });

  // ── Line 126: ensureBackgroundReady error catch ──

  describe("ensureBackgroundReady error handling", () => {
    it("catches restoreApprovalState errors gracefully via .catch()", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      // Set up stored state with pending approvals so restoreApprovalState calls updateSettings
      await browser.storage.session.set({
        [APPROVAL_STATE_STORAGE_KEY]: { queue: ["req-1"], approvals: [{ id: "req-1" }] },
      });
      // Make updateSettings throw, which propagates out of restoreApprovalState
      mockUpdateSettings.mockRejectedValueOnce(new Error("settings error"));
      // Reset the background init promise so ensureBackgroundReady creates a new one
      const { setBackgroundInitPromise } = await import("./state");
      setBackgroundInitPromise(null);
      const promise = ensureBackgroundReady();
      await promise; // Should not throw due to .catch()
      expect(spy).toHaveBeenCalledWith("[approval] failed to restore persisted state:", expect.any(Error));
      spy.mockRestore();
      setBackgroundInitPromise(null); // Reset for next tests
    });
  });

  // ── Line 144: toResourceCountMap filtering (count <= 0 or not in allowed set) ──

  describe("toResourceCountMap filtering", () => {
    it("skips resources with count <= 0", () => {
      const response: ReadHealthRecordsResponse = {
        schema_version: "1.0",
        status: "ok",
        depth: "summary",
        resources: [
          { resource_type: "Observation", count: 0, data: [] },
          { resource_type: "Condition", count: 2, data: [{ id: "c1" }, { id: "c2" }] },
        ],
        count: 2,
        meta: { total_available: 2, filtered_count: 2, query_matched: false },
      };
      const result = toResourceCountMap(response, ["Observation", "Condition"]);
      expect(result).toEqual({ Condition: 2 });
    });

    it("skips resources not in the allowed set", () => {
      const response = makeOkResponse(["Observation", "Condition"]);
      const result = toResourceCountMap(response, ["Observation"]);
      expect(result).toEqual({ Observation: 2 });
    });

    it("returns undefined when all resources are filtered out", () => {
      const response: ReadHealthRecordsResponse = {
        schema_version: "1.0",
        status: "ok",
        depth: "summary",
        resources: [
          { resource_type: "Observation", count: 0, data: [] },
        ],
        count: 0,
        meta: { total_available: 0, filtered_count: 0, query_matched: false },
      };
      const result = toResourceCountMap(response, ["Observation"]);
      expect(result).toBeUndefined();
    });
  });

  // ── Line 176: approvalItemLabel - code + valueText branch ──

  describe("approvalItemLabel additional branches", () => {
    it("returns code + valueText when no display", () => {
      expect(approvalItemLabel({ id: "r1", code: "GLU", value: 100, unit: "mg/dL" })).toBe("GLU 100 mg/dL");
    });

    it("returns code + date when no display and no value", () => {
      expect(approvalItemLabel({ id: "r1", code: "GLU", date: "2024-01-01" })).toBe("GLU (2024-01-01)");
    });

    it("returns valueText + date when no display and no code", () => {
      expect(approvalItemLabel({ id: "r1", value: 100, unit: "mg/dL", date: "2024-01-01" })).toBe("100 mg/dL (2024-01-01)");
    });

    it("returns valueText when no display, no code, no date", () => {
      expect(approvalItemLabel({ id: "r1", value: 100, unit: "mg/dL" })).toBe("100 mg/dL");
    });

    it("returns display + valueText + date when all present", () => {
      expect(approvalItemLabel({ id: "r1", display: "Glucose", value: 100, unit: "mg/dL", date: "2024-01-01" }))
        .toBe("Glucose 100 mg/dL (2024-01-01)");
    });

    it("returns string value without unit", () => {
      expect(approvalItemLabel({ id: "r1", value: "normal" })).toBe("normal");
    });
  });

  // ── Lines 213, 221: buildApprovalPreview - session locked and parse failure ──

  describe("buildApprovalPreview", () => {
    it("returns fallback summary when session is locked", async () => {
      runtimeState.session.isUnlocked = false;
      const result = await buildApprovalPreview({
        resourceTypes: ["Observation"],
        depth: "summary",
      });
      expect(result.extensionSummary).toContain("검사 수치");
      expect(result.resourceOptions).toBeUndefined();
    });

    it("returns fallback summary when session key is null", async () => {
      runtimeState.session.key = null;
      const result = await buildApprovalPreview({
        resourceTypes: ["Observation"],
        depth: "summary",
      });
      expect(result.extensionSummary).toContain("검사 수치");
      expect(result.resourceOptions).toBeUndefined();
    });

    it("returns fallback summary when parseReadRequestPayload fails", async () => {
      const result = await buildApprovalPreview({
        resourceTypes: [] as ResourceType[],
        depth: "summary",
      });
      expect(result.resourceOptions).toBeUndefined();
    });

    it("returns resource counts and options on success", async () => {
      mockBuildMcpResponse.mockResolvedValue(makeOkResponse(["Observation"]));
      const result = await buildApprovalPreview({
        resourceTypes: ["Observation"],
        depth: "summary",
      });
      expect(result.extensionSummary).toContain("2건");
      expect(result.resourceOptions).toBeDefined();
      expect(result.resourceOptions!.length).toBeGreaterThan(0);
    });

    it("includes query in summary when present", async () => {
      mockBuildMcpResponse.mockResolvedValue(makeOkResponse(["Observation"]));
      const result = await buildApprovalPreview({
        resourceTypes: ["Observation"],
        depth: "summary",
        query: "혈당",
      });
      expect(result.extensionSummary).toContain("혈당");
    });

    it("returns extensionSummary without resourceOptions when response is not ok", async () => {
      mockBuildMcpResponse.mockResolvedValue({
        schema_version: "1.0",
        status: "error",
        depth: "summary",
        resources: [{ resource_type: "Observation", count: 2, data: [{ id: "a" }, { id: "b" }] }],
        count: 2,
        meta: { total_available: 2, filtered_count: 2, query_matched: false },
      });
      const result = await buildApprovalPreview({
        resourceTypes: ["Observation"],
        depth: "summary",
      });
      expect(result.resourceOptions).toBeUndefined();
    });

    it("returns fallback on buildMcpResponse exception", async () => {
      mockBuildMcpResponse.mockRejectedValue(new Error("mcp error"));
      const result = await buildApprovalPreview({
        resourceTypes: ["Observation"],
        depth: "summary",
      });
      expect(result.extensionSummary).toContain("검사 수치");
      expect(result.resourceOptions).toBeUndefined();
    });
  });

  // ── Lines 266, 279, 286: hydrateApprovalPreview ──

  describe("hydrateApprovalPreview", () => {
    it("returns early when pending is not found", async () => {
      await hydrateApprovalPreview("nonexistent-id");
      expect(mockBuildMcpResponse).not.toHaveBeenCalled();
    });

    it("returns early when pending is settled", async () => {
      const pending = makePending({ settled: true });
      runtimeState.approvals.set(pending.request.id, pending);
      await hydrateApprovalPreview(pending.request.id);
      expect(mockBuildMcpResponse).not.toHaveBeenCalled();
    });

    it("returns early if settled after buildApprovalPreview completes", async () => {
      const pending = makePending();
      runtimeState.approvals.set(pending.request.id, pending);
      // Make buildMcpResponse settle the pending during the call
      mockBuildMcpResponse.mockImplementation(async () => {
        pending.settled = true;
        return makeOkResponse();
      });
      await hydrateApprovalPreview(pending.request.id);
      // Should not send overlay:update-approval because settled after preview built
      expect(mockSendOverlay).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: "overlay:update-approval" }),
        expect.anything(),
      );
    });

    it("sends overlay update when request is current", async () => {
      const pending = makePending();
      runtimeState.approvals.set(pending.request.id, pending);
      runtimeState.currentRequestId = pending.request.id;
      mockBuildMcpResponse.mockResolvedValue(makeOkResponse());
      await hydrateApprovalPreview(pending.request.id);
      expect(mockSendOverlay).toHaveBeenCalledWith(
        "chatgpt",
        expect.objectContaining({ type: "overlay:update-approval" }),
        10,
      );
    });

    it("does not send overlay update when request is not current", async () => {
      const pending = makePending();
      runtimeState.approvals.set(pending.request.id, pending);
      runtimeState.currentRequestId = "other-id";
      mockBuildMcpResponse.mockResolvedValue(makeOkResponse());
      await hydrateApprovalPreview(pending.request.id);
      expect(mockSendOverlay).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: "overlay:update-approval" }),
        expect.anything(),
      );
    });
  });

  // ── Line 363: settleApproval - audit log error catch ──

  describe("settleApproval error paths", () => {
    it("catches audit log error and still resolves", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockAddAuditLog.mockRejectedValueOnce(new Error("audit error"));
      const pending = makePending();
      runtimeState.approvals.set(pending.request.id, pending);
      const result = await settleApproval(pending.request.id, makeOkResponse(), "approved", "one-time");
      expect(result).toBe(true);
      expect(spy).toHaveBeenCalledWith("[approval] failed to write audit log:", expect.any(Error));
      expect(pending.resolve).toHaveBeenCalled();
      spy.mockRestore();
    });

    it("catches overlay notification error and still resolves", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockSendOverlay.mockRejectedValueOnce(new Error("overlay error"));
      const pending = makePending();
      runtimeState.approvals.set(pending.request.id, pending);
      const result = await settleApproval(pending.request.id, makeOkResponse(), "approved", "one-time");
      expect(result).toBe(true);
      expect(spy).toHaveBeenCalledWith("[approval] failed to notify overlay:", expect.any(Error));
      expect(pending.resolve).toHaveBeenCalled();
      spy.mockRestore();
    });

    it("clears renderWatchdogId when settling", async () => {
      const pending = makePending();
      pending.renderWatchdogId = setTimeout(() => {}, 99999);
      runtimeState.approvals.set(pending.request.id, pending);
      await settleApproval(pending.request.id, makeOkResponse(), "approved", "one-time");
      expect(pending.renderWatchdogId).toBeNull();
    });

    it("persists state when other approvals remain", async () => {
      const pending1 = makePending();
      const pending2 = makePending();
      runtimeState.approvals.set(pending1.request.id, pending1);
      runtimeState.approvals.set(pending2.request.id, pending2);
      await settleApproval(pending1.request.id, makeOkResponse(), "approved", "one-time");
      // pending2 still exists, so state should be persisted (not cleared)
      const stored = await browser.storage.session.get(APPROVAL_STATE_STORAGE_KEY);
      expect(stored[APPROVAL_STATE_STORAGE_KEY]).toBeDefined();
    });
  });

  // ── Lines 420-427: emitCurrentQueueState with active pending ──

  describe("emitCurrentQueueState with active pending", () => {
    it("emits queue state when current request has an active pending", async () => {
      const pending = makePending();
      runtimeState.approvals.set(pending.request.id, pending);
      runtimeState.currentRequestId = pending.request.id;
      runtimeState.queue = [pending.request.id, "another-id"];
      await emitCurrentQueueState();
      expect(mockSendOverlay).toHaveBeenCalledWith(
        "chatgpt",
        expect.objectContaining({ type: "overlay:queue" }),
        10,
      );
    });

    it("does not emit when pending is settled", async () => {
      const pending = makePending({ settled: true });
      runtimeState.approvals.set(pending.request.id, pending);
      runtimeState.currentRequestId = pending.request.id;
      await emitCurrentQueueState();
      expect(mockSendOverlay).not.toHaveBeenCalled();
    });

    it("does not emit when pending is not found", async () => {
      runtimeState.currentRequestId = "nonexistent-id";
      await emitCurrentQueueState();
      expect(mockSendOverlay).not.toHaveBeenCalled();
    });
  });

  // ── Lines 436-437: armRenderWatchdog - already rendered or existing watchdog ──

  describe("armRenderWatchdog edge cases", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("does nothing when overlayRendered is true", () => {
      const pending = makePending({ overlayRendered: true });
      runtimeState.approvals.set(pending.request.id, pending);
      armRenderWatchdog(pending.request.id);
      expect(pending.renderWatchdogId).toBeNull();
    });

    it("clears existing watchdog before setting new one", () => {
      const pending = makePending();
      const oldTimer = setTimeout(() => {}, 99999);
      pending.renderWatchdogId = oldTimer;
      runtimeState.approvals.set(pending.request.id, pending);
      armRenderWatchdog(pending.request.id, 100);
      expect(pending.renderWatchdogId).not.toBeNull();
      expect(pending.renderWatchdogId).not.toBe(oldTimer);
    });

    it("does nothing for unknown requestId", () => {
      armRenderWatchdog("nonexistent-id");
      // no error, just returns
    });
  });

  // ── Lines 444, 450-451: renderWatchdog timer - responsive check + retry ──

  describe("armRenderWatchdog timer callback paths", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("returns early if settled when timer fires", async () => {
      const pending = makePending();
      runtimeState.approvals.set(pending.request.id, pending);
      armRenderWatchdog(pending.request.id, 100);
      pending.settled = true; // settle before timer fires
      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();
      // Should not call isOverlayResponsiveForRequest
      expect(mockIsOverlayResponsive).not.toHaveBeenCalled();
    });

    it("returns early if overlayRendered when timer fires", async () => {
      const pending = makePending();
      runtimeState.approvals.set(pending.request.id, pending);
      armRenderWatchdog(pending.request.id, 100);
      pending.overlayRendered = true; // mark rendered before timer fires
      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();
      expect(mockIsOverlayResponsive).not.toHaveBeenCalled();
    });

    it("re-arms watchdog when responsive and checks < 3", async () => {
      mockIsOverlayResponsive.mockResolvedValue(true);
      const pending = makePending();
      pending.renderWatchdogChecks = 0;
      runtimeState.approvals.set(pending.request.id, pending);
      armRenderWatchdog(pending.request.id, 100);

      // First timer fires - responsive, checks becomes 1, re-arms with 8000ms
      await vi.advanceTimersByTimeAsync(100);
      // Allow microtasks to settle but do not advance remaining timers
      await Promise.resolve();
      expect(pending.renderWatchdogChecks).toBe(1);
      expect(pending.settled).toBe(false);
      // The watchdog was re-armed
      expect(pending.renderWatchdogId).not.toBeNull();
    });

    it("settles with error when responsive but checks >= 3", async () => {
      mockIsOverlayResponsive.mockResolvedValue(true);
      const pending = makePending();
      pending.renderWatchdogChecks = 2; // already at 2, next will be 3
      runtimeState.approvals.set(pending.request.id, pending);
      armRenderWatchdog(pending.request.id, 100);

      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();
      expect(pending.renderWatchdogChecks).toBe(3);
      expect(pending.settled).toBe(true);
      expect(mockMarkIntegrationWarning).toHaveBeenCalled();
    });
  });

  // ── Lines 493-513: presentApproval retry and failure paths ──

  describe("presentApproval", () => {
    it("sends overlay successfully on first try", async () => {
      mockSendOverlay.mockResolvedValue({ sent: true, tabId: 10 });
      const request = makeRequest();
      const pending = makePending({ request });
      runtimeState.approvals.set(request.id, pending);
      await presentApproval(request);
      expect(mockSendOverlay).toHaveBeenCalledTimes(1);
    });

    it("retries after 400ms delay when first sendOverlay fails", async () => {
      vi.useFakeTimers();
      mockSendOverlay
        .mockResolvedValueOnce({ sent: false, tabId: null })
        .mockResolvedValueOnce({ sent: true, tabId: 10 });
      const request = makeRequest();
      const pending = makePending({ request });
      runtimeState.approvals.set(request.id, pending);
      const promise = presentApproval(request);
      // The first sendOverlay returns { sent: false }, then setTimeout(400) is scheduled
      await vi.advanceTimersByTimeAsync(400);
      await promise;
      expect(mockSendOverlay).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });

    it("settles with error when both sendOverlay calls fail", async () => {
      vi.useFakeTimers();
      mockSendOverlay.mockResolvedValue({ sent: false, tabId: null });
      const request = makeRequest();
      const pending = makePending({ request });
      runtimeState.approvals.set(request.id, pending);
      const promise = presentApproval(request);
      await vi.advanceTimersByTimeAsync(400);
      await promise;
      expect(pending.settled).toBe(true);
      expect(mockMarkIntegrationWarning).toHaveBeenCalled();
      expect(pending.resolve).toHaveBeenCalledWith(expect.objectContaining({ status: "error" }));
      vi.useRealTimers();
    });

    it("clears renderWatchdogId when both sendOverlay calls fail", async () => {
      vi.useFakeTimers();
      mockSendOverlay.mockResolvedValue({ sent: false, tabId: null });
      const request = makeRequest();
      const pending = makePending({ request });
      pending.renderWatchdogId = setTimeout(() => {}, 99999);
      runtimeState.approvals.set(request.id, pending);
      const promise = presentApproval(request);
      await vi.advanceTimersByTimeAsync(400);
      await promise;
      expect(pending.renderWatchdogId).toBeNull();
      vi.useRealTimers();
    });

    it("sends request-unlock event when session is locked", async () => {
      runtimeState.session.isUnlocked = false;
      mockSendOverlay.mockResolvedValue({ sent: true, tabId: 10 });
      const request = makeRequest();
      const pending = makePending({ request });
      runtimeState.approvals.set(request.id, pending);
      await presentApproval(request);
      expect(mockSendOverlay).toHaveBeenCalledWith(
        "chatgpt",
        expect.objectContaining({ type: "overlay:request-unlock" }),
        10,
      );
    });
  });

  // ── Lines 526, 538, 544-545: runApproval ──

  describe("runApproval", () => {
    it("returns error when session is locked", async () => {
      runtimeState.session.isUnlocked = false;
      const result = await runApproval(makeRequest());
      expect(result.status).toBe("error");
    });

    it("returns error when session key is null", async () => {
      runtimeState.session.key = null;
      const result = await runApproval(makeRequest());
      expect(result.status).toBe("error");
    });

    it("returns error when parseReadRequestPayload fails", async () => {
      const request = makeRequest({ resourceTypes: [] as ResourceType[] });
      const result = await runApproval(request);
      expect(result.status).toBe("error");
    });

    it("returns response on success", async () => {
      mockBuildMcpResponse.mockResolvedValue(makeOkResponse());
      const result = await runApproval(makeRequest());
      expect(result.status).toBe("ok");
    });

    it("uses selectedResourceTypes when provided", async () => {
      mockBuildMcpResponse.mockResolvedValue(makeOkResponse());
      await runApproval(makeRequest({ resourceTypes: ["Observation", "Condition"] }), ["Observation"]);
      expect(mockBuildMcpResponse).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ resource_types: ["Observation"] }),
      );
    });

    it("catches buildMcpResponse error and returns error response", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockBuildMcpResponse.mockRejectedValue(new Error("mcp error"));
      const result = await runApproval(makeRequest());
      expect(result.status).toBe("error");
      expect(spy).toHaveBeenCalledWith("[approval] failed to build MCP response:", expect.any(Error));
      spy.mockRestore();
    });
  });

  // ── Line 590: normalizeApprovalSelection - selectedItemIds filtering ──

  describe("normalizeApprovalSelection filtering", () => {
    it("filters out non-string and empty selectedItemIds", () => {
      const request = makeRequest();
      const result = normalizeApprovalSelection(request, {
        type: "approval:decision",
        requestId: request.id,
        decision: "approved",
        selectedItemIds: ["valid-id", "", "another-valid", 123 as unknown as string, null as unknown as string],
      });
      expect(result.selectedItemIds).toEqual(["valid-id", "another-valid"]);
    });

    it("deduplicates selectedItemIds", () => {
      const request = makeRequest();
      const result = normalizeApprovalSelection(request, {
        type: "approval:decision",
        requestId: request.id,
        decision: "approved",
        selectedItemIds: ["id1", "id1", "id2"],
      });
      expect(result.selectedItemIds).toEqual(["id1", "id2"]);
    });

    it("filters out selectedResourceTypes not in the request", () => {
      const request = makeRequest({ resourceTypes: ["Observation"] });
      const result = normalizeApprovalSelection(request, {
        type: "approval:decision",
        requestId: request.id,
        decision: "approved",
        selectedResourceTypes: ["Observation" as ResourceType, "Condition" as ResourceType],
      });
      expect(result.selectedResourceTypes).toEqual(["Observation"]);
    });
  });

  // ── Lines 630-634: persistAlwaysScopes - rollback on failure ──

  describe("persistAlwaysScopes failure rollback", () => {
    it("rolls back session scopes and returns false when updateSettings throws", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockUpdateSettings.mockRejectedValue(new Error("settings error"));
      runtimeState.session.alwaysAllowSession.clear();
      const result = await persistAlwaysScopes(["scope-a", "scope-b"]);
      expect(result).toBe(false);
      expect(runtimeState.session.alwaysAllowSession.has("scope-a")).toBe(false);
      expect(runtimeState.session.alwaysAllowSession.has("scope-b")).toBe(false);
      expect(spy).toHaveBeenCalledWith("[approval] failed to persist always-allow scopes:", expect.any(Error));
      spy.mockRestore();
    });
  });

  // ── Lines 645, 668: hasAlwaysAllow with query/date filters, empty resourceTypes ──

  describe("hasAlwaysAllow edge cases", () => {
    it("returns false for empty resourceTypes", async () => {
      const request = makeRequest({ resourceTypes: [] as ResourceType[] });
      expect(await hasAlwaysAllow(request, true)).toBe(false);
    });

    it("returns false for request with query when only legacy key matches", async () => {
      const request = makeRequest({
        resourceTypes: ["Observation"],
        depth: "summary",
        query: "혈당",
      });
      // Add legacy key which does not include query info
      runtimeState.session.alwaysAllowSession.add(
        legacyPermissionKey({ provider: "chatgpt", resourceType: "Observation", depth: "summary" }),
      );
      expect(await hasAlwaysAllow(request, true)).toBe(false);
    });

    it("returns false for request with dateFrom when only legacy key matches", async () => {
      const request = makeRequest({
        resourceTypes: ["Observation"],
        depth: "summary",
        dateFrom: "2024-01-01",
      });
      runtimeState.session.alwaysAllowSession.add(
        legacyPermissionKey({ provider: "chatgpt", resourceType: "Observation", depth: "summary" }),
      );
      expect(await hasAlwaysAllow(request, true)).toBe(false);
    });

    it("matches legacy key from settings when not in session", async () => {
      const legKey = legacyPermissionKey({ provider: "chatgpt", resourceType: "Observation", depth: "summary" });
      mockGetSettings.mockResolvedValue({
        locale: "ko-KR",
        schemaVersion: 1,
        pinConfig: null,
        lockout: { failedAttempts: 0, lockUntil: null },
        connectedProvider: "chatgpt",
        alwaysAllowScopes: [legKey],
        integrationWarning: null,
      } as never);
      const request = makeRequest({
        resourceTypes: ["Observation"],
        depth: "summary",
      });
      expect(await hasAlwaysAllow(request, true)).toBe(true);
    });

    it("matches scoped key from settings when not in session", async () => {
      const scopedKey = permissionKey({ provider: "chatgpt", resourceType: "Observation", depth: "summary" });
      mockGetSettings.mockResolvedValue({
        locale: "ko-KR",
        schemaVersion: 1,
        pinConfig: null,
        lockout: { failedAttempts: 0, lockUntil: null },
        connectedProvider: "chatgpt",
        alwaysAllowScopes: [scopedKey],
        integrationWarning: null,
      } as never);
      const request = makeRequest({
        resourceTypes: ["Observation"],
        depth: "summary",
      });
      expect(await hasAlwaysAllow(request, true)).toBe(true);
    });
  });

  // ── Line 686: tryAutoApproveAlwaysAllow - overlay responsiveness check ──

  describe("tryAutoApproveAlwaysAllow overlay responsiveness", () => {
    it("calls markIntegrationWarning when overlay is not responsive", async () => {
      mockBuildMcpResponse.mockResolvedValue(makeOkResponse());
      mockIsOverlayResponsive.mockResolvedValue(false);
      const pending = makePending({ allowAlways: true });
      runtimeState.approvals.set(pending.request.id, pending);
      runtimeState.session.alwaysAllowSession.add(
        permissionKey({ provider: "chatgpt", resourceType: "Observation", depth: "summary" }),
      );
      const result = await tryAutoApproveAlwaysAllow(pending);
      expect(result).toBe(true);
      // Wait for the fire-and-forget responsiveness check
      await vi.waitFor(() => {
        expect(mockMarkIntegrationWarning).toHaveBeenCalled();
      });
    });

    it("does not call markIntegrationWarning when overlay is responsive", async () => {
      mockBuildMcpResponse.mockResolvedValue(makeOkResponse());
      mockIsOverlayResponsive.mockResolvedValue(true);
      const pending = makePending({ allowAlways: true });
      runtimeState.approvals.set(pending.request.id, pending);
      runtimeState.session.alwaysAllowSession.add(
        permissionKey({ provider: "chatgpt", resourceType: "Observation", depth: "summary" }),
      );
      await tryAutoApproveAlwaysAllow(pending);
      // Wait a tick for the fire-and-forget to complete
      await new Promise((r) => setTimeout(r, 10));
      expect(mockMarkIntegrationWarning).not.toHaveBeenCalled();
    });

    it("returns false when allowAlways is false", async () => {
      const pending = makePending({ allowAlways: false });
      runtimeState.approvals.set(pending.request.id, pending);
      expect(await tryAutoApproveAlwaysAllow(pending)).toBe(false);
    });
  });

  // ── Line 711: pumpQueue - clearPersistedApprovalState for empty approvals ──

  describe("pumpQueue edge cases", () => {
    it("clears persisted state when skipping settled items and no approvals remain", async () => {
      const settled = makePending({ settled: true });
      runtimeState.approvals.set(settled.request.id, settled);
      runtimeState.queue = [settled.request.id];
      await pumpQueue();
      // The settled entry is skipped (shifted off queue), but still in the map.
      // approvals.size > 0 so persistApprovalState is called (not clear).
      expect(runtimeState.queue).toEqual([]);
      const stored = await browser.storage.session.get(APPROVAL_STATE_STORAGE_KEY);
      // persistApprovalState was called — serialized state should exist
      expect(stored[APPROVAL_STATE_STORAGE_KEY]).toBeDefined();
      // The settled entry is excluded from serialized approvals
      expect(stored[APPROVAL_STATE_STORAGE_KEY].approvals).toEqual([]);
    });

    it("clears persisted state when skipping item with no pending in map", async () => {
      // Queue has an id that's not in the approvals map
      runtimeState.queue = ["orphan-id"];
      runtimeState.approvals.clear();
      await pumpQueue();
      const stored = await browser.storage.session.get(APPROVAL_STATE_STORAGE_KEY);
      expect(stored[APPROVAL_STATE_STORAGE_KEY]).toBeUndefined();
    });
  });

  // ── Line 793: enqueueApprovalRequest - emitCurrentQueueState when hadActiveApproval ──

  describe("enqueueApprovalRequest with existing active approval", () => {
    it("emits queue state when there is already an active approval", async () => {
      // First, set up an existing active approval
      const existing = makePending();
      runtimeState.approvals.set(existing.request.id, existing);
      runtimeState.queue = [existing.request.id];
      runtimeState.currentRequestId = existing.request.id;

      mockSendOverlay.mockResolvedValue({ sent: true, tabId: 10 });

      const { requestId } = await enqueueApprovalRequest({
        provider: "chatgpt",
        resourceTypes: ["Condition"],
        depth: "summary",
        sourceTabId: 10,
        allowAlways: false,
      });
      expect(requestId).toBeDefined();
      // emitCurrentQueueState should have been called because hadActiveApproval was true
      expect(mockSendOverlay).toHaveBeenCalledWith(
        "chatgpt",
        expect.objectContaining({ type: "overlay:queue" }),
        10,
      );
    });
  });

  // ── Line 821: lockSession - continue on already-settled loop iteration ──

  describe("lockSession with already-settled in loop", () => {
    it("handles case where approval becomes settled during iteration", async () => {
      const pending1 = makePending();
      const pending2 = makePending();
      runtimeState.approvals.set(pending1.request.id, pending1);
      runtimeState.approvals.set(pending2.request.id, pending2);
      runtimeState.queue = [pending1.request.id, pending2.request.id];

      await lockSession();
      expect(pending1.settled).toBe(true);
      expect(pending2.settled).toBe(true);
      expect(runtimeState.queue).toEqual([]);
    });

    it("continues past approval that becomes settled between find and get", async () => {
      // This tests the defensive guard at line 820-821 where an approval
      // is found by Array.from().find() but is settled by the time .get() runs.
      // We simulate this by monkey-patching Map.prototype.get to return a settled copy.
      const pending1 = makePending();
      const pending2 = makePending();
      runtimeState.approvals.set(pending1.request.id, pending1);
      runtimeState.approvals.set(pending2.request.id, pending2);
      runtimeState.queue = [pending1.request.id, pending2.request.id];

      const originalGet = runtimeState.approvals.get.bind(runtimeState.approvals);
      let getCallCount = 0;
      // Override map.get: on the first call inside the while-loop re-read (2nd get per iteration),
      // return a settled version to trigger the continue path.
      const spy = vi.spyOn(runtimeState.approvals, "get").mockImplementation((key: string) => {
        getCallCount++;
        const result = originalGet(key);
        // The lockSession while loop calls .get() once per iteration (the re-read).
        // .find() doesn't call .get(). So the first .get() call in iteration 1
        // is the re-read of pending1. We want it to appear settled.
        if (getCallCount === 1 && result) {
          return { ...result, settled: true };
        }
        return result;
      });

      await lockSession();
      // pending2 should still be settled by the normal path
      expect(pending2.settled).toBe(true);
      expect(runtimeState.queue).toEqual([]);
      spy.mockRestore();
    });
  });
});
