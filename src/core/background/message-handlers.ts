import {
  PermissionLevelSchema,
  buildMcpDeniedResponse,
  buildMcpErrorResponse,
} from "../../../packages/contracts/src/index";
import { generateSaltBase64, deriveAesKey, derivePinVerifier } from "../crypto";
import { listAuditLogs, listFileSummaries, getResourceSummary } from "../db";
import type { VaultPermissionScope } from "../models";
import type { RuntimeRequest, RuntimeResponse } from "../messages";
import { providerLabel } from "../utils";
import { VAULT_PAGE_PATH } from "../constants";
import { runtimeState, RUNTIME_MODE, INTEGRATION_WARNING_MESSAGE } from "./state";
import { permissionKey, legacyPermissionKey, parsePermissionScope } from "./permission-scope";
import {
  isTrustedSenderForProvider,
  isTrustedOverlaySender,
  untrustedResponse,
  requireVaultSender,
  requireVaultOrSetupSender,
} from "./sender-validation";
import {
  getSettings,
  updateSettings,
  toPublicSettings,
  isSixDigitPin,
} from "./settings";
import { checkAndTrackRequestRate, ensureVaultTab, ensureSetupTab } from "./tab-manager";
import { sendOverlay } from "./overlay";
import { handleUpload, handleDownload, handleDeleteFile } from "./file-operations";
import {
  lockSession,
  pumpQueue,
  enqueueApprovalRequest,
  settleApproval,
  runApproval,
  applyApprovalItemSelection,
  normalizeApprovalSelection,
  computeApprovalSharedTypes,
  persistAlwaysScopes,
  parseReadRequestPayload,
  emitQueueState,
} from "./approval-engine";
import { verifyAndUnlock } from "./settings";
import { markIntegrationWarning } from "./overlay";

// ── Individual handlers ──

export async function handleGetState(): Promise<RuntimeResponse> {
  const settings = await getSettings();
  const publicSettings = toPublicSettings(settings);
  const hasPin = Boolean(settings.pinConfig);

  if (!runtimeState.session.isUnlocked) {
    return {
      ok: true,
      settings: publicSettings,
      session: {
        isUnlocked: false,
        hasPin,
        lockoutUntil: settings.lockout.lockUntil,
      },
      files: [],
      auditLogs: [],
      summary: {},
    };
  }

  const [files, logs, summary] = await Promise.all([listFileSummaries(), listAuditLogs(100), getResourceSummary()]);

  return {
    ok: true,
    settings: publicSettings,
    session: {
      isUnlocked: true,
      hasPin,
      lockoutUntil: settings.lockout.lockUntil,
    },
    files,
    auditLogs: logs,
    summary,
  };
}

export async function handleSetupPin(
  message: Extract<RuntimeRequest, { type: "session:setup-pin" }>,
  sender: chrome.runtime.MessageSender,
): Promise<RuntimeResponse> {
  const guard = requireVaultOrSetupSender(sender);
  if (guard) {
    return guard;
  }
  if (!isSixDigitPin(message.pin)) {
    return { ok: false, error: "PIN 6자리를 입력해 주세요." };
  }

  const existing = await getSettings();
  if (existing.pinConfig) {
    return { ok: false, error: "이미 PIN이 설정되어 있습니다." };
  }

  const salt = generateSaltBase64();
  const verifier = await derivePinVerifier(message.pin, salt);
  const key = await deriveAesKey(message.pin, salt);

  await updateSettings((settings) => {
    settings.pinConfig = { salt, verifier };
    settings.locale = message.locale;
    settings.lockout.failedAttempts = 0;
    settings.lockout.lockUntil = null;
  });

  runtimeState.session.key = key;
  runtimeState.session.isUnlocked = true;

  return { ok: true, isUnlocked: true, lockoutUntil: null };
}

export async function handleSessionUnlock(
  message: Extract<RuntimeRequest, { type: "session:unlock" }>,
  sender: chrome.runtime.MessageSender,
): Promise<RuntimeResponse> {
  const guard = requireVaultSender(sender);
  if (guard) {
    return guard;
  }
  if (!isSixDigitPin(message.pin)) {
    return { ok: true, isUnlocked: false, lockoutUntil: null };
  }

  const result = await verifyAndUnlock(message.pin);
  if (result.unlocked && runtimeState.currentRequestId) {
    const pending = runtimeState.approvals.get(runtimeState.currentRequestId);
    if (pending && !pending.settled) {
      runtimeState.currentRequestId = null;
      await pumpQueue();
    }
  }
  return {
    ok: true,
    isUnlocked: result.unlocked,
    lockoutUntil: result.lockoutUntil,
  };
}

export async function handleSessionLock(sender: chrome.runtime.MessageSender): Promise<RuntimeResponse> {
  const guard = requireVaultSender(sender);
  if (guard) {
    return guard;
  }
  await lockSession("vault session lock");
  return { ok: true };
}

export async function handleListFiles(sender: chrome.runtime.MessageSender): Promise<RuntimeResponse> {
  const guard = requireVaultSender(sender);
  if (guard) {
    return guard;
  }
  if (!runtimeState.session.isUnlocked) {
    return { ok: true, files: [] };
  }
  const files = await listFileSummaries();
  return { ok: true, files };
}

export async function handleListAudit(
  message: Extract<RuntimeRequest, { type: "vault:list-audit-logs" }>,
  sender: chrome.runtime.MessageSender,
): Promise<RuntimeResponse> {
  const guard = requireVaultSender(sender);
  if (guard) {
    return guard;
  }
  if (!runtimeState.session.isUnlocked) {
    return { ok: true, logs: [] };
  }
  const logs = await listAuditLogs(message.limit ?? 100);
  return { ok: true, logs };
}

async function listVaultPermissions(): Promise<VaultPermissionScope[]> {
  const settings = await getSettings();
  const parsed = settings.alwaysAllowScopes
    .map((key) => parsePermissionScope(key))
    .filter((scope): scope is VaultPermissionScope => Boolean(scope));

  const deduped = new Map<string, VaultPermissionScope>();
  for (const scope of parsed) {
    deduped.set(scope.key, scope);
  }

  return [...deduped.values()].sort((left, right) => {
    if (left.legacy !== right.legacy) {
      return left.legacy ? -1 : 1;
    }
    const providerCompare = left.provider.localeCompare(right.provider);
    if (providerCompare !== 0) {
      return providerCompare;
    }
    const resourceCompare = left.resourceType.localeCompare(right.resourceType);
    if (resourceCompare !== 0) {
      return resourceCompare;
    }
    return left.depth.localeCompare(right.depth);
  });
}

export async function handleListPermissions(sender: chrome.runtime.MessageSender): Promise<RuntimeResponse> {
  const guard = requireVaultSender(sender);
  if (guard) {
    return guard;
  }
  if (!runtimeState.session.isUnlocked) {
    return { ok: true, permissions: [] };
  }
  const permissions = await listVaultPermissions();
  return { ok: true, permissions };
}

export async function handleRevokePermission(
  message: Extract<RuntimeRequest, { type: "vault:revoke-permission" }>,
  sender: chrome.runtime.MessageSender,
): Promise<RuntimeResponse> {
  const guard = requireVaultSender(sender);
  if (guard) {
    return guard;
  }
  if (!runtimeState.session.isUnlocked) {
    return { ok: false, error: "잠금을 먼저 해제해 주세요." };
  }

  const parsed = parsePermissionScope(message.key);
  const aliases = new Set<string>([message.key]);
  if (parsed) {
    aliases.add(legacyPermissionKey({
      provider: parsed.provider,
      resourceType: parsed.resourceType,
      depth: parsed.depth,
    }));
    aliases.add(permissionKey({
      provider: parsed.provider,
      resourceType: parsed.resourceType,
      depth: parsed.depth,
      query: parsed.query,
      dateFrom: parsed.dateFrom,
      dateTo: parsed.dateTo,
    }));
  }

  await updateSettings((settings) => {
    settings.alwaysAllowScopes = settings.alwaysAllowScopes.filter((storedKey) => !aliases.has(storedKey));
  });
  for (const key of aliases) {
    runtimeState.session.alwaysAllowSession.delete(key);
  }

  return { ok: true };
}

export async function handleSetProvider(
  message: Extract<RuntimeRequest, { type: "vault:set-provider" }>,
  sender: chrome.runtime.MessageSender,
): Promise<RuntimeResponse> {
  const guard = requireVaultSender(sender);
  if (guard) {
    return guard;
  }
  await updateSettings((settings) => {
    settings.connectedProvider = message.provider;
  });
  runtimeState.connectionSuccessShown.clear();
  runtimeState.providerConnectionConfirmed.clear();
  return { ok: true, provider: message.provider };
}

export async function handleEnqueueMcpRequest(
  message: Extract<RuntimeRequest, { type: "mcp:enqueue-request" }>,
  sender: chrome.runtime.MessageSender,
): Promise<RuntimeResponse> {
  if (!sender.tab?.id) {
    return { ok: false, error: "신뢰할 수 없는 요청입니다." };
  }
  if (!checkAndTrackRequestRate(sender.tab.id)) {
    return { ok: false, error: "요청이 너무 빠르게 반복되고 있습니다. 잠시 후 다시 시도해 주세요." };
  }

  const settings = await getSettings();
  if (!settings.connectedProvider) {
    return { ok: false, error: "보관함에서 연결할 AI를 먼저 선택해 주세요." };
  }
  if (settings.connectedProvider !== message.provider) {
    return {
      ok: false,
      error: `현재 연결된 AI는 ${providerLabel(settings.connectedProvider)}입니다. 보관함에서 연결 AI를 변경해 주세요.`,
    };
  }

  if (runtimeState.session.isLocking) {
    return { ok: false, error: "세션 상태를 정리 중입니다. 잠시 후 다시 시도해 주세요." };
  }

  const parsed = parseReadRequestPayload({
    resourceTypes: message.resourceTypes,
    depth: message.depth,
    query: message.query,
    dateFrom: message.dateFrom,
    dateTo: message.dateTo,
  });

  if (!parsed.success) {
    return { ok: false, error: "요청 형식이 올바르지 않습니다." };
  }

  if (parsed.data.resource_types.length === 0) {
    return { ok: false, error: "리소스 타입을 선택해 주세요." };
  }

  if (!runtimeState.providerConnectionConfirmed.has(message.provider)) {
    runtimeState.providerConnectionConfirmed.add(message.provider);
    if (sender.tab?.id && !runtimeState.connectionSuccessShown.has(message.provider)) {
      runtimeState.connectionSuccessShown.add(message.provider);
      await sendOverlay(
        message.provider,
        {
          type: "overlay:connection-success",
          provider: message.provider,
        },
        sender.tab.id,
      );
    }
  }

  const { requestId, promise } = await enqueueApprovalRequest({
    provider: message.provider,
    resourceTypes: parsed.data.resource_types,
    depth: parsed.data.depth,
    query: parsed.data.query,
    dateFrom: parsed.data.date_from,
    dateTo: parsed.data.date_to,
    sourceTabId: sender.tab.id,
    allowAlways: message.allowAlways !== false,
  });

  if (message.awaitResult) {
    const result = await promise;
    return { ok: true, result };
  }

  return { ok: true, requestId, queued: true };
}

export async function handleApprovalDecision(
  message: Extract<RuntimeRequest, { type: "approval:decision" }>,
  sender: chrome.runtime.MessageSender,
): Promise<RuntimeResponse> {
  const pending = runtimeState.approvals.get(message.requestId);
  if (!pending || pending.settled) {
    return { ok: false, error: "요청이 이미 처리되었거나 찾을 수 없습니다." };
  }

  if (!isTrustedSenderForProvider(sender, pending.request.provider)) {
    return { ok: false, error: "신뢰할 수 없는 요청입니다." };
  }

  if (pending.sourceTabId && sender.tab?.id !== pending.sourceTabId) {
    return { ok: false, error: "요청 탭이 일치하지 않습니다." };
  }

  if (message.decision === "approved") {
    if (runtimeState.currentRequestId !== message.requestId || !pending.overlayRendered) {
      return { ok: false, error: "승인 카드가 준비되지 않았습니다. 잠시 후 다시 시도해 주세요." };
    }
  }

  if (message.decision === "denied") {
    const settled = await settleApproval(
      message.requestId,
      buildMcpDeniedResponse(pending.request.depth),
      "denied",
      "one-time",
    );
    if (!settled) {
      return { ok: false, error: "요청이 이미 처리되었거나 찾을 수 없습니다." };
    }
    await pumpQueue();
    return { ok: true, status: "denied" };
  }

  const permissionResult = PermissionLevelSchema.safeParse(message.permissionLevel ?? "one-time");
  if (!permissionResult.success) {
    return { ok: false, error: "권한 설정이 올바르지 않습니다." };
  }
  const permission = permissionResult.data;
  const { selectedResourceTypes, selectedItemIds } = normalizeApprovalSelection(pending.request, message);
  if (permission === "always" && selectedItemIds.length > 0) {
    return { ok: false, error: "개별 항목 선택에서는 항상 허용을 사용할 수 없습니다." };
  }

  if (selectedResourceTypes.length === 0) {
    return { ok: false, error: "최소 한 개 항목을 선택해 주세요." };
  }

  let response = await runApproval(pending.request, selectedResourceTypes);
  if (response.status === "ok" && selectedItemIds.length > 0) {
    response = applyApprovalItemSelection(response, new Set(selectedItemIds));
    if (response.count === 0) {
      return { ok: false, error: "선택한 항목을 찾지 못했습니다. 다시 선택해 주세요." };
    }
  }
  const auditResult = response.status === "ok" ? "approved" : "error";
  const sharedTypes = computeApprovalSharedTypes(response, selectedResourceTypes);
  let effectivePermission = permission;
  let settlementReason: string | undefined;

  if (permission === "always" && response.status === "ok") {
    const keys = selectedResourceTypes.map((type) => permissionKey({
      provider: pending.request.provider,
      resourceType: type,
      depth: pending.request.depth,
      query: pending.request.query,
      dateFrom: pending.request.dateFrom,
      dateTo: pending.request.dateTo,
    }));
    const persisted = await persistAlwaysScopes(keys);
    if (!persisted) {
      effectivePermission = "one-time";
      settlementReason = "always allow persistence failed";
    }
  }

  const settled = await settleApproval(
    message.requestId,
    response,
    auditResult,
    effectivePermission,
    sharedTypes,
    settlementReason,
  );
  if (!settled) {
    return { ok: false, error: "요청이 이미 처리되었거나 찾을 수 없습니다." };
  }
  await pumpQueue();

  return { ok: true, status: auditResult };
}

export async function handleOverlayReady(
  message: Extract<RuntimeRequest, { type: "overlay:ready" }>,
  sender: chrome.runtime.MessageSender,
): Promise<RuntimeResponse> {
  if (!isTrustedSenderForProvider(sender, message.provider)) {
    return { ok: false, error: "신뢰할 수 없는 요청입니다." };
  }

  if (sender.tab?.id) {
    runtimeState.providerTabs.set(message.provider, sender.tab.id);
  }

  const settings = await getSettings();
  if (settings.integrationWarning === INTEGRATION_WARNING_MESSAGE) {
    await updateSettings((next) => {
      next.integrationWarning = null;
    });
  }

  await emitQueueState(message.provider, sender.tab?.id ?? null);

  return { ok: true };
}

export function handleOverlayRendered(
  message: Extract<RuntimeRequest, { type: "overlay:approval-rendered" }>,
  sender: chrome.runtime.MessageSender,
): RuntimeResponse {
  const pending = runtimeState.approvals.get(message.requestId);
  if (!pending || pending.settled) {
    return { ok: false, error: "요청이 이미 처리되었거나 찾을 수 없습니다." };
  }
  if (!isTrustedSenderForProvider(sender, pending.request.provider)) {
    return { ok: false, error: "신뢰할 수 없는 요청입니다." };
  }
  if (pending.sourceTabId && sender.tab?.id !== pending.sourceTabId) {
    return { ok: false, error: "요청 탭이 일치하지 않습니다." };
  }

  pending.overlayRendered = true;
  if (pending.renderWatchdogId) {
    clearTimeout(pending.renderWatchdogId);
    pending.renderWatchdogId = null;
  }
  return { ok: true };
}

export async function handleOverlayRenderFailed(
  message: Extract<RuntimeRequest, { type: "overlay:render-failed" }>,
  sender: chrome.runtime.MessageSender,
): Promise<RuntimeResponse> {
  const pending = runtimeState.approvals.get(message.requestId);
  if (!pending || pending.settled) {
    return { ok: false, error: "요청이 이미 처리되었거나 찾을 수 없습니다." };
  }
  if (!isTrustedSenderForProvider(sender, pending.request.provider)) {
    return { ok: false, error: "신뢰할 수 없는 요청입니다." };
  }
  if (pending.sourceTabId && sender.tab?.id !== pending.sourceTabId) {
    return { ok: false, error: "요청 탭이 일치하지 않습니다." };
  }
  if (pending.renderWatchdogId) {
    clearTimeout(pending.renderWatchdogId);
    pending.renderWatchdogId = null;
  }

  await markIntegrationWarning();
  const response = buildMcpErrorResponse(
    pending.request.depth,
    "CONTENT_SCRIPT_RENDER_FAILED",
    "Extension update required",
    false,
  );
  await settleApproval(message.requestId, response, "error", "one-time", undefined, "content script render failed");
  await pumpQueue();
  return { ok: true, status: "error" };
}

export async function handleOverlayOpenVault(sender: chrome.runtime.MessageSender): Promise<RuntimeResponse> {
  if (!isTrustedOverlaySender(sender)) {
    return untrustedResponse();
  }
  const settings = await getSettings();
  if (!settings.pinConfig) {
    await ensureSetupTab();
    return { ok: true };
  }
  await ensureVaultTab();
  return { ok: true };
}

// ── Routing table ──

export const runtimeHandlers = {
  "runtime:ping": async (_message: Extract<RuntimeRequest, { type: "runtime:ping" }>) => ({
    ok: true,
    service: "background",
    mode: RUNTIME_MODE,
    version: browser.runtime.getManifest().version,
  }),
  "vault:get-state": async (_message: Extract<RuntimeRequest, { type: "vault:get-state" }>, sender: chrome.runtime.MessageSender) => {
    const guard = requireVaultOrSetupSender(sender);
    if (guard) {
      return guard;
    }
    return handleGetState();
  },
  "session:setup-pin": handleSetupPin,
  "session:unlock": handleSessionUnlock,
  "session:lock": async (_message: Extract<RuntimeRequest, { type: "session:lock" }>, sender: chrome.runtime.MessageSender) =>
    handleSessionLock(sender),
  "vault:upload-file": async (message: Extract<RuntimeRequest, { type: "vault:upload-file" }>, sender: chrome.runtime.MessageSender) => {
    const guard = requireVaultSender(sender);
    if (guard) {
      return guard;
    }
    return handleUpload(message);
  },
  "vault:download-file": async (message: Extract<RuntimeRequest, { type: "vault:download-file" }>, sender: chrome.runtime.MessageSender) => {
    const guard = requireVaultSender(sender);
    if (guard) {
      return guard;
    }
    return handleDownload(message);
  },
  "vault:delete-file": async (message: Extract<RuntimeRequest, { type: "vault:delete-file" }>, sender: chrome.runtime.MessageSender) => {
    const guard = requireVaultSender(sender);
    if (guard) {
      return guard;
    }
    return handleDeleteFile(message);
  },
  "vault:list-files": async (_message: Extract<RuntimeRequest, { type: "vault:list-files" }>, sender: chrome.runtime.MessageSender) =>
    handleListFiles(sender),
  "vault:list-audit-logs": handleListAudit,
  "vault:list-permissions": async (_message: Extract<RuntimeRequest, { type: "vault:list-permissions" }>, sender: chrome.runtime.MessageSender) =>
    handleListPermissions(sender),
  "vault:revoke-permission": handleRevokePermission,
  "vault:set-provider": handleSetProvider,
  "mcp:enqueue-request": async (message: Extract<RuntimeRequest, { type: "mcp:enqueue-request" }>, sender: chrome.runtime.MessageSender) => {
    if (!sender.tab?.id || !isTrustedSenderForProvider(sender, message.provider)) {
      return untrustedResponse();
    }
    if (runtimeState.providerTabs.get(message.provider) !== sender.tab.id) {
      runtimeState.providerTabs.set(message.provider, sender.tab.id);
    }
    return handleEnqueueMcpRequest(message, sender);
  },
  "approval:decision": async (message: Extract<RuntimeRequest, { type: "approval:decision" }>, sender: chrome.runtime.MessageSender) =>
    handleApprovalDecision(message, sender),
  "overlay:ready": async (message: Extract<RuntimeRequest, { type: "overlay:ready" }>, sender: chrome.runtime.MessageSender) =>
    handleOverlayReady(message, sender),
  "overlay:approval-rendered": async (
    message: Extract<RuntimeRequest, { type: "overlay:approval-rendered" }>,
    sender: chrome.runtime.MessageSender,
  ) => handleOverlayRendered(message, sender),
  "overlay:render-failed": async (
    message: Extract<RuntimeRequest, { type: "overlay:render-failed" }>,
    sender: chrome.runtime.MessageSender,
  ) => handleOverlayRenderFailed(message, sender),
  "overlay:open-vault": async (_message: Extract<RuntimeRequest, { type: "overlay:open-vault" }>, sender: chrome.runtime.MessageSender) =>
    handleOverlayOpenVault(sender),
} satisfies {
  [K in RuntimeRequest["type"]]: (
    message: Extract<RuntimeRequest, { type: K }>,
    sender: chrome.runtime.MessageSender,
  ) => Promise<RuntimeResponse> | RuntimeResponse;
};

export function isRuntimeMessage(value: unknown): value is RuntimeRequest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as { type?: unknown };
  return typeof candidate.type === "string" && Object.prototype.hasOwnProperty.call(runtimeHandlers, candidate.type);
}

export async function handleRuntimeMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
): Promise<RuntimeResponse> {
  if (!isRuntimeMessage(message)) {
    return { ok: false, error: "지원하지 않는 요청입니다." };
  }
  const vaultPageUrl = browser.runtime.getURL(VAULT_PAGE_PATH);
  if (sender.tab?.id && (sender.url?.startsWith(vaultPageUrl) || sender.tab.url?.startsWith(vaultPageUrl))) {
    runtimeState.session.vaultTabs.add(sender.tab.id);
  }
  const handler = runtimeHandlers[message.type] as (
    message: RuntimeRequest,
    sender: chrome.runtime.MessageSender,
  ) => Promise<RuntimeResponse> | RuntimeResponse;
  if (!handler) {
    return { ok: false, error: "지원하지 않는 요청입니다." };
  }
  return handler(message, sender);
}
