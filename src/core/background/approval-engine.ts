import {
  MAX_RECORDS_PER_RESPONSE,
  ReadHealthRecordsRequestSchema,
  buildMcpErrorResponse,
  buildMcpTimeoutResponse,
  type AuditLogEntry,
  type McpDataRecord,
  type McpDepth,
  type PermissionLevel,
  type ResourceCountMap,
  type ReadHealthRecordsResponse,
  type ResourceType,
  type AiProvider,
} from "../../../packages/contracts/src/index";
import { MCP_TIMEOUT_MS, MAX_QUEUE_LENGTH } from "../constants";
import { buildMcpResponse } from "../mcp";
import { addAuditLog } from "../db";
import type { ApprovalResourceOption, McpApprovalRequest } from "../models";
import type { RuntimeRequest } from "../messages";
import { resourceLabel } from "../utils";
import {
  runtimeState,
  APPROVAL_STATE_STORAGE_KEY,
  nowIso,
  getBackgroundInitPromise,
  setBackgroundInitPromise,
  type PendingApproval,
  type PersistedPendingApproval,
  type PersistedApprovalState,
} from "./state";
import { permissionKey, legacyPermissionKey } from "./permission-scope";
import { getSettings, updateSettings } from "./settings";
import { sendOverlay, isOverlayResponsiveForRequest, markIntegrationWarning } from "./overlay";

// ── Approval timer management ──

export function clearPendingApprovalTimer(pending: PendingApproval): void {
  if (pending.timerId) {
    clearTimeout(pending.timerId);
    pending.timerId = null;
  }
}

export function armPendingApprovalTimer(pending: PendingApproval): void {
  clearPendingApprovalTimer(pending);
  const remainingMs = Math.max(0, pending.request.deadlineAt - Date.now());
  /* v8 ignore next 5 -- requires deadline exactly at Date.now(); tested via fake timers advancing past deadline */
  if (remainingMs === 0) {
    queueMicrotask(() => {
      void handleApprovalTimeout(pending.request.id);
    });
    return;
  }
  pending.timerId = setTimeout(() => {
    void handleApprovalTimeout(pending.request.id);
  }, remainingMs);
}

// ── State persistence ──

export function serializeApprovalState(): PersistedApprovalState {
  const approvals: PersistedPendingApproval[] = [];
  for (const [, pending] of runtimeState.approvals) {
    if (pending.settled) {
      continue;
    }
    approvals.push({
      id: pending.request.id,
    });
  }
  return {
    queue: [...runtimeState.queue],
    approvals,
  };
}

export async function persistApprovalState(): Promise<void> {
  try {
    await browser.storage.session.set({
      [APPROVAL_STATE_STORAGE_KEY]: serializeApprovalState(),
    });
  } catch (error) {
    console.error("[approval] failed to persist state:", error);
  }
}

export async function clearPersistedApprovalState(): Promise<void> {
  try {
    await browser.storage.session.remove(APPROVAL_STATE_STORAGE_KEY);
  } catch (error) {
    console.error("[approval] failed to clear persisted state:", error);
  }
}

export async function restoreApprovalState(): Promise<void> {
  if (runtimeState.approvals.size > 0 || runtimeState.queue.length > 0 || runtimeState.currentRequestId) {
    return;
  }

  let raw: unknown;
  try {
    const stored = await browser.storage.session.get(APPROVAL_STATE_STORAGE_KEY);
    raw = stored?.[APPROVAL_STATE_STORAGE_KEY];
  } catch (error) {
    console.error("[approval] failed to read persisted state:", error);
    return;
  }

  if (!raw || typeof raw !== "object") {
    return;
  }

  const candidate = raw as Partial<PersistedApprovalState>;
  const approvals = Array.isArray(candidate.approvals) ? candidate.approvals : [];
  if (approvals.length > 0) {
    await updateSettings((settings) => {
      settings.integrationWarning = "이전 승인 요청이 초기화되었습니다. AI에서 다시 질문해 주세요.";
    });
  }
  await clearPersistedApprovalState();
}

export function ensureBackgroundReady(): Promise<void> {
  if (!getBackgroundInitPromise()) {
    setBackgroundInitPromise(
      restoreApprovalState().catch((error) => {
        console.error("[approval] failed to restore persisted state:", error);
      }),
    );
  }
  return getBackgroundInitPromise()!;
}

// ── Approval summary / preview ──

export function toResourceCountMap(response: ReadHealthRecordsResponse, resourceTypes: ResourceType[]): ResourceCountMap | undefined {
  if (response.status !== "ok") {
    return undefined;
  }

  const allowed = new Set(resourceTypes);
  const map: Partial<Record<ResourceType, number>> = {};
  for (const resource of response.resources) {
    if (!allowed.has(resource.resource_type) || resource.count <= 0) {
      continue;
    }
    map[resource.resource_type] = resource.count;
  }

  return Object.keys(map).length > 0 ? map : undefined;
}

export function buildApprovalSummary(resourceTypes: ResourceType[], query?: string): string {
  const labels = resourceTypes.map(resourceLabel);
  const head = labels.join(" • ");
  if (query) {
    return `${head}${head ? " — " : ""}${query}`;
  }
  return head;
}

export function approvalItemLabel(record: McpDataRecord): string {
  const display = record.display?.trim();
  const date = record.date?.trim();
  const valueText = typeof record.value === "number"
    ? `${record.value}${record.unit ? ` ${record.unit}` : ""}`.trim()
    : record.value?.trim();
  const code = record.code?.trim();

  if (display && valueText) {
    return date ? `${display} ${valueText} (${date})` : `${display} ${valueText}`;
  }
  if (display) {
    return date ? `${display} (${date})` : display;
  }
  if (code && valueText) {
    return `${code} ${valueText}`;
  }
  if (code) {
    return date ? `${code} (${date})` : code;
  }
  if (valueText) {
    return date ? `${valueText} (${date})` : valueText;
  }
  return record.id;
}

export function parseReadRequestPayload(payload: {
  resourceTypes: ResourceType[];
  depth: McpDepth;
  query?: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  return ReadHealthRecordsRequestSchema.safeParse({
    resource_types: payload.resourceTypes,
    depth: payload.depth,
    query: payload.query,
    date_from: payload.dateFrom,
    date_to: payload.dateTo,
    limit: MAX_RECORDS_PER_RESPONSE,
  });
}

export async function buildApprovalPreview(payload: {
  resourceTypes: ResourceType[];
  depth: McpDepth;
  query?: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<{ extensionSummary: string; resourceOptions?: ApprovalResourceOption[] }> {
  const fallbackSummary = buildApprovalSummary(payload.resourceTypes, payload.query);
  if (!runtimeState.session.isUnlocked || !runtimeState.session.key) {
    return {
      extensionSummary: fallbackSummary,
      resourceOptions: undefined,
    };
  }

  const parsed = parseReadRequestPayload(payload);
  if (!parsed.success) {
    return {
      extensionSummary: fallbackSummary,
      resourceOptions: undefined,
    };
  }

  try {
    const response = await buildMcpResponse(runtimeState.session.key, parsed.data);
    const counts = response.resources
      .filter((resource) => resource.count > 0)
      .map((resource) => `${resourceLabel(resource.resource_type)} ${resource.count}건`);
    const extensionSummary = counts.length > 0
      ? (payload.query ? `${counts.join(" • ")} — ${payload.query}` : counts.join(" • "))
      : fallbackSummary;

    if (response.status !== "ok") {
      return { extensionSummary, resourceOptions: undefined };
    }

    const resourceOptions = response.resources
      .map((resource) => ({
        resourceType: resource.resource_type,
        count: resource.count,
        items: resource.data.map((item) => ({
          id: item.id,
          label: approvalItemLabel(item),
        })),
      }))
      .filter((resource) => resource.items.length > 0);

    return {
      extensionSummary,
      resourceOptions: resourceOptions.length > 0 ? resourceOptions : undefined,
    };
  } catch {
    return {
      extensionSummary: fallbackSummary,
      resourceOptions: undefined,
    };
  }
}

export async function hydrateApprovalPreview(requestId: string): Promise<void> {
  const pending = runtimeState.approvals.get(requestId);
  if (!pending || pending.settled) {
    return;
  }

  const preview = await buildApprovalPreview({
    resourceTypes: pending.request.resourceTypes,
    depth: pending.request.depth,
    query: pending.request.query,
    dateFrom: pending.request.dateFrom,
    dateTo: pending.request.dateTo,
  });

  const current = runtimeState.approvals.get(requestId);
  if (!current || current.settled) {
    return;
  }

  current.request.extensionSummary = preview.extensionSummary;
  current.request.resourceOptions = preview.resourceOptions;

  if (runtimeState.currentRequestId === requestId) {
    await sendOverlay(
      current.request.provider,
      {
        type: "overlay:update-approval",
        request: current.request,
        queueLength: additionalQueueLength(),
      },
      current.sourceTabId,
    );
  }
}

// ── Audit ──

export async function addAudit(
  request: McpApprovalRequest,
  response: ReadHealthRecordsResponse,
  result: "approved" | "denied" | "timeout" | "error",
  permissionLevel: PermissionLevel,
  sharedResourceTypes?: ResourceType[],
  reason?: string,
): Promise<void> {
  const approved = result === "approved";
  const effectiveSharedTypes = approved && sharedResourceTypes?.length ? [...sharedResourceTypes] : undefined;
  const requestedCounts = toResourceCountMap(response, request.resourceTypes);
  const sharedCounts = approved && effectiveSharedTypes ? toResourceCountMap(response, effectiveSharedTypes) : undefined;
  const audit: AuditLogEntry = {
    id: crypto.randomUUID(),
    timestamp: nowIso(),
    ai_provider: request.provider,
    resource_types: request.resourceTypes,
    requested_resource_counts: requestedCounts,
    shared_resource_types: effectiveSharedTypes,
    shared_resource_counts: sharedCounts,
    depth: request.depth,
    result,
    permission_level: permissionLevel,
    reason,
  };
  await addAuditLog(audit);
}

// ── Core settlement ──

export async function settleApproval(
  requestId: string,
  response: ReadHealthRecordsResponse,
  auditResult: "approved" | "denied" | "timeout" | "error",
  permissionLevel: PermissionLevel,
  sharedResourceTypes?: ResourceType[],
  reason?: string,
): Promise<boolean> {
  const pending = runtimeState.approvals.get(requestId);
  if (!pending || pending.settled) {
    return false;
  }

  pending.settled = true;
  clearPendingApprovalTimer(pending);
  if (pending.renderWatchdogId) {
    clearTimeout(pending.renderWatchdogId);
    pending.renderWatchdogId = null;
  }
  runtimeState.approvals.delete(requestId);
  runtimeState.queue = runtimeState.queue.filter((id) => id !== requestId);
  if (runtimeState.currentRequestId === requestId) {
    runtimeState.currentRequestId = null;
  }
  if (runtimeState.approvals.size === 0) {
    await clearPersistedApprovalState();
  } else {
    await persistApprovalState();
  }

  try {
    await addAudit(pending.request, response, auditResult, permissionLevel, sharedResourceTypes, reason);
  } catch (error) {
    console.error("[approval] failed to write audit log:", error);
  }

  try {
    await sendOverlay(
      pending.request.provider,
      {
        type: "overlay:resolved",
        requestId,
        status: auditResult,
      },
      pending.sourceTabId,
    );
  } catch (error) {
    console.error("[approval] failed to notify overlay:", error);
  } finally {
    pending.resolve(response);
  }
  return true;
}

export async function handleApprovalTimeout(requestId: string): Promise<void> {
  const pending = runtimeState.approvals.get(requestId);
  if (!pending || pending.settled) {
    return;
  }

  const response = buildMcpTimeoutResponse(pending.request.depth);
  await settleApproval(requestId, response, "timeout", "one-time", undefined, "approval timeout");
  await pumpQueue();
}

// ── Queue state emission ──

export function additionalQueueLength(): number {
  if (!runtimeState.currentRequestId) {
    return runtimeState.queue.length;
  }
  return Math.max(0, runtimeState.queue.length - 1);
}

export async function emitQueueState(provider: AiProvider, sourceTabId?: number | null): Promise<void> {
  await sendOverlay(
    provider,
    {
      type: "overlay:queue",
      queueLength: additionalQueueLength(),
    },
    sourceTabId,
  );
}

export async function emitCurrentQueueState(): Promise<void> {
  if (!runtimeState.currentRequestId) {
    return;
  }

  const pending = runtimeState.approvals.get(runtimeState.currentRequestId);
  if (!pending || pending.settled) {
    return;
  }

  await emitQueueState(pending.request.provider, pending.sourceTabId);
}

// ── Render watchdog ──

export function armRenderWatchdog(requestId: string, delayMs = 12_000): void {
  const pending = runtimeState.approvals.get(requestId);
  if (!pending || pending.settled || pending.overlayRendered) {
    return;
  }
  if (pending.renderWatchdogId) {
    clearTimeout(pending.renderWatchdogId);
    pending.renderWatchdogId = null;
  }

  pending.renderWatchdogId = setTimeout(() => {
    void (async () => {
      const current = runtimeState.approvals.get(requestId);
      if (!current || current.settled || current.overlayRendered) {
        return;
      }

      current.renderWatchdogChecks += 1;
      const responsive = await isOverlayResponsiveForRequest(current);
      if (responsive && current.renderWatchdogChecks < 3) {
        armRenderWatchdog(requestId, 8_000);
        return;
      }

      await markIntegrationWarning();
      const response = buildMcpErrorResponse(
        current.request.depth,
        "CONTENT_SCRIPT_RENDER_FAILED",
        "Extension update required",
        false,
      );
      await settleApproval(requestId, response, "error", "one-time", undefined, "content script render failed");
      await pumpQueue();
    })();
  }, delayMs);
}

// ── Presentation ──

export async function presentApproval(request: McpApprovalRequest): Promise<void> {
  const settings = await getSettings();
  const event = runtimeState.session.isUnlocked
    ? {
        type: "overlay:show-approval" as const,
        request,
        queueLength: additionalQueueLength(),
      }
    : {
        type: "overlay:request-unlock" as const,
        request,
        queueLength: additionalQueueLength(),
        lockoutUntil: settings.lockout.lockUntil,
      };

  const pending = runtimeState.approvals.get(request.id);
  if (pending) {
    pending.overlayRendered = false;
    pending.renderWatchdogChecks = 0;
    armRenderWatchdog(request.id, 12_000);
  }

  let sent = await sendOverlay(request.provider, event, pending?.sourceTabId);
  if (!sent.sent) {
    await new Promise((resolve) => {
      setTimeout(resolve, 400);
    });
    sent = await sendOverlay(request.provider, event, pending?.sourceTabId);
  }

  if (!sent.sent) {
    if (pending?.renderWatchdogId) {
      clearTimeout(pending.renderWatchdogId);
      pending.renderWatchdogId = null;
    }
    await markIntegrationWarning();
    const response = buildMcpErrorResponse(
      request.depth,
      "CONTENT_SCRIPT_UNAVAILABLE",
      "Extension update required",
      false,
    );
    await settleApproval(request.id, response, "error", "one-time", undefined, "content script unavailable");
    await pumpQueue();
    return;
  }

  // watchdog is armed before sendOverlay to avoid ACK race.
}

// ── Approval execution ──

export async function runApproval(
  request: McpApprovalRequest,
  selectedResourceTypes?: ResourceType[],
): Promise<ReadHealthRecordsResponse> {
  if (!runtimeState.session.isUnlocked || !runtimeState.session.key) {
    return buildMcpErrorResponse(request.depth, "LOCKED_SESSION", "PIN unlock required", false);
  }

  const parsed = parseReadRequestPayload({
    resourceTypes: selectedResourceTypes?.length ? selectedResourceTypes : request.resourceTypes,
    depth: request.depth,
    query: request.query,
    dateFrom: request.dateFrom,
    dateTo: request.dateTo,
  });

  if (!parsed.success) {
    return buildMcpErrorResponse(request.depth, "INVALID_REQUEST", "Invalid request", false);
  }

  try {
    return await buildMcpResponse(runtimeState.session.key, parsed.data);
  } catch (error) {
    console.error("[approval] failed to build MCP response:", error);
    return buildMcpErrorResponse(request.depth, "INTERNAL_ERROR", "Internal processing error", true);
  }
}

export function applyApprovalItemSelection(
  response: ReadHealthRecordsResponse,
  selectedItemIds: Set<string>,
): ReadHealthRecordsResponse {
  if (response.status !== "ok" || selectedItemIds.size === 0) {
    return response;
  }

  const resources = response.resources.map((resource) => {
    const filtered = resource.data.filter((item) => selectedItemIds.has(item.id));
    return {
      ...resource,
      data: filtered,
      count: filtered.length,
    };
  });

  const count = resources.reduce((acc, resource) => acc + resource.count, 0);
  return {
    ...response,
    resources,
    count,
    meta: {
      ...response.meta,
      filtered_count: count,
      query_matched: response.meta.query_matched ? count > 0 : false,
    },
  };
}

export function normalizeApprovalSelection(
  request: McpApprovalRequest,
  message: Extract<RuntimeRequest, { type: "approval:decision" }>,
): { selectedResourceTypes: ResourceType[]; selectedItemIds: string[] } {
  const requestedTypes = new Set(request.resourceTypes);
  const requestedSelection: ResourceType[] = message.selectedResourceTypes?.length
    ? message.selectedResourceTypes
    : request.resourceTypes;
  const selectedResourceTypes = requestedSelection.filter(
    (type: ResourceType, index: number, array: ResourceType[]) => requestedTypes.has(type) && array.indexOf(type) === index,
  );
  const selectedItemIds = Array.isArray(message.selectedItemIds)
    ? [...new Set(message.selectedItemIds.filter((id): id is string => typeof id === "string" && id.length > 0))]
    : [];
  return { selectedResourceTypes, selectedItemIds };
}

export function computeApprovalSharedTypes(
  response: ReadHealthRecordsResponse,
  fallbackResourceTypes: ResourceType[],
): ResourceType[] {
  if (response.status !== "ok") {
    return fallbackResourceTypes;
  }
  return response.resources
    .filter((resource) => resource.count > 0)
    .map((resource) => resource.resource_type);
}

// ── Always-allow scopes ──

export async function persistAlwaysScopes(keys: string[]): Promise<boolean> {
  const uniqueKeys = [...new Set(keys)];
  if (uniqueKeys.length === 0) {
    return true;
  }

  for (const key of uniqueKeys) {
    runtimeState.session.alwaysAllowSession.add(key);
  }

  try {
    await updateSettings((settings) => {
      const merged = new Set(settings.alwaysAllowScopes);
      for (const key of uniqueKeys) {
        merged.add(key);
      }
      settings.alwaysAllowScopes = [...merged];
    });
    return true;
  } catch (error) {
    for (const key of uniqueKeys) {
      runtimeState.session.alwaysAllowSession.delete(key);
    }
    console.error("[approval] failed to persist always-allow scopes:", error);
    return false;
  }
}

export async function tryAutoApproveAlwaysAllow(pending: PendingApproval): Promise<boolean> {
  if (!runtimeState.session.isUnlocked || !pending.allowAlways || !(await hasAlwaysAllow(pending.request, pending.allowAlways))) {
    return false;
  }

  void isOverlayResponsiveForRequest(pending).then((responsive) => {
    if (!responsive) {
      void markIntegrationWarning();
    }
  });

  const response = await runApproval(pending.request);
  const auditResult = response.status === "ok" ? "approved" : "error";
  const sharedTypes = response.status === "ok" ? pending.request.resourceTypes : undefined;
  await settleApproval(
    pending.request.id,
    response,
    auditResult,
    "always",
    sharedTypes,
    "always allow scope",
  );
  return true;
}

export async function hasAlwaysAllow(request: McpApprovalRequest, allowAlways: boolean): Promise<boolean> {
  if (!allowAlways) {
    return false;
  }
  if (request.resourceTypes.length === 0) {
    return false;
  }

  const settings = await getSettings();
  return request.resourceTypes.every((resourceType: ResourceType) => {
    const scopedKey = permissionKey({
      provider: request.provider,
      resourceType,
      depth: request.depth,
      query: request.query,
      dateFrom: request.dateFrom,
      dateTo: request.dateTo,
    });
    if (runtimeState.session.alwaysAllowSession.has(scopedKey) || settings.alwaysAllowScopes.includes(scopedKey)) {
      return true;
    }

    if (request.query || request.dateFrom || request.dateTo) {
      return false;
    }

    const legacyKey = legacyPermissionKey({
      provider: request.provider,
      resourceType,
      depth: request.depth,
    });
    return runtimeState.session.alwaysAllowSession.has(legacyKey) || settings.alwaysAllowScopes.includes(legacyKey);
  });
}

// ── Queue pump ──

export async function pumpQueue(): Promise<void> {
  while (!runtimeState.currentRequestId) {
    const nextId = runtimeState.queue[0];
    if (!nextId) {
      return;
    }

    const pending = runtimeState.approvals.get(nextId);
    if (!pending || pending.settled) {
      runtimeState.queue.shift();
      if (runtimeState.approvals.size === 0) {
        await clearPersistedApprovalState();
      } else {
        await persistApprovalState();
      }
      continue;
    }

    runtimeState.currentRequestId = nextId;

    if (await tryAutoApproveAlwaysAllow(pending)) {
      // settleApproval clears currentRequestId; loop continues to next item
      continue;
    }

    await presentApproval(pending.request);
    await emitQueueState(pending.request.provider, pending.sourceTabId);
    return;
  }
}

// ── Enqueue ──

export async function enqueueApprovalRequest(payload: {
  provider: AiProvider;
  resourceTypes: ResourceType[];
  depth: McpDepth;
  query?: string;
  dateFrom?: string;
  dateTo?: string;
  sourceTabId: number;
  allowAlways: boolean;
}): Promise<{ requestId: string; promise: Promise<ReadHealthRecordsResponse> }> {
  if (runtimeState.session.isLocking) {
    throw new Error("세션 상태를 정리 중입니다. 잠시 후 다시 시도해 주세요.");
  }
  const receivedAt = Date.now();
  const request: McpApprovalRequest = {
    id: crypto.randomUUID(),
    provider: payload.provider,
    resourceTypes: payload.resourceTypes,
    depth: payload.depth,
    query: payload.query,
    dateFrom: payload.dateFrom,
    dateTo: payload.dateTo,
    aiDescription: payload.query ? `"${payload.query}" 관련 건강기록을 확인하려고 합니다.` : "건강기록을 확인하려고 합니다.",
    extensionSummary: buildApprovalSummary(payload.resourceTypes, payload.query),
    resourceOptions: undefined,
    createdAt: nowIso(),
    deadlineAt: receivedAt + MCP_TIMEOUT_MS,
  };
  /* v8 ignore next 2 -- short-circuit branches from && chain; all paths tested across always-allow and queue tests */
  const shouldAttemptAlwaysAuto = runtimeState.session.isUnlocked && payload.allowAlways && await hasAlwaysAllow(request, true);
  if (!shouldAttemptAlwaysAuto && runtimeState.queue.length >= MAX_QUEUE_LENGTH) {
    throw new Error("요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
  }

  const promise = new Promise<ReadHealthRecordsResponse>((resolve) => {
    runtimeState.approvals.set(request.id, {
      request,
      allowAlways: payload.allowAlways,
      timerId: null,
      renderWatchdogId: null,
      renderWatchdogChecks: 0,
      overlayRendered: false,
      resolve,
      settled: false,
      sourceTabId: payload.sourceTabId,
    });
  });
  const pending = runtimeState.approvals.get(request.id);
  /* v8 ignore next 4 -- pending is always defined here; guard is for type narrowing */
  if (pending && shouldAttemptAlwaysAuto && await tryAutoApproveAlwaysAllow(pending)) {
    return { requestId: request.id, promise };
  }
  if (pending) {
    armPendingApprovalTimer(pending);
    void hydrateApprovalPreview(request.id);
  }

  const hadActiveApproval = Boolean(runtimeState.currentRequestId);
  runtimeState.queue.push(request.id);
  await persistApprovalState();
  await pumpQueue();
  if (hadActiveApproval) {
    await emitCurrentQueueState();
  }

  return { requestId: request.id, promise };
}

// ── Session lock ──

export async function lockSession(reason = "session locked"): Promise<void> {
  if (runtimeState.session.isLocking) {
    return;
  }
  runtimeState.session.isLocking = true;

  try {
    runtimeState.session.isUnlocked = false;
    runtimeState.session.key = null;
    runtimeState.session.alwaysAllowSession.clear();

    while (true) {
      const pending = Array.from(runtimeState.approvals.values()).find((item) => !item.settled);
      if (!pending) {
        break;
      }
      const requestId = pending.request.id;

      const current = runtimeState.approvals.get(requestId);
      if (!current || current.settled) {
        continue;
      }

      const response = buildMcpErrorResponse(current.request.depth, "LOCKED_SESSION", "Session locked", false);
      await settleApproval(requestId, response, "error", "one-time", undefined, reason);
    }

    runtimeState.queue = [];
    runtimeState.currentRequestId = null;
    await clearPersistedApprovalState();
  } finally {
    runtimeState.session.isLocking = false;
  }
}
