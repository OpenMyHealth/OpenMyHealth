import type {
  AiProvider,
  McpDepth,
  ReadHealthRecordsResponse,
  ResourceType,
} from "../../../packages/contracts/src/index";
import type { AppSettings, McpApprovalRequest } from "../models";

// ── Types ──

export type PendingApproval = {
  request: McpApprovalRequest;
  allowAlways: boolean;
  timerId: ReturnType<typeof setTimeout> | null;
  renderWatchdogId: ReturnType<typeof setTimeout> | null;
  renderWatchdogChecks: number;
  overlayRendered: boolean;
  resolve: (result: ReadHealthRecordsResponse) => void;
  settled: boolean;
  sourceTabId: number | null;
};

export type PersistedPendingApproval = {
  id: string;
};

export type PersistedApprovalState = {
  queue: string[];
  approvals: PersistedPendingApproval[];
};

export type AlwaysAllowScope = {
  provider: AiProvider;
  resourceType: ResourceType;
  depth: McpDepth;
  query?: string;
  dateFrom?: string;
  dateTo?: string;
};

// ── Runtime singleton ──

export const runtimeState = {
  session: {
    isUnlocked: false,
    isLocking: false,
    key: null as CryptoKey | null,
    vaultTabs: new Set<number>(),
    alwaysAllowSession: new Set<string>(),
  },
  queue: [] as string[],
  approvals: new Map<string, PendingApproval>(),
  currentRequestId: null as string | null,
  providerTabs: new Map<AiProvider, number>(),
  requestRateByTab: new Map<number, number[]>(),
  connectionSuccessShown: new Set<AiProvider>(),
  providerConnectionConfirmed: new Set<AiProvider>(),
};

// ── Module-level state with setters ──

let _settingsCache: AppSettings | null = null;
let _unlockInFlight: Promise<unknown> = Promise.resolve();
let _backgroundInitPromise: Promise<void> | null = null;

export function getSettingsCache() {
  return _settingsCache;
}
export function setSettingsCache(value: AppSettings | null) {
  _settingsCache = value;
}

export function getUnlockInFlight() {
  return _unlockInFlight;
}
export function setUnlockInFlight(value: Promise<unknown>) {
  _unlockInFlight = value;
}

export function getBackgroundInitPromise() {
  return _backgroundInitPromise;
}
export function setBackgroundInitPromise(value: Promise<void> | null) {
  _backgroundInitPromise = value;
}

// ── Constants ──

export const APPROVAL_STATE_STORAGE_KEY = "pending-approvals-v1";
export const INTEGRATION_WARNING_MESSAGE =
  "AI 사이트와 연결이 끊겼습니다. AI 탭을 새로고침한 뒤 다시 시도해 주세요. 계속되면 확장 프로그램 업데이트를 확인해 주세요.";
/* v8 ignore next -- compile-time ternary; only one branch is reachable per build */
export const RUNTIME_MODE: "dev" | "prod" = import.meta.env.DEV ? "dev" : "prod";
export const REQUEST_RATE_WINDOW_MS = 30_000;
export const REQUEST_RATE_MAX_PER_WINDOW = 8;

// ── Utilities ──

export function nowIso(): string {
  return new Date().toISOString();
}
