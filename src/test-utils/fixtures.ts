import type { AiProvider, McpDepth, ResourceType } from "../../packages/contracts/src/index";
import type {
  AppSettings,
  EncryptedEnvelope,
  McpApprovalRequest,
  StoredFileRecord,
  StoredResourceRecord,
} from "../core/models";

export function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    locale: "ko-KR",
    schemaVersion: 1,
    pinConfig: null,
    connectedProvider: null,
    alwaysAllowScopes: [],
    integrationWarning: null,
    ...overrides,
    lockout: {
      failedAttempts: 0,
      lockUntil: null,
      ...overrides.lockout,
    },
  };
}

export function makeEnvelope(overrides: Partial<EncryptedEnvelope> = {}): EncryptedEnvelope {
  return {
    keyVersion: 1,
    iv: "dGVzdC1pdi1ieXRlcw==",
    ciphertext: "dGVzdC1jaXBoZXJ0ZXh0",
    ...overrides,
  };
}

export function makeFileRecord(overrides: Partial<StoredFileRecord> = {}): StoredFileRecord {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    schemaVersion: 1,
    name: "test.pdf",
    mimeType: "application/pdf",
    size: 1024,
    createdAt: new Date().toISOString(),
    status: "done",
    matchedCounts: { Observation: 2 },
    encryptedBlob: makeEnvelope(),
    ...overrides,
  };
}

export function makeResourceRecord(overrides: Partial<StoredResourceRecord> = {}): StoredResourceRecord {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    schemaVersion: 1,
    fileId: "file-1",
    resourceType: "Observation",
    createdAt: new Date().toISOString(),
    date: "2025-01-15",
    encryptedPayload: makeEnvelope(),
    ...overrides,
  };
}

export function makeSender(overrides: Partial<chrome.runtime.MessageSender> = {}): chrome.runtime.MessageSender {
  return {
    id: browser.runtime.id,
    url: browser.runtime.getURL("/vault.html"),
    tab: { id: 1, index: 0, active: true, pinned: false, highlighted: false, incognito: false, selected: false, windowId: 1, discarded: false, autoDiscardable: true, groupId: -1, frozen: false },
    frameId: 0,
    ...overrides,
  };
}

export function makeProviderSender(provider: AiProvider = "chatgpt"): chrome.runtime.MessageSender {
  const hosts: Record<AiProvider, string> = {
    chatgpt: "https://chatgpt.com/c/123",
    claude: "https://claude.ai/chat/456",
    gemini: "https://gemini.google.com/chat/789",
  };
  return makeSender({
    url: hosts[provider],
    tab: {
      id: 10,
      index: 0,
      active: true,
      pinned: false,
      highlighted: false,
      incognito: false,
      selected: false,
      windowId: 1,
      url: hosts[provider],
      discarded: false,
      autoDiscardable: true,
      groupId: -1,
      frozen: false,
    },
  });
}

export function makeApprovalRequest(overrides: Partial<McpApprovalRequest> = {}): McpApprovalRequest {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    provider: "chatgpt",
    resourceTypes: ["Observation"],
    depth: "summary" as McpDepth,
    aiDescription: "건강기록을 확인하려고 합니다.",
    extensionSummary: "🔬 검사 수치",
    createdAt: new Date().toISOString(),
    deadlineAt: Date.now() + 60_000,
    ...overrides,
  };
}

export function makeResourceType(type?: ResourceType): ResourceType {
  return type ?? "Observation";
}
