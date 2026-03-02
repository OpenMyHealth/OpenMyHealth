import type { ReadHealthRecordsResponse } from "../../../packages/contracts/src/index";
import { bytesToBase64 } from "../base64";

vi.mock("../crypto", () => ({
  generateSaltBase64: vi.fn(() => "bW9jaw=="),
  deriveAesKey: vi.fn(async () => ({} as CryptoKey)),
  derivePinVerifier: vi.fn(async () => "mock-verifier"),
}));

vi.mock("../db", () => ({
  listAuditLogs: vi.fn(async () => []),
  listFileSummaries: vi.fn(async () => []),
  getResourceSummary: vi.fn(async () => ({})),
}));

vi.mock("./settings", () => ({
  getSettings: vi.fn(async () => ({
    locale: "ko-KR",
    schemaVersion: 1,
    pinConfig: null,
    lockout: { failedAttempts: 0, lockUntil: null },
    connectedProvider: null,
    alwaysAllowScopes: [],
    integrationWarning: null,
  })),
  updateSettings: vi.fn(async (mutator: (s: Record<string, unknown>) => void) => {
    const s: Record<string, unknown> = {
      locale: "ko-KR",
      schemaVersion: 1,
      pinConfig: null,
      lockout: { failedAttempts: 0, lockUntil: null },
      connectedProvider: null,
      alwaysAllowScopes: ["chatgpt|Observation|summary", "v2|chatgpt|Observation|summary|q:|from:|to:"],
      integrationWarning: null,
    };
    mutator(s);
    return s;
  }),
  toPublicSettings: vi.fn((s: { locale: string; schemaVersion: number; lockout: unknown; connectedProvider: unknown; integrationWarning: unknown }) => ({
    locale: s.locale,
    schemaVersion: s.schemaVersion,
    lockout: s.lockout,
    connectedProvider: s.connectedProvider,
    integrationWarning: s.integrationWarning,
  })),
  isSixDigitPin: vi.fn((pin: string) => /^\d{6}$/.test(pin)),
  verifyAndUnlock: vi.fn(async () => ({ unlocked: false, lockoutUntil: null })),
}));

vi.mock("./sender-validation", () => ({
  isTrustedSenderForProvider: vi.fn(() => true),
  isTrustedOverlaySender: vi.fn(() => true),
  untrustedResponse: vi.fn(() => ({ ok: false, error: "신뢰할 수 없는 요청입니다." })),
  requireVaultSender: vi.fn(() => null),
  requireVaultOrSetupSender: vi.fn(() => null),
}));

vi.mock("./tab-manager", () => ({
  checkAndTrackRequestRate: vi.fn(() => true),
  ensureVaultTab: vi.fn(),
  ensureSetupTab: vi.fn(),
}));

vi.mock("./overlay", () => ({
  sendOverlay: vi.fn(async () => ({ sent: true, tabId: 10 })),
  markIntegrationWarning: vi.fn(),
}));

vi.mock("./file-operations", () => ({
  handleUpload: vi.fn(async () => ({
    ok: true,
    uploaded: {
      id: "f1", name: "test.pdf", mimeType: "application/pdf", size: 1024,
      createdAt: new Date().toISOString(), status: "done", matchedCounts: {},
    },
  })),
  handleDownload: vi.fn(async () => ({
    ok: true,
    file: { name: "test.pdf", mimeType: "application/pdf", bytes: "" },
  })),
  handleDeleteFile: vi.fn(async () => ({ ok: true, deletedFileId: "f1" })),
}));

vi.mock("./approval-engine", () => ({
  lockSession: vi.fn(),
  pumpQueue: vi.fn(),
  enqueueApprovalRequest: vi.fn(async () => ({
    requestId: "req-1",
    promise: Promise.resolve({
      schema_version: "1.0", status: "ok", depth: "summary", resources: [], count: 0,
      meta: { total_available: 0, filtered_count: 0, query_matched: false },
    } satisfies ReadHealthRecordsResponse),
  })),
  settleApproval: vi.fn(async () => true),
  runApproval: vi.fn(),
  applyApprovalItemSelection: vi.fn((r: ReadHealthRecordsResponse) => r),
  normalizeApprovalSelection: vi.fn(() => ({ selectedResourceTypes: ["Observation"], selectedItemIds: [] })),
  computeApprovalSharedTypes: vi.fn(() => ["Observation"]),
  persistAlwaysScopes: vi.fn(async () => true),
  parseReadRequestPayload: vi.fn(() => ({
    success: true, data: { resource_types: ["Observation"], depth: "summary", limit: 50 },
  })),
  emitQueueState: vi.fn(),
}));

import { getSettings, verifyAndUnlock } from "./settings";
import { requireVaultSender, requireVaultOrSetupSender, isTrustedSenderForProvider, isTrustedOverlaySender, untrustedResponse } from "./sender-validation";
import { checkAndTrackRequestRate, ensureVaultTab, ensureSetupTab } from "./tab-manager";
import { handleUpload, handleDownload, handleDeleteFile } from "./file-operations";
import {
  lockSession, settleApproval, pumpQueue, runApproval, applyApprovalItemSelection,
  normalizeApprovalSelection, computeApprovalSharedTypes, persistAlwaysScopes,
  parseReadRequestPayload, enqueueApprovalRequest, emitQueueState,
} from "./approval-engine";
import { sendOverlay, markIntegrationWarning } from "./overlay";
import { listAuditLogs, listFileSummaries } from "../db";
import { runtimeState, INTEGRATION_WARNING_MESSAGE } from "./state";
import { updateSettings } from "./settings";
import {
  isRuntimeMessage, handleRuntimeMessage, handleOverlayRendered, runtimeHandlers,
  handleSessionUnlock, handleSessionLock, handleListFiles, handleListAudit,
  handleListPermissions, handleRevokePermission, handleSetProvider,
  handleEnqueueMcpRequest, handleApprovalDecision, handleOverlayReady,
  handleOverlayRenderFailed, handleOverlayOpenVault,
} from "./message-handlers";

const mockGetSettings = vi.mocked(getSettings);
const mockVerifyAndUnlock = vi.mocked(verifyAndUnlock);
const mockRequireVaultSender = vi.mocked(requireVaultSender);
const mockRequireVaultOrSetupSender = vi.mocked(requireVaultOrSetupSender);
const mockIsTrustedSenderForProvider = vi.mocked(isTrustedSenderForProvider);
const mockIsTrustedOverlaySender = vi.mocked(isTrustedOverlaySender);
const _mockUntrustedResponse = vi.mocked(untrustedResponse);
const mockCheckAndTrackRequestRate = vi.mocked(checkAndTrackRequestRate);
const mockEnsureVaultTab = vi.mocked(ensureVaultTab);
const mockEnsureSetupTab = vi.mocked(ensureSetupTab);
const mockHandleUpload = vi.mocked(handleUpload);
const mockHandleDownload = vi.mocked(handleDownload);
const mockHandleDeleteFile = vi.mocked(handleDeleteFile);
const mockLockSession = vi.mocked(lockSession);
const mockSettleApproval = vi.mocked(settleApproval);
const mockPumpQueue = vi.mocked(pumpQueue);
const mockRunApproval = vi.mocked(runApproval);
const mockApplyApprovalItemSelection = vi.mocked(applyApprovalItemSelection);
const mockNormalizeApprovalSelection = vi.mocked(normalizeApprovalSelection);
const mockComputeApprovalSharedTypes = vi.mocked(computeApprovalSharedTypes);
const mockPersistAlwaysScopes = vi.mocked(persistAlwaysScopes);
const mockParseReadRequestPayload = vi.mocked(parseReadRequestPayload);
const _mockEnqueueApprovalRequest = vi.mocked(enqueueApprovalRequest);
const mockEmitQueueState = vi.mocked(emitQueueState);
const mockSendOverlay = vi.mocked(sendOverlay);
const mockMarkIntegrationWarning = vi.mocked(markIntegrationWarning);
const mockListAuditLogs = vi.mocked(listAuditLogs);
const mockListFileSummaries = vi.mocked(listFileSummaries);
const mockUpdateSettings = vi.mocked(updateSettings);

function makeVaultSender(): chrome.runtime.MessageSender {
  return {
    id: browser.runtime.id, url: browser.runtime.getURL("/vault.html"),
    tab: { id: 1, index: 0, active: true, pinned: false, highlighted: false, incognito: false, selected: false, windowId: 1, discarded: false, autoDiscardable: true, groupId: -1 },
    frameId: 0,
  };
}

function makeProviderSender(provider: "chatgpt" | "claude" | "gemini" = "chatgpt"): chrome.runtime.MessageSender {
  const hosts: Record<string, string> = { chatgpt: "https://chatgpt.com/c/123", claude: "https://claude.ai/chat/456", gemini: "https://gemini.google.com/chat/789" };
  return {
    id: browser.runtime.id, url: hosts[provider],
    tab: { id: 10, index: 0, active: true, pinned: false, highlighted: false, incognito: false, selected: false, windowId: 1, url: hosts[provider], discarded: false, autoDiscardable: true, groupId: -1 },
    frameId: 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(browser.runtime, "getManifest").mockReturnValue({
    version: "0.0.0-test",
    manifest_version: 3,
    name: "OpenMyHealth Test",
  } as chrome.runtime.Manifest);
  runtimeState.session.isUnlocked = false;
  runtimeState.session.key = null;
  runtimeState.session.isLocking = false;
  runtimeState.session.vaultTabs.clear();
  runtimeState.session.alwaysAllowSession.clear();
  runtimeState.queue = [];
  runtimeState.approvals.clear();
  runtimeState.currentRequestId = null;
  runtimeState.providerTabs.clear();
  runtimeState.connectionSuccessShown.clear();
  runtimeState.providerConnectionConfirmed.clear();
});

describe("message-handlers", () => {
  // ── isRuntimeMessage ──
  describe("isRuntimeMessage", () => {
    it("returns true for valid message", () => { expect(isRuntimeMessage({ type: "runtime:ping" })).toBe(true); });
    it("returns false for message with no type", () => { expect(isRuntimeMessage({ foo: "bar" })).toBe(false); });
    it("returns false for null", () => { expect(isRuntimeMessage(null)).toBe(false); });
    it("returns false for unknown type", () => { expect(isRuntimeMessage({ type: "unknown:type" })).toBe(false); });
  });

  // ── handleRuntimeMessage ──
  describe("handleRuntimeMessage", () => {
    it("routes to correct handler", async () => {
      const result = await handleRuntimeMessage({ type: "runtime:ping" }, makeVaultSender());
      expect(result.ok).toBe(true);
      expect((result as { service: string }).service).toBe("background");
    });

    it("returns error for non-runtime message", async () => {
      const result = await handleRuntimeMessage({ type: "not:a:handler" }, makeVaultSender());
      expect(result.ok).toBe(false);
    });
  });

  // ── runtime:ping ──
  describe("runtime:ping", () => {
    it("returns version and mode", async () => {
      const result = await handleRuntimeMessage({ type: "runtime:ping" }, makeVaultSender());
      const typed = result as { ok: true; version: string; mode: string; service: string };
      expect(typed.ok).toBe(true);
      expect(typed.version).toBe("0.0.0-test");
      expect(typed.service).toBe("background");
    });
  });

  // ── vault:get-state ──
  describe("vault:get-state", () => {
    it("returns settings and session when locked", async () => {
      const result = await handleRuntimeMessage({ type: "vault:get-state" }, makeVaultSender());
      const typed = result as { ok: true; session: { isUnlocked: boolean }; settings: unknown; files: unknown[] };
      expect(typed.ok).toBe(true);
      expect(typed.session.isUnlocked).toBe(false);
      expect(typed.files).toEqual([]);
    });

    it("returns files and logs when unlocked", async () => {
      runtimeState.session.isUnlocked = true;
      runtimeState.session.key = {} as CryptoKey;
      const result = await handleRuntimeMessage({ type: "vault:get-state" }, makeVaultSender());
      expect((result as { session: { isUnlocked: boolean } }).session.isUnlocked).toBe(true);
    });
  });

  // ── session:setup-pin ──
  describe("session:setup-pin", () => {
    it("valid pin sets up and returns unlocked", async () => {
      const result = await handleRuntimeMessage({ type: "session:setup-pin", pin: "123456", locale: "ko-KR" }, makeVaultSender());
      expect(result.ok).toBe(true);
      expect((result as { isUnlocked: boolean }).isUnlocked).toBe(true);
    });

    it("invalid pin returns error", async () => {
      const result = await handleRuntimeMessage({ type: "session:setup-pin", pin: "abc", locale: "ko-KR" }, makeVaultSender());
      expect(result.ok).toBe(false);
      expect((result as { error: string }).error).toContain("PIN");
    });

    it("returns error when pin already exists", async () => {
      mockGetSettings.mockResolvedValueOnce({
        locale: "ko-KR", schemaVersion: 1, pinConfig: { salt: "abc", verifier: "def" },
        lockout: { failedAttempts: 0, lockUntil: null }, connectedProvider: null, alwaysAllowScopes: [], integrationWarning: null,
      });
      const result = await handleRuntimeMessage({ type: "session:setup-pin", pin: "123456", locale: "ko-KR" }, makeVaultSender());
      expect(result.ok).toBe(false);
      expect((result as { error: string }).error).toContain("이미 PIN");
    });

    it("returns error for untrusted sender", async () => {
      mockRequireVaultOrSetupSender.mockReturnValueOnce({ ok: false, error: "신뢰할 수 없는 요청입니다." });
      const result = await handleRuntimeMessage({ type: "session:setup-pin", pin: "123456", locale: "ko-KR" }, makeProviderSender());
      expect(result.ok).toBe(false);
    });
  });

  // ── session:unlock ──
  describe("session:unlock", () => {
    it("valid pin triggers unlock", async () => {
      mockVerifyAndUnlock.mockResolvedValueOnce({ unlocked: true, lockoutUntil: null });
      const result = await handleRuntimeMessage({ type: "session:unlock", pin: "123456" }, makeVaultSender());
      expect((result as { isUnlocked: boolean }).isUnlocked).toBe(true);
    });

    it("invalid pin format returns not unlocked", async () => {
      const result = await handleRuntimeMessage({ type: "session:unlock", pin: "abc" }, makeVaultSender());
      expect((result as { isUnlocked: boolean }).isUnlocked).toBe(false);
    });
  });

  // ── session:lock ──
  describe("session:lock", () => {
    it("calls lockSession and returns ok", async () => {
      const result = await handleRuntimeMessage({ type: "session:lock" }, makeVaultSender());
      expect(result.ok).toBe(true);
      expect(mockLockSession).toHaveBeenCalled();
    });
  });

  // ── vault:upload-file ──
  describe("vault:upload-file", () => {
    it("delegates to handleUpload", async () => {
      const result = await handleRuntimeMessage(
        { type: "vault:upload-file", name: "test.pdf", mimeType: "application/pdf", size: 1024, bytes: bytesToBase64(new Uint8Array(10)) },
        makeVaultSender(),
      );
      expect(result.ok).toBe(true);
      expect(mockHandleUpload).toHaveBeenCalled();
    });
  });

  // ── vault:download-file ──
  describe("vault:download-file", () => {
    it("delegates to handleDownload", async () => {
      const result = await handleRuntimeMessage({ type: "vault:download-file", fileId: "f1" }, makeVaultSender());
      expect(result.ok).toBe(true);
      expect(mockHandleDownload).toHaveBeenCalled();
    });
  });

  // ── vault:delete-file ──
  describe("vault:delete-file", () => {
    it("delegates to handleDeleteFile", async () => {
      const result = await handleRuntimeMessage({ type: "vault:delete-file", fileId: "f1" }, makeVaultSender());
      expect(result.ok).toBe(true);
      expect(mockHandleDeleteFile).toHaveBeenCalled();
    });
  });

  // ── vault:list-files ──
  describe("vault:list-files", () => {
    it("returns files", async () => {
      const result = await handleRuntimeMessage({ type: "vault:list-files" }, makeVaultSender());
      expect((result as { files: unknown[] }).files).toBeDefined();
    });
  });

  // ── vault:list-audit-logs ──
  describe("vault:list-audit-logs", () => {
    it("returns logs", async () => {
      const result = await handleRuntimeMessage({ type: "vault:list-audit-logs" }, makeVaultSender());
      expect((result as { logs: unknown[] }).logs).toBeDefined();
    });
  });

  // ── vault:list-permissions ──
  describe("vault:list-permissions", () => {
    it("returns empty permissions when locked", async () => {
      const result = await handleRuntimeMessage({ type: "vault:list-permissions" }, makeVaultSender());
      expect((result as { permissions: unknown[] }).permissions).toEqual([]);
    });

    it("returns permissions when unlocked", async () => {
      runtimeState.session.isUnlocked = true;
      runtimeState.session.key = {} as CryptoKey;
      const result = await handleRuntimeMessage({ type: "vault:list-permissions" }, makeVaultSender());
      expect((result as { permissions: unknown[] }).permissions).toBeDefined();
    });
  });

  // ── vault:revoke-permission ──
  describe("vault:revoke-permission", () => {
    it("revokes and returns ok", async () => {
      runtimeState.session.isUnlocked = true;
      runtimeState.session.key = {} as CryptoKey;
      const result = await handleRuntimeMessage({ type: "vault:revoke-permission", key: "chatgpt|Observation|summary" }, makeVaultSender());
      expect(result.ok).toBe(true);
    });
  });

  // ── vault:set-provider ──
  describe("vault:set-provider", () => {
    it("updates settings and returns provider", async () => {
      const result = await handleRuntimeMessage({ type: "vault:set-provider", provider: "chatgpt" }, makeVaultSender());
      expect((result as { provider: string }).provider).toBe("chatgpt");
    });
  });

  // ── mcp:enqueue-request ──
  describe("mcp:enqueue-request", () => {
    it("valid request queues and returns requestId", async () => {
      mockGetSettings.mockResolvedValueOnce({
        locale: "ko-KR", schemaVersion: 1, pinConfig: null,
        lockout: { failedAttempts: 0, lockUntil: null }, connectedProvider: "chatgpt", alwaysAllowScopes: [], integrationWarning: null,
      });
      const result = await handleRuntimeMessage(
        { type: "mcp:enqueue-request", provider: "chatgpt", resourceTypes: ["Observation"], depth: "summary" },
        makeProviderSender(),
      );
      expect((result as { requestId: string }).requestId).toBe("req-1");
    });

    it("rate limited returns error", async () => {
      mockCheckAndTrackRequestRate.mockReturnValueOnce(false);
      const result = await handleRuntimeMessage(
        { type: "mcp:enqueue-request", provider: "chatgpt", resourceTypes: ["Observation"], depth: "summary" },
        makeProviderSender(),
      );
      expect(result.ok).toBe(false);
      expect((result as { error: string }).error).toContain("빠르게");
    });

    it("returns error when no connected provider", async () => {
      const result = await handleRuntimeMessage(
        { type: "mcp:enqueue-request", provider: "chatgpt", resourceTypes: ["Observation"], depth: "summary" },
        makeProviderSender(),
      );
      expect(result.ok).toBe(false);
      expect((result as { error: string }).error).toContain("먼저 선택");
    });

    it("returns error for wrong provider", async () => {
      mockGetSettings.mockResolvedValueOnce({
        locale: "ko-KR", schemaVersion: 1, pinConfig: null,
        lockout: { failedAttempts: 0, lockUntil: null }, connectedProvider: "claude", alwaysAllowScopes: [], integrationWarning: null,
      });
      const result = await handleRuntimeMessage(
        { type: "mcp:enqueue-request", provider: "chatgpt", resourceTypes: ["Observation"], depth: "summary" },
        makeProviderSender(),
      );
      expect(result.ok).toBe(false);
      expect((result as { error: string }).error).toContain("Claude");
    });

    it("with awaitResult returns result", async () => {
      mockGetSettings.mockResolvedValueOnce({
        locale: "ko-KR", schemaVersion: 1, pinConfig: null,
        lockout: { failedAttempts: 0, lockUntil: null }, connectedProvider: "chatgpt", alwaysAllowScopes: [], integrationWarning: null,
      });
      const result = await handleRuntimeMessage(
        { type: "mcp:enqueue-request", provider: "chatgpt", resourceTypes: ["Observation"], depth: "summary", awaitResult: true },
        makeProviderSender(),
      );
      expect((result as { result: ReadHealthRecordsResponse }).result.status).toBe("ok");
    });
  });

  // ── approval:decision ──
  describe("approval:decision", () => {
    it("denied settles as denied", async () => {
      const requestId = "req-deny";
      runtimeState.approvals.set(requestId, {
        request: { id: requestId, provider: "chatgpt", resourceTypes: ["Observation"], depth: "summary", aiDescription: "test", extensionSummary: "test", resourceOptions: undefined, createdAt: new Date().toISOString(), deadlineAt: Date.now() + 60_000 },
        allowAlways: false, timerId: null, renderWatchdogId: null, renderWatchdogChecks: 0, overlayRendered: true, resolve: vi.fn(), settled: false, sourceTabId: 10,
      });
      const result = await handleRuntimeMessage({ type: "approval:decision", requestId, decision: "denied" }, makeProviderSender());
      expect((result as { status: string }).status).toBe("denied");
    });

    it("returns error when request not found", async () => {
      const result = await handleRuntimeMessage({ type: "approval:decision", requestId: "nonexistent", decision: "denied" }, makeProviderSender());
      expect(result.ok).toBe(false);
    });
  });

  // ── overlay:ready ──
  describe("overlay:ready", () => {
    it("sets providerTab and clears warning", async () => {
      const result = await handleRuntimeMessage({ type: "overlay:ready", provider: "chatgpt" }, makeProviderSender());
      expect(result.ok).toBe(true);
      expect(runtimeState.providerTabs.get("chatgpt")).toBe(10);
    });
  });

  // ── overlay:approval-rendered ──
  describe("overlay:approval-rendered", () => {
    it("sets overlayRendered on pending request", async () => {
      const requestId = "req-render";
      runtimeState.approvals.set(requestId, {
        request: { id: requestId, provider: "chatgpt", resourceTypes: ["Observation"], depth: "summary", aiDescription: "test", extensionSummary: "test", resourceOptions: undefined, createdAt: new Date().toISOString(), deadlineAt: Date.now() + 60_000 },
        allowAlways: false, timerId: null, renderWatchdogId: setTimeout(() => {}, 99999), renderWatchdogChecks: 0, overlayRendered: false, resolve: vi.fn(), settled: false, sourceTabId: 10,
      });
      const result = await handleRuntimeMessage({ type: "overlay:approval-rendered", requestId }, makeProviderSender());
      expect(result.ok).toBe(true);
      expect(runtimeState.approvals.get(requestId)!.overlayRendered).toBe(true);
      expect(runtimeState.approvals.get(requestId)!.renderWatchdogId).toBeNull();
    });
  });

  // ── overlay:render-failed ──
  describe("overlay:render-failed", () => {
    it("settles as error", async () => {
      const requestId = "req-fail";
      runtimeState.approvals.set(requestId, {
        request: { id: requestId, provider: "chatgpt", resourceTypes: ["Observation"], depth: "summary", aiDescription: "test", extensionSummary: "test", resourceOptions: undefined, createdAt: new Date().toISOString(), deadlineAt: Date.now() + 60_000 },
        allowAlways: false, timerId: null, renderWatchdogId: null, renderWatchdogChecks: 0, overlayRendered: false, resolve: vi.fn(), settled: false, sourceTabId: 10,
      });
      const result = await handleRuntimeMessage({ type: "overlay:render-failed", requestId }, makeProviderSender());
      expect((result as { status: string }).status).toBe("error");
    });
  });

  // ── overlay:open-vault ──
  describe("overlay:open-vault", () => {
    it("opens vault tab when pin exists", async () => {
      mockGetSettings.mockResolvedValueOnce({
        locale: "ko-KR", schemaVersion: 1, pinConfig: { salt: "abc", verifier: "def" },
        lockout: { failedAttempts: 0, lockUntil: null }, connectedProvider: null, alwaysAllowScopes: [], integrationWarning: null,
      });
      await handleRuntimeMessage({ type: "overlay:open-vault" }, makeProviderSender());
      expect(mockEnsureVaultTab).toHaveBeenCalled();
    });

    it("opens setup tab when no pin", async () => {
      await handleRuntimeMessage({ type: "overlay:open-vault" }, makeProviderSender());
      expect(mockEnsureSetupTab).toHaveBeenCalled();
    });
  });

  // ── handleOverlayRendered ──
  describe("handleOverlayRendered", () => {
    it("valid request marks rendered and clears watchdog", () => {
      const requestId = "req-rendered";
      runtimeState.approvals.set(requestId, {
        request: { id: requestId, provider: "chatgpt", resourceTypes: ["Observation"], depth: "summary", aiDescription: "test", extensionSummary: "test", resourceOptions: undefined, createdAt: new Date().toISOString(), deadlineAt: Date.now() + 60_000 },
        allowAlways: false, timerId: null, renderWatchdogId: setTimeout(() => {}, 99999), renderWatchdogChecks: 0, overlayRendered: false, resolve: vi.fn(), settled: false, sourceTabId: 10,
      });
      const result = handleOverlayRendered({ type: "overlay:approval-rendered", requestId }, makeProviderSender());
      expect(result.ok).toBe(true);
      expect(runtimeState.approvals.get(requestId)!.overlayRendered).toBe(true);
    });

    it("returns error for already settled request", () => {
      const requestId = "req-settled";
      runtimeState.approvals.set(requestId, {
        request: { id: requestId, provider: "chatgpt", resourceTypes: ["Observation"], depth: "summary", aiDescription: "test", extensionSummary: "test", resourceOptions: undefined, createdAt: new Date().toISOString(), deadlineAt: Date.now() + 60_000 },
        allowAlways: false, timerId: null, renderWatchdogId: null, renderWatchdogChecks: 0, overlayRendered: false, resolve: vi.fn(), settled: true, sourceTabId: 10,
      });
      expect(handleOverlayRendered({ type: "overlay:approval-rendered", requestId }, makeProviderSender()).ok).toBe(false);
    });
  });

  // ── Routing table ──
  describe("runtimeHandlers routing table", () => {
    it("has all 19 handler keys", () => { expect(Object.keys(runtimeHandlers).length).toBe(19); });

    it("has entry for each RuntimeRequest type", () => {
      const types = [
        "runtime:ping", "vault:get-state", "session:setup-pin", "session:unlock", "session:lock",
        "vault:upload-file", "vault:download-file", "vault:delete-file", "vault:list-files",
        "vault:list-audit-logs", "vault:list-permissions", "vault:revoke-permission", "vault:set-provider",
        "mcp:enqueue-request", "approval:decision", "overlay:ready",
        "overlay:approval-rendered", "overlay:render-failed", "overlay:open-vault",
      ];
      for (const type of types) { expect(runtimeHandlers).toHaveProperty(type); }
    });
  });

  // ── Sender guards ──
  describe("sender guards", () => {
    it("vault:get-state calls requireVaultOrSetupSender", async () => {
      await handleRuntimeMessage({ type: "vault:get-state" }, makeVaultSender());
      expect(mockRequireVaultOrSetupSender).toHaveBeenCalled();
    });

    it("mcp:enqueue-request validates provider trust", async () => {
      mockIsTrustedSenderForProvider.mockReturnValueOnce(false);
      const result = await handleRuntimeMessage(
        { type: "mcp:enqueue-request", provider: "chatgpt", resourceTypes: ["Observation"], depth: "summary" },
        makeProviderSender(),
      );
      expect(result.ok).toBe(false);
    });

    it("mcp:enqueue-request sets providerTab tracking", async () => {
      mockGetSettings.mockResolvedValueOnce({
        locale: "ko-KR", schemaVersion: 1, pinConfig: null,
        lockout: { failedAttempts: 0, lockUntil: null }, connectedProvider: "chatgpt", alwaysAllowScopes: [], integrationWarning: null,
      });
      await handleRuntimeMessage(
        { type: "mcp:enqueue-request", provider: "chatgpt", resourceTypes: ["Observation"], depth: "summary" },
        makeProviderSender(),
      );
      expect(runtimeState.providerTabs.get("chatgpt")).toBe(10);
    });

    it("mcp:enqueue-request sends connection success on first request", async () => {
      mockGetSettings.mockResolvedValueOnce({
        locale: "ko-KR", schemaVersion: 1, pinConfig: null,
        lockout: { failedAttempts: 0, lockUntil: null }, connectedProvider: "chatgpt", alwaysAllowScopes: [], integrationWarning: null,
      });
      runtimeState.providerConnectionConfirmed.clear();
      runtimeState.connectionSuccessShown.clear();
      await handleRuntimeMessage(
        { type: "mcp:enqueue-request", provider: "chatgpt", resourceTypes: ["Observation"], depth: "summary" },
        makeProviderSender(),
      );
      expect(mockSendOverlay).toHaveBeenCalledWith("chatgpt", expect.objectContaining({ type: "overlay:connection-success" }), 10);
      expect(runtimeState.providerConnectionConfirmed.has("chatgpt")).toBe(true);
      expect(runtimeState.connectionSuccessShown.has("chatgpt")).toBe(true);
    });
  });

  // ── Direct handler tests for full branch coverage ──

  describe("handleSessionUnlock (direct)", () => {
    it("returns guard error when requireVaultSender rejects", async () => {
      mockRequireVaultSender.mockReturnValueOnce({ ok: false, error: "untrusted" });
      const result = await handleSessionUnlock({ type: "session:unlock", pin: "123456" }, makeProviderSender());
      expect(result).toEqual({ ok: false, error: "untrusted" });
    });

    it("pumps queue when unlocked with pending currentRequestId and unsettled approval", async () => {
      mockVerifyAndUnlock.mockResolvedValueOnce({ unlocked: true, lockoutUntil: null });
      const requestId = "req-pending";
      runtimeState.currentRequestId = requestId;
      runtimeState.approvals.set(requestId, {
        request: { id: requestId, provider: "chatgpt", resourceTypes: ["Observation"], depth: "summary", aiDescription: "test", extensionSummary: "test", resourceOptions: undefined, createdAt: new Date().toISOString(), deadlineAt: Date.now() + 60_000 },
        allowAlways: false, timerId: null, renderWatchdogId: null, renderWatchdogChecks: 0, overlayRendered: false, resolve: vi.fn(), settled: false, sourceTabId: 10,
      });
      const result = await handleSessionUnlock({ type: "session:unlock", pin: "123456" }, makeVaultSender());
      expect((result as { isUnlocked: boolean }).isUnlocked).toBe(true);
      expect(runtimeState.currentRequestId).toBeNull();
      expect(mockPumpQueue).toHaveBeenCalled();
    });

    it("does not pump queue when unlocked but no currentRequestId", async () => {
      mockVerifyAndUnlock.mockResolvedValueOnce({ unlocked: true, lockoutUntil: null });
      runtimeState.currentRequestId = null;
      const result = await handleSessionUnlock({ type: "session:unlock", pin: "123456" }, makeVaultSender());
      expect((result as { isUnlocked: boolean }).isUnlocked).toBe(true);
      expect(mockPumpQueue).not.toHaveBeenCalled();
    });

    it("does not pump queue when unlocked but approval is already settled", async () => {
      mockVerifyAndUnlock.mockResolvedValueOnce({ unlocked: true, lockoutUntil: null });
      const requestId = "req-settled-2";
      runtimeState.currentRequestId = requestId;
      runtimeState.approvals.set(requestId, {
        request: { id: requestId, provider: "chatgpt", resourceTypes: ["Observation"], depth: "summary", aiDescription: "test", extensionSummary: "test", resourceOptions: undefined, createdAt: new Date().toISOString(), deadlineAt: Date.now() + 60_000 },
        allowAlways: false, timerId: null, renderWatchdogId: null, renderWatchdogChecks: 0, overlayRendered: false, resolve: vi.fn(), settled: true, sourceTabId: 10,
      });
      const result = await handleSessionUnlock({ type: "session:unlock", pin: "123456" }, makeVaultSender());
      expect((result as { isUnlocked: boolean }).isUnlocked).toBe(true);
      expect(mockPumpQueue).not.toHaveBeenCalled();
    });

    it("does not pump queue when unlocked but no matching approval in map", async () => {
      mockVerifyAndUnlock.mockResolvedValueOnce({ unlocked: true, lockoutUntil: null });
      runtimeState.currentRequestId = "nonexistent-req";
      const result = await handleSessionUnlock({ type: "session:unlock", pin: "123456" }, makeVaultSender());
      expect((result as { isUnlocked: boolean }).isUnlocked).toBe(true);
      expect(mockPumpQueue).not.toHaveBeenCalled();
    });
  });

  describe("handleSessionLock (direct)", () => {
    it("returns guard error when requireVaultSender rejects", async () => {
      mockRequireVaultSender.mockReturnValueOnce({ ok: false, error: "untrusted" });
      const result = await handleSessionLock(makeProviderSender());
      expect(result).toEqual({ ok: false, error: "untrusted" });
    });
  });

  describe("handleListFiles (direct)", () => {
    it("returns guard error when requireVaultSender rejects", async () => {
      mockRequireVaultSender.mockReturnValueOnce({ ok: false, error: "untrusted" });
      const result = await handleListFiles(makeProviderSender());
      expect(result).toEqual({ ok: false, error: "untrusted" });
    });

    it("returns empty files when session is locked", async () => {
      runtimeState.session.isUnlocked = false;
      const result = await handleListFiles(makeVaultSender());
      expect(result).toEqual({ ok: true, files: [] });
    });

    it("returns files from db when session is unlocked", async () => {
      runtimeState.session.isUnlocked = true;
      const mockFiles = [{ id: "f1", name: "test.pdf", mimeType: "application/pdf", size: 100, createdAt: "2024-01-01", status: "done" as const, matchedCounts: {} }];
      mockListFileSummaries.mockResolvedValueOnce(mockFiles);
      const result = await handleListFiles(makeVaultSender());
      expect((result as { files: unknown[] }).files).toEqual(mockFiles);
    });
  });

  describe("handleListAudit (direct)", () => {
    it("returns guard error when requireVaultSender rejects", async () => {
      mockRequireVaultSender.mockReturnValueOnce({ ok: false, error: "untrusted" });
      const result = await handleListAudit({ type: "vault:list-audit-logs" }, makeProviderSender());
      expect(result).toEqual({ ok: false, error: "untrusted" });
    });

    it("returns empty logs when session is locked", async () => {
      runtimeState.session.isUnlocked = false;
      const result = await handleListAudit({ type: "vault:list-audit-logs" }, makeVaultSender());
      expect(result).toEqual({ ok: true, logs: [] });
    });

    it("returns audit logs when session is unlocked", async () => {
      runtimeState.session.isUnlocked = true;
      const mockLogs = [{ id: "log-1" }];
      mockListAuditLogs.mockResolvedValueOnce(mockLogs as never);
      const result = await handleListAudit({ type: "vault:list-audit-logs", limit: 50 }, makeVaultSender());
      expect((result as { logs: unknown[] }).logs).toEqual(mockLogs);
      expect(mockListAuditLogs).toHaveBeenCalledWith(50);
    });

    it("defaults to 100 when no limit specified", async () => {
      runtimeState.session.isUnlocked = true;
      await handleListAudit({ type: "vault:list-audit-logs" }, makeVaultSender());
      expect(mockListAuditLogs).toHaveBeenCalledWith(100);
    });
  });

  describe("handleListPermissions (direct)", () => {
    it("returns guard error when requireVaultSender rejects", async () => {
      mockRequireVaultSender.mockReturnValueOnce({ ok: false, error: "untrusted" });
      const result = await handleListPermissions(makeProviderSender());
      expect(result).toEqual({ ok: false, error: "untrusted" });
    });

    it("returns empty permissions when locked", async () => {
      runtimeState.session.isUnlocked = false;
      const result = await handleListPermissions(makeVaultSender());
      expect(result).toEqual({ ok: true, permissions: [] });
    });

    it("returns parsed, deduped, and sorted permissions when unlocked", async () => {
      runtimeState.session.isUnlocked = true;
      // Two scopes: one legacy, one v2, plus a duplicate legacy
      mockGetSettings.mockResolvedValueOnce({
        locale: "ko-KR", schemaVersion: 1, pinConfig: null,
        lockout: { failedAttempts: 0, lockUntil: null }, connectedProvider: null,
        alwaysAllowScopes: [
          "chatgpt|Observation|summary",
          "chatgpt|Observation|summary", // duplicate
          "v2|chatgpt|Condition|detail|q:|from:|to:",
          "v2|claude|Observation|summary|q:|from:|to:",
        ],
        integrationWarning: null,
      });
      const result = await handleListPermissions(makeVaultSender());
      const perms = (result as { permissions: unknown[] }).permissions;
      expect(perms.length).toBe(3); // deduped
    });

    it("sorts legacy before non-legacy, then by provider, resourceType, depth", async () => {
      runtimeState.session.isUnlocked = true;
      mockGetSettings.mockResolvedValueOnce({
        locale: "ko-KR", schemaVersion: 1, pinConfig: null,
        lockout: { failedAttempts: 0, lockUntil: null }, connectedProvider: null,
        alwaysAllowScopes: [
          "v2|claude|Observation|summary|q:|from:|to:",
          "chatgpt|Observation|summary",
          "v2|chatgpt|Condition|detail|q:|from:|to:",
        ],
        integrationWarning: null,
      });
      const result = await handleListPermissions(makeVaultSender());
      const perms = (result as { permissions: Array<{ legacy: boolean; provider: string; resourceType: string }> }).permissions;
      // Legacy first
      expect(perms[0].legacy).toBe(true);
      // Then by provider comparison
      expect(perms[1].provider).toBe("chatgpt");
      expect(perms[2].provider).toBe("claude");
    });

    it("filters out invalid permission scopes", async () => {
      runtimeState.session.isUnlocked = true;
      mockGetSettings.mockResolvedValueOnce({
        locale: "ko-KR", schemaVersion: 1, pinConfig: null,
        lockout: { failedAttempts: 0, lockUntil: null }, connectedProvider: null,
        alwaysAllowScopes: [
          "invalid|scope",
          "chatgpt|Observation|summary",
        ],
        integrationWarning: null,
      });
      const result = await handleListPermissions(makeVaultSender());
      const perms = (result as { permissions: unknown[] }).permissions;
      expect(perms.length).toBe(1);
    });

    it("sorts by resourceType when provider is the same", async () => {
      runtimeState.session.isUnlocked = true;
      mockGetSettings.mockResolvedValueOnce({
        locale: "ko-KR", schemaVersion: 1, pinConfig: null,
        lockout: { failedAttempts: 0, lockUntil: null }, connectedProvider: null,
        alwaysAllowScopes: [
          "v2|chatgpt|Observation|summary|q:|from:|to:",
          "v2|chatgpt|Condition|summary|q:|from:|to:",
        ],
        integrationWarning: null,
      });
      const result = await handleListPermissions(makeVaultSender());
      const perms = (result as { permissions: Array<{ resourceType: string }> }).permissions;
      expect(perms[0].resourceType).toBe("Condition");
      expect(perms[1].resourceType).toBe("Observation");
    });

    it("sorts by depth when provider and resourceType are the same", async () => {
      runtimeState.session.isUnlocked = true;
      mockGetSettings.mockResolvedValueOnce({
        locale: "ko-KR", schemaVersion: 1, pinConfig: null,
        lockout: { failedAttempts: 0, lockUntil: null }, connectedProvider: null,
        alwaysAllowScopes: [
          "v2|chatgpt|Observation|summary|q:|from:|to:",
          "v2|chatgpt|Observation|detail|q:|from:|to:",
        ],
        integrationWarning: null,
      });
      const result = await handleListPermissions(makeVaultSender());
      const perms = (result as { permissions: Array<{ depth: string }> }).permissions;
      expect(perms[0].depth).toBe("detail");
      expect(perms[1].depth).toBe("summary");
    });
  });

  describe("handleRevokePermission (direct)", () => {
    it("returns guard error when requireVaultSender rejects", async () => {
      mockRequireVaultSender.mockReturnValueOnce({ ok: false, error: "untrusted" });
      const result = await handleRevokePermission(
        { type: "vault:revoke-permission", key: "chatgpt|Observation|summary" },
        makeProviderSender(),
      );
      expect(result).toEqual({ ok: false, error: "untrusted" });
    });

    it("returns error when session is locked", async () => {
      runtimeState.session.isUnlocked = false;
      const result = await handleRevokePermission(
        { type: "vault:revoke-permission", key: "chatgpt|Observation|summary" },
        makeVaultSender(),
      );
      expect(result.ok).toBe(false);
    });

    it("removes all aliases from settings and session", async () => {
      runtimeState.session.isUnlocked = true;
      runtimeState.session.alwaysAllowSession.add("chatgpt|Observation|summary");
      runtimeState.session.alwaysAllowSession.add("v2|chatgpt|Observation|summary|q:|from:|to:");
      const result = await handleRevokePermission(
        { type: "vault:revoke-permission", key: "chatgpt|Observation|summary" },
        makeVaultSender(),
      );
      expect(result.ok).toBe(true);
      expect(mockUpdateSettings).toHaveBeenCalled();
      // Both aliases should be removed from session
      expect(runtimeState.session.alwaysAllowSession.has("chatgpt|Observation|summary")).toBe(false);
      expect(runtimeState.session.alwaysAllowSession.has("v2|chatgpt|Observation|summary|q:|from:|to:")).toBe(false);
    });

    it("handles v2 key revocation with aliases", async () => {
      runtimeState.session.isUnlocked = true;
      runtimeState.session.alwaysAllowSession.add("v2|chatgpt|Observation|summary|q:|from:|to:");
      const result = await handleRevokePermission(
        { type: "vault:revoke-permission", key: "v2|chatgpt|Observation|summary|q:|from:|to:" },
        makeVaultSender(),
      );
      expect(result.ok).toBe(true);
    });

    it("handles unparseable key gracefully", async () => {
      runtimeState.session.isUnlocked = true;
      runtimeState.session.alwaysAllowSession.add("some|invalid|unparseable|key");
      const result = await handleRevokePermission(
        { type: "vault:revoke-permission", key: "some|invalid|unparseable|key" },
        makeVaultSender(),
      );
      expect(result.ok).toBe(true);
      expect(mockUpdateSettings).toHaveBeenCalled();
    });
  });

  describe("handleSetProvider (direct)", () => {
    it("returns guard error when requireVaultSender rejects", async () => {
      mockRequireVaultSender.mockReturnValueOnce({ ok: false, error: "untrusted" });
      const result = await handleSetProvider(
        { type: "vault:set-provider", provider: "chatgpt" },
        makeProviderSender(),
      );
      expect(result).toEqual({ ok: false, error: "untrusted" });
    });

    it("clears tracking sets on provider change", async () => {
      runtimeState.connectionSuccessShown.add("chatgpt");
      runtimeState.providerConnectionConfirmed.add("chatgpt");
      const result = await handleSetProvider(
        { type: "vault:set-provider", provider: "claude" },
        makeVaultSender(),
      );
      expect(result.ok).toBe(true);
      expect((result as { provider: string }).provider).toBe("claude");
      expect(runtimeState.connectionSuccessShown.size).toBe(0);
      expect(runtimeState.providerConnectionConfirmed.size).toBe(0);
    });
  });

  describe("handleEnqueueMcpRequest (direct)", () => {
    it("returns error when sender has no tab id", async () => {
      const sender: chrome.runtime.MessageSender = { id: browser.runtime.id, url: "https://chatgpt.com/c/123", frameId: 0 };
      const result = await handleEnqueueMcpRequest(
        { type: "mcp:enqueue-request", provider: "chatgpt", resourceTypes: ["Observation"], depth: "summary" },
        sender,
      );
      expect(result.ok).toBe(false);
    });

    it("returns error when session is locking", async () => {
      runtimeState.session.isLocking = true;
      mockGetSettings.mockResolvedValueOnce({
        locale: "ko-KR", schemaVersion: 1, pinConfig: null,
        lockout: { failedAttempts: 0, lockUntil: null }, connectedProvider: "chatgpt", alwaysAllowScopes: [], integrationWarning: null,
      });
      const result = await handleEnqueueMcpRequest(
        { type: "mcp:enqueue-request", provider: "chatgpt", resourceTypes: ["Observation"], depth: "summary" },
        makeProviderSender(),
      );
      expect(result.ok).toBe(false);
      expect((result as { error: string }).error).toContain("정리 중");
    });

    it("returns error when parse fails", async () => {
      mockGetSettings.mockResolvedValueOnce({
        locale: "ko-KR", schemaVersion: 1, pinConfig: null,
        lockout: { failedAttempts: 0, lockUntil: null }, connectedProvider: "chatgpt", alwaysAllowScopes: [], integrationWarning: null,
      });
      mockParseReadRequestPayload.mockReturnValueOnce({ success: false, error: {} as never });
      const result = await handleEnqueueMcpRequest(
        { type: "mcp:enqueue-request", provider: "chatgpt", resourceTypes: ["Observation"], depth: "summary" },
        makeProviderSender(),
      );
      expect(result.ok).toBe(false);
      expect((result as { error: string }).error).toContain("올바르지");
    });

    it("returns error when resource_types is empty", async () => {
      mockGetSettings.mockResolvedValueOnce({
        locale: "ko-KR", schemaVersion: 1, pinConfig: null,
        lockout: { failedAttempts: 0, lockUntil: null }, connectedProvider: "chatgpt", alwaysAllowScopes: [], integrationWarning: null,
      });
      mockParseReadRequestPayload.mockReturnValueOnce({
        success: true, data: { resource_types: [], depth: "summary", limit: 50 },
      } as never);
      const result = await handleEnqueueMcpRequest(
        { type: "mcp:enqueue-request", provider: "chatgpt", resourceTypes: [], depth: "summary" },
        makeProviderSender(),
      );
      expect(result.ok).toBe(false);
      expect((result as { error: string }).error).toContain("리소스 타입");
    });

    it("skips connection success overlay when already shown", async () => {
      mockGetSettings.mockResolvedValueOnce({
        locale: "ko-KR", schemaVersion: 1, pinConfig: null,
        lockout: { failedAttempts: 0, lockUntil: null }, connectedProvider: "chatgpt", alwaysAllowScopes: [], integrationWarning: null,
      });
      runtimeState.providerConnectionConfirmed.clear();
      runtimeState.connectionSuccessShown.add("chatgpt");
      const result = await handleEnqueueMcpRequest(
        { type: "mcp:enqueue-request", provider: "chatgpt", resourceTypes: ["Observation"], depth: "summary" },
        makeProviderSender(),
      );
      expect(result.ok).toBe(true);
      expect(mockSendOverlay).not.toHaveBeenCalledWith("chatgpt", expect.objectContaining({ type: "overlay:connection-success" }), expect.anything());
    });

    it("skips connection success when already confirmed", async () => {
      mockGetSettings.mockResolvedValueOnce({
        locale: "ko-KR", schemaVersion: 1, pinConfig: null,
        lockout: { failedAttempts: 0, lockUntil: null }, connectedProvider: "chatgpt", alwaysAllowScopes: [], integrationWarning: null,
      });
      runtimeState.providerConnectionConfirmed.add("chatgpt");
      const result = await handleEnqueueMcpRequest(
        { type: "mcp:enqueue-request", provider: "chatgpt", resourceTypes: ["Observation"], depth: "summary" },
        makeProviderSender(),
      );
      expect(result.ok).toBe(true);
      expect(mockSendOverlay).not.toHaveBeenCalledWith("chatgpt", expect.objectContaining({ type: "overlay:connection-success" }), expect.anything());
    });
  });

  describe("handleApprovalDecision (direct)", () => {
    function makePendingApproval(requestId: string, overrides: Partial<import("./state").PendingApproval> = {}) {
      return {
        request: { id: requestId, provider: "chatgpt" as const, resourceTypes: ["Observation" as const], depth: "summary" as const, aiDescription: "test", extensionSummary: "test", resourceOptions: undefined, createdAt: new Date().toISOString(), deadlineAt: Date.now() + 60_000 },
        allowAlways: false, timerId: null, renderWatchdogId: null, renderWatchdogChecks: 0, overlayRendered: true, resolve: vi.fn(), settled: false, sourceTabId: 10,
        ...overrides,
      };
    }

    it("returns error when sender is not trusted for provider", async () => {
      const requestId = "req-untrusted";
      runtimeState.approvals.set(requestId, makePendingApproval(requestId));
      mockIsTrustedSenderForProvider.mockReturnValueOnce(false);
      const result = await handleApprovalDecision(
        { type: "approval:decision", requestId, decision: "denied" },
        makeProviderSender(),
      );
      expect(result.ok).toBe(false);
      expect((result as { error: string }).error).toContain("신뢰");
    });

    it("returns error when source tab does not match", async () => {
      const requestId = "req-tab-mismatch";
      runtimeState.approvals.set(requestId, makePendingApproval(requestId, { sourceTabId: 999 }));
      const result = await handleApprovalDecision(
        { type: "approval:decision", requestId, decision: "denied" },
        makeProviderSender(),
      );
      expect(result.ok).toBe(false);
      expect((result as { error: string }).error).toContain("탭이 일치");
    });

    it("returns error when approved but card not ready (not current request)", async () => {
      const requestId = "req-not-current";
      runtimeState.approvals.set(requestId, makePendingApproval(requestId, { overlayRendered: true }));
      runtimeState.currentRequestId = "other-req";
      const result = await handleApprovalDecision(
        { type: "approval:decision", requestId, decision: "approved" },
        makeProviderSender(),
      );
      expect(result.ok).toBe(false);
      expect((result as { error: string }).error).toContain("카드가 준비되지");
    });

    it("returns error when approved but overlay not rendered", async () => {
      const requestId = "req-not-rendered";
      runtimeState.approvals.set(requestId, makePendingApproval(requestId, { overlayRendered: false }));
      runtimeState.currentRequestId = requestId;
      const result = await handleApprovalDecision(
        { type: "approval:decision", requestId, decision: "approved" },
        makeProviderSender(),
      );
      expect(result.ok).toBe(false);
      expect((result as { error: string }).error).toContain("카드가 준비되지");
    });

    it("returns error when denied settlement fails", async () => {
      const requestId = "req-deny-fail";
      runtimeState.approvals.set(requestId, makePendingApproval(requestId));
      mockSettleApproval.mockResolvedValueOnce(false);
      const result = await handleApprovalDecision(
        { type: "approval:decision", requestId, decision: "denied" },
        makeProviderSender(),
      );
      expect(result.ok).toBe(false);
    });

    it("returns error when permissionLevel is invalid", async () => {
      const requestId = "req-bad-perm";
      runtimeState.approvals.set(requestId, makePendingApproval(requestId));
      runtimeState.currentRequestId = requestId;
      const result = await handleApprovalDecision(
        { type: "approval:decision", requestId, decision: "approved", permissionLevel: "invalid-level" as never },
        makeProviderSender(),
      );
      expect(result.ok).toBe(false);
      expect((result as { error: string }).error).toContain("권한 설정");
    });

    it("returns error when always permission used with individual items", async () => {
      const requestId = "req-always-items";
      runtimeState.approvals.set(requestId, makePendingApproval(requestId));
      runtimeState.currentRequestId = requestId;
      mockNormalizeApprovalSelection.mockReturnValueOnce({ selectedResourceTypes: ["Observation"], selectedItemIds: ["item-1"] });
      const result = await handleApprovalDecision(
        { type: "approval:decision", requestId, decision: "approved", permissionLevel: "always" },
        makeProviderSender(),
      );
      expect(result.ok).toBe(false);
      expect((result as { error: string }).error).toContain("항상 허용");
    });

    it("returns error when no resource types selected", async () => {
      const requestId = "req-no-types";
      runtimeState.approvals.set(requestId, makePendingApproval(requestId));
      runtimeState.currentRequestId = requestId;
      mockNormalizeApprovalSelection.mockReturnValueOnce({ selectedResourceTypes: [], selectedItemIds: [] });
      const result = await handleApprovalDecision(
        { type: "approval:decision", requestId, decision: "approved", permissionLevel: "one-time" },
        makeProviderSender(),
      );
      expect(result.ok).toBe(false);
      expect((result as { error: string }).error).toContain("최소 한 개");
    });

    it("applies item selection when items are selected", async () => {
      const requestId = "req-items";
      runtimeState.approvals.set(requestId, makePendingApproval(requestId));
      runtimeState.currentRequestId = requestId;
      const mockResponse: ReadHealthRecordsResponse = {
        schema_version: "1.0", status: "ok", depth: "summary", resources: [{ resourceType: "Observation", id: "item-1", date: "2024-01-01", data: {} }], count: 1,
        meta: { total_available: 1, filtered_count: 1, query_matched: false },
      };
      mockNormalizeApprovalSelection.mockReturnValueOnce({ selectedResourceTypes: ["Observation"], selectedItemIds: ["item-1"] });
      mockRunApproval.mockResolvedValueOnce(mockResponse);
      mockApplyApprovalItemSelection.mockReturnValueOnce(mockResponse);
      mockComputeApprovalSharedTypes.mockReturnValueOnce(["Observation"]);
      const result = await handleApprovalDecision(
        { type: "approval:decision", requestId, decision: "approved", permissionLevel: "one-time" },
        makeProviderSender(),
      );
      expect(result.ok).toBe(true);
      expect(mockApplyApprovalItemSelection).toHaveBeenCalled();
    });

    it("returns error when item selection results in zero count", async () => {
      const requestId = "req-zero-items";
      runtimeState.approvals.set(requestId, makePendingApproval(requestId));
      runtimeState.currentRequestId = requestId;
      const mockResponse: ReadHealthRecordsResponse = {
        schema_version: "1.0", status: "ok", depth: "summary", resources: [], count: 0,
        meta: { total_available: 0, filtered_count: 0, query_matched: false },
      };
      mockNormalizeApprovalSelection.mockReturnValueOnce({ selectedResourceTypes: ["Observation"], selectedItemIds: ["item-1"] });
      mockRunApproval.mockResolvedValueOnce({ ...mockResponse, count: 1 });
      mockApplyApprovalItemSelection.mockReturnValueOnce({ ...mockResponse, count: 0 });
      const result = await handleApprovalDecision(
        { type: "approval:decision", requestId, decision: "approved", permissionLevel: "one-time" },
        makeProviderSender(),
      );
      expect(result.ok).toBe(false);
      expect((result as { error: string }).error).toContain("찾지 못했습니다");
    });

    it("persists always scopes when permission is always and response is ok", async () => {
      const requestId = "req-always-ok";
      runtimeState.approvals.set(requestId, makePendingApproval(requestId));
      runtimeState.currentRequestId = requestId;
      const mockResponse: ReadHealthRecordsResponse = {
        schema_version: "1.0", status: "ok", depth: "summary", resources: [], count: 0,
        meta: { total_available: 0, filtered_count: 0, query_matched: false },
      };
      mockNormalizeApprovalSelection.mockReturnValueOnce({ selectedResourceTypes: ["Observation"], selectedItemIds: [] });
      mockRunApproval.mockResolvedValueOnce(mockResponse);
      mockComputeApprovalSharedTypes.mockReturnValueOnce(["Observation"]);
      const result = await handleApprovalDecision(
        { type: "approval:decision", requestId, decision: "approved", permissionLevel: "always" },
        makeProviderSender(),
      );
      expect(result.ok).toBe(true);
      expect(mockPersistAlwaysScopes).toHaveBeenCalled();
    });

    it("falls back to one-time when persistAlwaysScopes fails", async () => {
      const requestId = "req-always-fail";
      runtimeState.approvals.set(requestId, makePendingApproval(requestId));
      runtimeState.currentRequestId = requestId;
      const mockResponse: ReadHealthRecordsResponse = {
        schema_version: "1.0", status: "ok", depth: "summary", resources: [], count: 0,
        meta: { total_available: 0, filtered_count: 0, query_matched: false },
      };
      mockNormalizeApprovalSelection.mockReturnValueOnce({ selectedResourceTypes: ["Observation"], selectedItemIds: [] });
      mockRunApproval.mockResolvedValueOnce(mockResponse);
      mockComputeApprovalSharedTypes.mockReturnValueOnce(["Observation"]);
      mockPersistAlwaysScopes.mockResolvedValueOnce(false);
      const result = await handleApprovalDecision(
        { type: "approval:decision", requestId, decision: "approved", permissionLevel: "always" },
        makeProviderSender(),
      );
      expect(result.ok).toBe(true);
      expect(mockSettleApproval).toHaveBeenCalledWith(
        requestId, mockResponse, "approved", "one-time", ["Observation"], "always allow persistence failed",
      );
    });

    it("returns error when settlement fails for approved decision", async () => {
      const requestId = "req-settle-fail";
      runtimeState.approvals.set(requestId, makePendingApproval(requestId));
      runtimeState.currentRequestId = requestId;
      const mockResponse: ReadHealthRecordsResponse = {
        schema_version: "1.0", status: "ok", depth: "summary", resources: [], count: 0,
        meta: { total_available: 0, filtered_count: 0, query_matched: false },
      };
      mockNormalizeApprovalSelection.mockReturnValueOnce({ selectedResourceTypes: ["Observation"], selectedItemIds: [] });
      mockRunApproval.mockResolvedValueOnce(mockResponse);
      mockComputeApprovalSharedTypes.mockReturnValueOnce(["Observation"]);
      mockSettleApproval.mockResolvedValueOnce(false);
      const result = await handleApprovalDecision(
        { type: "approval:decision", requestId, decision: "approved", permissionLevel: "one-time" },
        makeProviderSender(),
      );
      expect(result.ok).toBe(false);
    });

    it("handles approval with error response status", async () => {
      const requestId = "req-err-response";
      runtimeState.approvals.set(requestId, makePendingApproval(requestId));
      runtimeState.currentRequestId = requestId;
      const errorResponse: ReadHealthRecordsResponse = {
        schema_version: "1.0", status: "error", depth: "summary", resources: [], count: 0,
        meta: { total_available: 0, filtered_count: 0, query_matched: false },
        error: { code: "TEST_ERROR", message: "test" },
      };
      mockNormalizeApprovalSelection.mockReturnValueOnce({ selectedResourceTypes: ["Observation"], selectedItemIds: [] });
      mockRunApproval.mockResolvedValueOnce(errorResponse);
      mockComputeApprovalSharedTypes.mockReturnValueOnce(["Observation"]);
      const result = await handleApprovalDecision(
        { type: "approval:decision", requestId, decision: "approved", permissionLevel: "one-time" },
        makeProviderSender(),
      );
      expect(result.ok).toBe(true);
      expect((result as { status: string }).status).toBe("error");
    });

    it("does not call applyApprovalItemSelection when no item ids", async () => {
      const requestId = "req-no-item-ids";
      runtimeState.approvals.set(requestId, makePendingApproval(requestId));
      runtimeState.currentRequestId = requestId;
      const mockResponse: ReadHealthRecordsResponse = {
        schema_version: "1.0", status: "ok", depth: "summary", resources: [], count: 0,
        meta: { total_available: 0, filtered_count: 0, query_matched: false },
      };
      mockNormalizeApprovalSelection.mockReturnValueOnce({ selectedResourceTypes: ["Observation"], selectedItemIds: [] });
      mockRunApproval.mockResolvedValueOnce(mockResponse);
      mockComputeApprovalSharedTypes.mockReturnValueOnce(["Observation"]);
      const result = await handleApprovalDecision(
        { type: "approval:decision", requestId, decision: "approved", permissionLevel: "one-time" },
        makeProviderSender(),
      );
      expect(result.ok).toBe(true);
      expect(mockApplyApprovalItemSelection).not.toHaveBeenCalled();
    });

    it("does not persist always scopes when permission is one-time", async () => {
      const requestId = "req-one-time";
      runtimeState.approvals.set(requestId, makePendingApproval(requestId));
      runtimeState.currentRequestId = requestId;
      const mockResponse: ReadHealthRecordsResponse = {
        schema_version: "1.0", status: "ok", depth: "summary", resources: [], count: 0,
        meta: { total_available: 0, filtered_count: 0, query_matched: false },
      };
      mockNormalizeApprovalSelection.mockReturnValueOnce({ selectedResourceTypes: ["Observation"], selectedItemIds: [] });
      mockRunApproval.mockResolvedValueOnce(mockResponse);
      mockComputeApprovalSharedTypes.mockReturnValueOnce(["Observation"]);
      const result = await handleApprovalDecision(
        { type: "approval:decision", requestId, decision: "approved", permissionLevel: "one-time" },
        makeProviderSender(),
      );
      expect(result.ok).toBe(true);
      expect(mockPersistAlwaysScopes).not.toHaveBeenCalled();
    });

    it("does not persist always scopes when response status is not ok", async () => {
      const requestId = "req-always-err";
      runtimeState.approvals.set(requestId, makePendingApproval(requestId));
      runtimeState.currentRequestId = requestId;
      const errorResponse: ReadHealthRecordsResponse = {
        schema_version: "1.0", status: "error", depth: "summary", resources: [], count: 0,
        meta: { total_available: 0, filtered_count: 0, query_matched: false },
        error: { code: "TEST_ERROR", message: "err" },
      };
      mockNormalizeApprovalSelection.mockReturnValueOnce({ selectedResourceTypes: ["Observation"], selectedItemIds: [] });
      mockRunApproval.mockResolvedValueOnce(errorResponse);
      mockComputeApprovalSharedTypes.mockReturnValueOnce(["Observation"]);
      const result = await handleApprovalDecision(
        { type: "approval:decision", requestId, decision: "approved", permissionLevel: "always" },
        makeProviderSender(),
      );
      expect(result.ok).toBe(true);
      expect(mockPersistAlwaysScopes).not.toHaveBeenCalled();
    });

    it("defaults permissionLevel to one-time when not specified", async () => {
      const requestId = "req-default-perm";
      runtimeState.approvals.set(requestId, makePendingApproval(requestId));
      runtimeState.currentRequestId = requestId;
      const mockResponse: ReadHealthRecordsResponse = {
        schema_version: "1.0", status: "ok", depth: "summary", resources: [], count: 0,
        meta: { total_available: 0, filtered_count: 0, query_matched: false },
      };
      mockNormalizeApprovalSelection.mockReturnValueOnce({ selectedResourceTypes: ["Observation"], selectedItemIds: [] });
      mockRunApproval.mockResolvedValueOnce(mockResponse);
      mockComputeApprovalSharedTypes.mockReturnValueOnce(["Observation"]);
      const result = await handleApprovalDecision(
        { type: "approval:decision", requestId, decision: "approved" },
        makeProviderSender(),
      );
      expect(result.ok).toBe(true);
      // Should have settled with "one-time" permission
      expect(mockSettleApproval).toHaveBeenCalledWith(
        requestId, mockResponse, "approved", "one-time", ["Observation"], undefined,
      );
    });

    it("skips source tab check when sourceTabId is null", async () => {
      const requestId = "req-no-source-tab";
      runtimeState.approvals.set(requestId, makePendingApproval(requestId, { sourceTabId: null }));
      const result = await handleApprovalDecision(
        { type: "approval:decision", requestId, decision: "denied" },
        makeProviderSender(),
      );
      expect((result as { status: string }).status).toBe("denied");
    });
  });

  describe("handleOverlayReady (direct)", () => {
    it("returns error when sender is not trusted", async () => {
      mockIsTrustedSenderForProvider.mockReturnValueOnce(false);
      const result = await handleOverlayReady(
        { type: "overlay:ready", provider: "chatgpt" },
        makeProviderSender(),
      );
      expect(result.ok).toBe(false);
    });

    it("clears integration warning when it matches the standard message", async () => {
      mockGetSettings.mockResolvedValueOnce({
        locale: "ko-KR", schemaVersion: 1, pinConfig: null,
        lockout: { failedAttempts: 0, lockUntil: null }, connectedProvider: null, alwaysAllowScopes: [],
        integrationWarning: INTEGRATION_WARNING_MESSAGE,
      });
      const result = await handleOverlayReady(
        { type: "overlay:ready", provider: "chatgpt" },
        makeProviderSender(),
      );
      expect(result.ok).toBe(true);
      expect(mockUpdateSettings).toHaveBeenCalled();
    });

    it("does not clear integration warning when it differs", async () => {
      mockGetSettings.mockResolvedValueOnce({
        locale: "ko-KR", schemaVersion: 1, pinConfig: null,
        lockout: { failedAttempts: 0, lockUntil: null }, connectedProvider: null, alwaysAllowScopes: [],
        integrationWarning: "some other warning",
      });
      const result = await handleOverlayReady(
        { type: "overlay:ready", provider: "chatgpt" },
        makeProviderSender(),
      );
      expect(result.ok).toBe(true);
      expect(mockUpdateSettings).not.toHaveBeenCalled();
    });

    it("does not set providerTab when sender has no tab id", async () => {
      const sender: chrome.runtime.MessageSender = { id: browser.runtime.id, url: "https://chatgpt.com/c/123", frameId: 0 };
      const result = await handleOverlayReady(
        { type: "overlay:ready", provider: "chatgpt" },
        sender,
      );
      expect(result.ok).toBe(true);
      expect(runtimeState.providerTabs.has("chatgpt")).toBe(false);
    });

    it("calls emitQueueState with null when sender has no tab id", async () => {
      const sender: chrome.runtime.MessageSender = { id: browser.runtime.id, url: "https://chatgpt.com/c/123", frameId: 0 };
      await handleOverlayReady(
        { type: "overlay:ready", provider: "chatgpt" },
        sender,
      );
      expect(mockEmitQueueState).toHaveBeenCalledWith("chatgpt", null);
    });
  });

  describe("handleOverlayRendered (direct) - additional branches", () => {
    it("returns error when sender is not trusted for provider", () => {
      const requestId = "req-untrusted-render";
      runtimeState.approvals.set(requestId, {
        request: { id: requestId, provider: "chatgpt", resourceTypes: ["Observation"], depth: "summary", aiDescription: "test", extensionSummary: "test", resourceOptions: undefined, createdAt: new Date().toISOString(), deadlineAt: Date.now() + 60_000 },
        allowAlways: false, timerId: null, renderWatchdogId: null, renderWatchdogChecks: 0, overlayRendered: false, resolve: vi.fn(), settled: false, sourceTabId: 10,
      });
      mockIsTrustedSenderForProvider.mockReturnValueOnce(false);
      const result = handleOverlayRendered({ type: "overlay:approval-rendered", requestId }, makeProviderSender());
      expect(result.ok).toBe(false);
    });

    it("returns error when source tab does not match", () => {
      const requestId = "req-tab-mismatch-render";
      runtimeState.approvals.set(requestId, {
        request: { id: requestId, provider: "chatgpt", resourceTypes: ["Observation"], depth: "summary", aiDescription: "test", extensionSummary: "test", resourceOptions: undefined, createdAt: new Date().toISOString(), deadlineAt: Date.now() + 60_000 },
        allowAlways: false, timerId: null, renderWatchdogId: null, renderWatchdogChecks: 0, overlayRendered: false, resolve: vi.fn(), settled: false, sourceTabId: 999,
      });
      const result = handleOverlayRendered({ type: "overlay:approval-rendered", requestId }, makeProviderSender());
      expect(result.ok).toBe(false);
      expect((result as { error: string }).error).toContain("탭이 일치");
    });

    it("does not clear watchdog when none exists", () => {
      const requestId = "req-no-watchdog";
      runtimeState.approvals.set(requestId, {
        request: { id: requestId, provider: "chatgpt", resourceTypes: ["Observation"], depth: "summary", aiDescription: "test", extensionSummary: "test", resourceOptions: undefined, createdAt: new Date().toISOString(), deadlineAt: Date.now() + 60_000 },
        allowAlways: false, timerId: null, renderWatchdogId: null, renderWatchdogChecks: 0, overlayRendered: false, resolve: vi.fn(), settled: false, sourceTabId: 10,
      });
      const result = handleOverlayRendered({ type: "overlay:approval-rendered", requestId }, makeProviderSender());
      expect(result.ok).toBe(true);
      expect(runtimeState.approvals.get(requestId)!.overlayRendered).toBe(true);
    });

    it("skips source tab check when sourceTabId is null", () => {
      const requestId = "req-null-source-render";
      runtimeState.approvals.set(requestId, {
        request: { id: requestId, provider: "chatgpt", resourceTypes: ["Observation"], depth: "summary", aiDescription: "test", extensionSummary: "test", resourceOptions: undefined, createdAt: new Date().toISOString(), deadlineAt: Date.now() + 60_000 },
        allowAlways: false, timerId: null, renderWatchdogId: null, renderWatchdogChecks: 0, overlayRendered: false, resolve: vi.fn(), settled: false, sourceTabId: null,
      });
      const result = handleOverlayRendered({ type: "overlay:approval-rendered", requestId }, makeProviderSender());
      expect(result.ok).toBe(true);
    });
  });

  describe("handleOverlayRenderFailed (direct)", () => {
    it("returns error when request not found", async () => {
      const result = await handleOverlayRenderFailed(
        { type: "overlay:render-failed", requestId: "nonexistent" },
        makeProviderSender(),
      );
      expect(result.ok).toBe(false);
    });

    it("returns error when sender is not trusted", async () => {
      const requestId = "req-untrusted-fail";
      runtimeState.approvals.set(requestId, {
        request: { id: requestId, provider: "chatgpt", resourceTypes: ["Observation"], depth: "summary", aiDescription: "test", extensionSummary: "test", resourceOptions: undefined, createdAt: new Date().toISOString(), deadlineAt: Date.now() + 60_000 },
        allowAlways: false, timerId: null, renderWatchdogId: null, renderWatchdogChecks: 0, overlayRendered: false, resolve: vi.fn(), settled: false, sourceTabId: 10,
      });
      mockIsTrustedSenderForProvider.mockReturnValueOnce(false);
      const result = await handleOverlayRenderFailed(
        { type: "overlay:render-failed", requestId },
        makeProviderSender(),
      );
      expect(result.ok).toBe(false);
    });

    it("returns error when source tab does not match", async () => {
      const requestId = "req-tab-fail";
      runtimeState.approvals.set(requestId, {
        request: { id: requestId, provider: "chatgpt", resourceTypes: ["Observation"], depth: "summary", aiDescription: "test", extensionSummary: "test", resourceOptions: undefined, createdAt: new Date().toISOString(), deadlineAt: Date.now() + 60_000 },
        allowAlways: false, timerId: null, renderWatchdogId: null, renderWatchdogChecks: 0, overlayRendered: false, resolve: vi.fn(), settled: false, sourceTabId: 999,
      });
      const result = await handleOverlayRenderFailed(
        { type: "overlay:render-failed", requestId },
        makeProviderSender(),
      );
      expect(result.ok).toBe(false);
      expect((result as { error: string }).error).toContain("탭이 일치");
    });

    it("clears renderWatchdog timer if exists", async () => {
      const requestId = "req-watchdog-fail";
      const timerId = setTimeout(() => {}, 99999);
      runtimeState.approvals.set(requestId, {
        request: { id: requestId, provider: "chatgpt", resourceTypes: ["Observation"], depth: "summary", aiDescription: "test", extensionSummary: "test", resourceOptions: undefined, createdAt: new Date().toISOString(), deadlineAt: Date.now() + 60_000 },
        allowAlways: false, timerId: null, renderWatchdogId: timerId, renderWatchdogChecks: 0, overlayRendered: false, resolve: vi.fn(), settled: false, sourceTabId: 10,
      });
      const result = await handleOverlayRenderFailed(
        { type: "overlay:render-failed", requestId },
        makeProviderSender(),
      );
      expect(result.ok).toBe(true);
      expect(runtimeState.approvals.get(requestId)!.renderWatchdogId).toBeNull();
    });

    it("calls markIntegrationWarning and settleApproval", async () => {
      const requestId = "req-mark-warning";
      runtimeState.approvals.set(requestId, {
        request: { id: requestId, provider: "chatgpt", resourceTypes: ["Observation"], depth: "summary", aiDescription: "test", extensionSummary: "test", resourceOptions: undefined, createdAt: new Date().toISOString(), deadlineAt: Date.now() + 60_000 },
        allowAlways: false, timerId: null, renderWatchdogId: null, renderWatchdogChecks: 0, overlayRendered: false, resolve: vi.fn(), settled: false, sourceTabId: 10,
      });
      const result = await handleOverlayRenderFailed(
        { type: "overlay:render-failed", requestId },
        makeProviderSender(),
      );
      expect((result as { status: string }).status).toBe("error");
      expect(mockMarkIntegrationWarning).toHaveBeenCalled();
      expect(mockSettleApproval).toHaveBeenCalled();
      expect(mockPumpQueue).toHaveBeenCalled();
    });

    it("returns error for already settled request", async () => {
      const requestId = "req-already-settled-fail";
      runtimeState.approvals.set(requestId, {
        request: { id: requestId, provider: "chatgpt", resourceTypes: ["Observation"], depth: "summary", aiDescription: "test", extensionSummary: "test", resourceOptions: undefined, createdAt: new Date().toISOString(), deadlineAt: Date.now() + 60_000 },
        allowAlways: false, timerId: null, renderWatchdogId: null, renderWatchdogChecks: 0, overlayRendered: false, resolve: vi.fn(), settled: true, sourceTabId: 10,
      });
      const result = await handleOverlayRenderFailed(
        { type: "overlay:render-failed", requestId },
        makeProviderSender(),
      );
      expect(result.ok).toBe(false);
    });
  });

  describe("handleOverlayOpenVault (direct)", () => {
    it("returns untrusted response when sender is not trusted", async () => {
      mockIsTrustedOverlaySender.mockReturnValueOnce(false);
      const result = await handleOverlayOpenVault(makeProviderSender());
      expect(result.ok).toBe(false);
    });

    it("opens setup tab when no pin exists", async () => {
      const result = await handleOverlayOpenVault(makeProviderSender());
      expect(result.ok).toBe(true);
      expect(mockEnsureSetupTab).toHaveBeenCalled();
    });

    it("opens vault tab when pin exists", async () => {
      mockGetSettings.mockResolvedValueOnce({
        locale: "ko-KR", schemaVersion: 1, pinConfig: { salt: "abc", verifier: "def" },
        lockout: { failedAttempts: 0, lockUntil: null }, connectedProvider: null, alwaysAllowScopes: [], integrationWarning: null,
      });
      const result = await handleOverlayOpenVault(makeProviderSender());
      expect(result.ok).toBe(true);
      expect(mockEnsureVaultTab).toHaveBeenCalled();
    });
  });

  describe("handleRuntimeMessage vault tab tracking", () => {
    it("adds sender tab to vaultTabs when url matches vault page", async () => {
      const vaultUrl = browser.runtime.getURL("/vault.html");
      const sender: chrome.runtime.MessageSender = {
        id: browser.runtime.id,
        url: vaultUrl,
        tab: { id: 42, index: 0, active: true, pinned: false, highlighted: false, incognito: false, selected: false, windowId: 1, discarded: false, autoDiscardable: true, groupId: -1 },
        frameId: 0,
      };
      await handleRuntimeMessage({ type: "runtime:ping" }, sender);
      expect(runtimeState.session.vaultTabs.has(42)).toBe(true);
    });

    it("adds sender tab to vaultTabs when tab.url matches vault page", async () => {
      const vaultUrl = browser.runtime.getURL("/vault.html");
      const sender: chrome.runtime.MessageSender = {
        id: browser.runtime.id,
        tab: { id: 43, index: 0, active: true, pinned: false, highlighted: false, incognito: false, selected: false, windowId: 1, url: vaultUrl, discarded: false, autoDiscardable: true, groupId: -1 },
        frameId: 0,
      };
      await handleRuntimeMessage({ type: "runtime:ping" }, sender);
      expect(runtimeState.session.vaultTabs.has(43)).toBe(true);
    });

    it("does not add to vaultTabs when url does not match", async () => {
      const sender: chrome.runtime.MessageSender = {
        id: browser.runtime.id,
        url: "https://other-site.com",
        tab: { id: 44, index: 0, active: true, pinned: false, highlighted: false, incognito: false, selected: false, windowId: 1, discarded: false, autoDiscardable: true, groupId: -1 },
        frameId: 0,
      };
      await handleRuntimeMessage({ type: "runtime:ping" }, sender);
      expect(runtimeState.session.vaultTabs.has(44)).toBe(false);
    });

    it("returns error when handler lookup resolves to falsy (defensive)", async () => {
      // Temporarily inject a key with undefined handler to exercise the defensive fallback on line 640
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (runtimeHandlers as any)["__test:null-handler"] = undefined;
      try {
        const result = await handleRuntimeMessage({ type: "__test:null-handler" }, makeVaultSender());
        expect(result.ok).toBe(false);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (runtimeHandlers as any)["__test:null-handler"];
      }
    });
  });

  describe("routing table wrapper guards", () => {
    it("vault:get-state returns guard error when untrusted", async () => {
      mockRequireVaultOrSetupSender.mockReturnValueOnce({ ok: false, error: "untrusted" });
      const result = await handleRuntimeMessage({ type: "vault:get-state" }, makeProviderSender());
      expect(result).toEqual({ ok: false, error: "untrusted" });
    });

    it("vault:upload-file returns guard error when untrusted", async () => {
      mockRequireVaultSender.mockReturnValueOnce({ ok: false, error: "untrusted" });
      const result = await handleRuntimeMessage(
        { type: "vault:upload-file", name: "test.pdf", mimeType: "application/pdf", size: 1024, bytes: bytesToBase64(new Uint8Array(10)) },
        makeProviderSender(),
      );
      expect(result).toEqual({ ok: false, error: "untrusted" });
    });

    it("vault:download-file returns guard error when untrusted", async () => {
      mockRequireVaultSender.mockReturnValueOnce({ ok: false, error: "untrusted" });
      const result = await handleRuntimeMessage(
        { type: "vault:download-file", fileId: "f1" },
        makeProviderSender(),
      );
      expect(result).toEqual({ ok: false, error: "untrusted" });
    });

    it("vault:delete-file returns guard error when untrusted", async () => {
      mockRequireVaultSender.mockReturnValueOnce({ ok: false, error: "untrusted" });
      const result = await handleRuntimeMessage(
        { type: "vault:delete-file", fileId: "f1" },
        makeProviderSender(),
      );
      expect(result).toEqual({ ok: false, error: "untrusted" });
    });

    it("mcp:enqueue-request returns untrusted when sender has no tab", async () => {
      const sender: chrome.runtime.MessageSender = { id: browser.runtime.id, url: "https://chatgpt.com/c/123", frameId: 0 };
      const result = await handleRuntimeMessage(
        { type: "mcp:enqueue-request", provider: "chatgpt", resourceTypes: ["Observation"], depth: "summary" },
        sender,
      );
      expect(result.ok).toBe(false);
    });

    it("mcp:enqueue-request updates providerTabs when different from current", async () => {
      mockGetSettings.mockResolvedValueOnce({
        locale: "ko-KR", schemaVersion: 1, pinConfig: null,
        lockout: { failedAttempts: 0, lockUntil: null }, connectedProvider: "chatgpt", alwaysAllowScopes: [], integrationWarning: null,
      });
      runtimeState.providerTabs.set("chatgpt", 5); // different from sender tab 10
      await handleRuntimeMessage(
        { type: "mcp:enqueue-request", provider: "chatgpt", resourceTypes: ["Observation"], depth: "summary" },
        makeProviderSender(),
      );
      expect(runtimeState.providerTabs.get("chatgpt")).toBe(10);
    });

    it("mcp:enqueue-request skips providerTabs update when already matching", async () => {
      mockGetSettings.mockResolvedValueOnce({
        locale: "ko-KR", schemaVersion: 1, pinConfig: null,
        lockout: { failedAttempts: 0, lockUntil: null }, connectedProvider: "chatgpt", alwaysAllowScopes: [], integrationWarning: null,
      });
      runtimeState.providerTabs.set("chatgpt", 10); // same as sender tab 10
      runtimeState.providerConnectionConfirmed.add("chatgpt"); // skip connection success
      await handleRuntimeMessage(
        { type: "mcp:enqueue-request", provider: "chatgpt", resourceTypes: ["Observation"], depth: "summary" },
        makeProviderSender(),
      );
      expect(runtimeState.providerTabs.get("chatgpt")).toBe(10);
    });
  });
});
