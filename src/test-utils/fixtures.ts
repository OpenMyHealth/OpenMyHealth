import type {
  AiProvider,
  AuditLogEntry,
  McpDataRecord,
  McpDepth,
  ResourceType,
} from "../../packages/contracts/src/index";
import type {
  AppSettings,
  EncryptedEnvelope,
  McpApprovalRequest,
  StoredFileRecord,
  StoredResourceRecord,
  VaultFileSummary,
  VaultPermissionScope,
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

export function makeAuditLogEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ai_provider: "chatgpt",
    resource_types: ["Observation"],
    depth: "summary",
    result: "approved",
    permission_level: "one-time",
    ...overrides,
  };
}

export function makePermissionScope(overrides: Partial<VaultPermissionScope> = {}): VaultPermissionScope {
  return {
    key: overrides.key ?? `chatgpt:Observation:summary`,
    provider: "chatgpt",
    resourceType: "Observation",
    depth: "summary",
    legacy: false,
    ...overrides,
  };
}

export function makeVaultFileSummary(overrides: Partial<VaultFileSummary> = {}): VaultFileSummary {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: "test.pdf",
    mimeType: "application/pdf",
    size: 1024,
    createdAt: new Date().toISOString(),
    status: "done",
    matchedCounts: { Observation: 2 },
    ...overrides,
  };
}

export function makeDataRecord(overrides: Partial<McpDataRecord> = {}): McpDataRecord {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    code: "6690-2",
    system: "http://loinc.org",
    display: "백혈구 수",
    value: 7.5,
    unit: "10^3/uL",
    date: "2025-01-15",
    ...overrides,
  };
}
