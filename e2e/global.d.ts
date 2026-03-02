interface OmhHarness {
  ready: boolean;
  provider: string | null;
  responses: unknown[];
  _readyResolvers: Array<() => void>;
  _pendingRequests: Map<string, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void; timer: ReturnType<typeof setTimeout> }>;
  waitForReady(timeoutMs?: number): Promise<void>;
  sendMcpRequest(payload: unknown): Promise<unknown>;
  clearResponses(): void;
}

declare global {
  interface Window {
    __omh: OmhHarness;
  }
}

export {};
