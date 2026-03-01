import "fake-indexeddb/auto";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { fakeBrowser } from "wxt/testing";

vi.stubGlobal("navigator", { language: "ko-KR" });

describe("approval queue lifecycle integration", () => {
  beforeEach(async () => {
    fakeBrowser.reset();
    vi.resetModules();

    vi.spyOn(browser.tabs, "sendMessage").mockResolvedValue(undefined);
    vi.spyOn(browser.tabs, "get").mockResolvedValue({
      id: 10, index: 0, active: true, pinned: false, highlighted: false,
      incognito: false, selected: false, windowId: 1, url: "https://chatgpt.com/c/123",
      discarded: false, autoDiscardable: true, groupId: -1, frozen: false,
    });
    vi.spyOn(browser.tabs, "query").mockResolvedValue([]);
    vi.spyOn(browser.runtime, "getManifest").mockReturnValue({
      version: "0.0.0-test",
      manifest_version: 3,
      name: "OpenMyHealth Test",
    } as chrome.runtime.Manifest);

    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase("openmyhealth_vault");
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve();
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function setupUnlockedSession() {
    const { runtimeState, setSettingsCache } = await import("../core/background/state");
    const { generateSaltBase64, deriveAesKey, derivePinVerifier } = await import("../core/crypto");
    const { saveSettings } = await import("../core/db");

    const salt = generateSaltBase64();
    const verifier = await derivePinVerifier("123456", salt);
    const key = await deriveAesKey("123456", salt);

    await saveSettings({
      locale: "ko-KR",
      schemaVersion: 1,
      pinConfig: { salt, verifier },
      lockout: { failedAttempts: 0, lockUntil: null },
      connectedProvider: "chatgpt",
      alwaysAllowScopes: [],
      integrationWarning: null,
    });

    runtimeState.session.isUnlocked = true;
    runtimeState.session.key = key;
    runtimeState.session.isLocking = false;
    runtimeState.queue = [];
    runtimeState.approvals.clear();
    runtimeState.currentRequestId = null;
    setSettingsCache(null);

    return { key, runtimeState };
  }

  it("enqueueApprovalRequest creates pending approval in runtimeState", async () => {
    await setupUnlockedSession();
    const { enqueueApprovalRequest } = await import("../core/background/approval-engine");

    const { requestId } = await enqueueApprovalRequest({
      provider: "chatgpt",
      resourceTypes: ["Observation"],
      depth: "summary",
      sourceTabId: 10,
      allowAlways: false,
    });

    expect(requestId).toBeTruthy();
    expect(typeof requestId).toBe("string");
  });

  it("settleApproval with approved resolves promise with MCP response", async () => {
    await setupUnlockedSession();
    const { enqueueApprovalRequest, settleApproval } = await import("../core/background/approval-engine");
    const { runtimeState } = await import("../core/background/state");
    const { buildMcpErrorResponse } = await import("../../packages/contracts/src/index");

    const { requestId, promise } = await enqueueApprovalRequest({
      provider: "chatgpt",
      resourceTypes: ["Observation"],
      depth: "summary",
      sourceTabId: 10,
      allowAlways: false,
    });

    const pending = runtimeState.approvals.get(requestId);
    if (pending && !pending.settled) {
      const response = buildMcpErrorResponse("summary", "INTERNAL_ERROR", "test", false);
      const settled = await settleApproval(requestId, response, "approved", "one-time");
      expect(settled).toBe(true);
      const result = await promise;
      expect(result.status).toBe("error");
    }
  });

  it("settleApproval with denied resolves with denied response", async () => {
    await setupUnlockedSession();
    const { enqueueApprovalRequest, settleApproval } = await import("../core/background/approval-engine");
    const { runtimeState } = await import("../core/background/state");
    const { buildMcpDeniedResponse } = await import("../../packages/contracts/src/index");

    const { requestId, promise } = await enqueueApprovalRequest({
      provider: "chatgpt",
      resourceTypes: ["Observation"],
      depth: "summary",
      sourceTabId: 10,
      allowAlways: false,
    });

    const pending = runtimeState.approvals.get(requestId);
    if (pending && !pending.settled) {
      const response = buildMcpDeniedResponse("summary");
      const settled = await settleApproval(requestId, response, "denied", "one-time");
      expect(settled).toBe(true);
      const result = await promise;
      expect(result.status).toBe("denied");
    }
  });

  it("handleApprovalTimeout resolves with timeout response", async () => {
    await setupUnlockedSession();
    const { enqueueApprovalRequest, handleApprovalTimeout } = await import("../core/background/approval-engine");
    const { runtimeState } = await import("../core/background/state");

    const { requestId, promise } = await enqueueApprovalRequest({
      provider: "chatgpt",
      resourceTypes: ["Observation"],
      depth: "summary",
      sourceTabId: 10,
      allowAlways: false,
    });

    const pending = runtimeState.approvals.get(requestId);
    if (pending && !pending.settled) {
      await handleApprovalTimeout(requestId);
      const result = await promise;
      expect(result.status).toBe("timeout");
    }
  });

  it("writes audit log on settlement", async () => {
    await setupUnlockedSession();
    const { enqueueApprovalRequest, settleApproval } = await import("../core/background/approval-engine");
    const { runtimeState } = await import("../core/background/state");
    const { buildMcpDeniedResponse } = await import("../../packages/contracts/src/index");
    const { listAuditLogs } = await import("../core/db");

    const { requestId, promise } = await enqueueApprovalRequest({
      provider: "chatgpt",
      resourceTypes: ["Observation"],
      depth: "summary",
      sourceTabId: 10,
      allowAlways: false,
    });

    const pending = runtimeState.approvals.get(requestId);
    if (pending && !pending.settled) {
      const response = buildMcpDeniedResponse("summary");
      await settleApproval(requestId, response, "denied", "one-time");
      await promise;

      const logs = await listAuditLogs(10);
      expect(logs.length).toBeGreaterThan(0);
      const auditEntry = logs[0];
      expect(auditEntry.result).toBe("denied");
      expect(auditEntry.ai_provider).toBe("chatgpt");
      expect(auditEntry.resource_types).toContain("Observation");
    }
  });

  it("lockSession clears all pending approvals", async () => {
    await setupUnlockedSession();
    const { enqueueApprovalRequest, lockSession } = await import("../core/background/approval-engine");
    const { runtimeState } = await import("../core/background/state");

    const { promise } = await enqueueApprovalRequest({
      provider: "chatgpt",
      resourceTypes: ["Observation"],
      depth: "summary",
      sourceTabId: 10,
      allowAlways: false,
    });

    await lockSession("test lock");

    expect(runtimeState.session.isUnlocked).toBe(false);
    expect(runtimeState.session.key).toBeNull();
    expect(runtimeState.approvals.size).toBe(0);
    expect(runtimeState.queue).toHaveLength(0);

    const result = await promise;
    expect(result.status).toBe("error");
  });

  it("always-allow auto-approves after granting permission", async () => {
    const { runtimeState } = await setupUnlockedSession();
    const { persistAlwaysScopes, hasAlwaysAllow } = await import("../core/background/approval-engine");
    const { permissionKey } = await import("../core/background/permission-scope");

    const scopeKey = permissionKey({
      provider: "chatgpt",
      resourceType: "Observation",
      depth: "summary",
    });
    await persistAlwaysScopes([scopeKey]);

    expect(runtimeState.session.alwaysAllowSession.has(scopeKey)).toBe(true);

    const request = {
      id: crypto.randomUUID(),
      provider: "chatgpt" as const,
      resourceTypes: ["Observation" as const],
      depth: "summary" as const,
      aiDescription: "test",
      extensionSummary: "test",
      createdAt: new Date().toISOString(),
      deadlineAt: Date.now() + 60000,
    };

    const result = await hasAlwaysAllow(request, true);
    expect(result).toBe(true);
  });

  it("re-enqueue after timeout does not leave stale state", async () => {
    await setupUnlockedSession();
    const { enqueueApprovalRequest, handleApprovalTimeout } = await import("../core/background/approval-engine");
    const { runtimeState } = await import("../core/background/state");

    const { requestId: firstId, promise: firstPromise } = await enqueueApprovalRequest({
      provider: "chatgpt",
      resourceTypes: ["Observation"],
      depth: "summary",
      sourceTabId: 10,
      allowAlways: false,
    });

    const firstPending = runtimeState.approvals.get(firstId);
    if (firstPending && !firstPending.settled) {
      await handleApprovalTimeout(firstId);
      const firstResult = await firstPromise;
      expect(firstResult.status).toBe("timeout");
    }

    const { requestId: secondId } = await enqueueApprovalRequest({
      provider: "chatgpt",
      resourceTypes: ["Observation"],
      depth: "summary",
      sourceTabId: 10,
      allowAlways: false,
    });

    expect(secondId).toBeTruthy();
    expect(secondId).not.toBe(firstId);
  });

  it("settleApproval returns false for already-settled requests", async () => {
    await setupUnlockedSession();
    const { enqueueApprovalRequest, settleApproval } = await import("../core/background/approval-engine");
    const { runtimeState } = await import("../core/background/state");
    const { buildMcpDeniedResponse } = await import("../../packages/contracts/src/index");

    const { requestId, promise } = await enqueueApprovalRequest({
      provider: "chatgpt",
      resourceTypes: ["Observation"],
      depth: "summary",
      sourceTabId: 10,
      allowAlways: false,
    });

    const pending = runtimeState.approvals.get(requestId);
    if (pending && !pending.settled) {
      const response = buildMcpDeniedResponse("summary");
      const first = await settleApproval(requestId, response, "denied", "one-time");
      expect(first).toBe(true);

      const second = await settleApproval(requestId, response, "denied", "one-time");
      expect(second).toBe(false);
      await promise;
    }
  });
});
