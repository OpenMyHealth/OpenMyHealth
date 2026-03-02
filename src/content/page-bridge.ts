import type {
  AiProvider,
  ReadHealthRecordsResponse,
} from "../../packages/contracts/src/index";
import { ReadHealthRecordsRequestSchema } from "../../packages/contracts/src/index";
import { sendRuntimeMessage, type RuntimeOkEnvelope } from "../core/runtime-client";

export const PAGE_REQUEST_SOURCE = "openmyhealth-page";
export const PAGE_RESPONSE_SOURCE = "openmyhealth-extension";
export const PAGE_READ_REQUEST_TYPE = "openmyhealth:mcp:read-health-records";
export const PAGE_READ_RESPONSE_TYPE = "openmyhealth:mcp:read-health-records:result";
export const PAGE_READY_TYPE = "openmyhealth:mcp:ready";
const PAGE_MESSAGE_TIMEOUT_MS = 75_000;

type BridgeRuntimeResponse = RuntimeOkEnvelope & { error?: string; result?: ReadHealthRecordsResponse };

type BridgeRequestEnvelope = {
  source?: unknown;
  type?: unknown;
  requestId?: unknown;
  payload?: unknown;
};

type BridgeResponseEnvelope =
  | {
      source: typeof PAGE_RESPONSE_SOURCE;
      type: typeof PAGE_READ_RESPONSE_TYPE;
      requestId: string;
      ok: true;
      result: ReadHealthRecordsResponse;
    }
  | {
      source: typeof PAGE_RESPONSE_SOURCE;
      type: typeof PAGE_READ_RESPONSE_TYPE;
      requestId: string;
      ok: false;
      error: string;
    };

function readableError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function postBridgeMessage(port: MessagePort, payload: BridgeResponseEnvelope): void {
  port.postMessage(payload);
}

export function normalizeRequestId(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : crypto.randomUUID();
}

export function isBridgeRequestMessage(data: unknown): data is BridgeRequestEnvelope {
  if (!data || typeof data !== "object") {
    return false;
  }
  const candidate = data as BridgeRequestEnvelope;
  return candidate.source === PAGE_REQUEST_SOURCE && candidate.type === PAGE_READ_REQUEST_TYPE;
}

export function handleBridgeRequest(
  data: BridgeRequestEnvelope,
  responsePort: MessagePort,
  getProvider: () => AiProvider,
): void {
  const requestId = normalizeRequestId(data.requestId);
  const parsed = ReadHealthRecordsRequestSchema.safeParse(data.payload);
  if (!parsed.success) {
    postBridgeMessage(responsePort, {
      source: PAGE_RESPONSE_SOURCE,
      type: PAGE_READ_RESPONSE_TYPE,
      requestId,
      ok: false,
      error: "요청 형식이 올바르지 않습니다.",
    });
    return;
  }

  void sendRuntimeMessage<BridgeRuntimeResponse>({
    type: "mcp:enqueue-request",
    provider: getProvider(),
    resourceTypes: parsed.data.resource_types,
    depth: parsed.data.depth,
    query: parsed.data.query,
    dateFrom: parsed.data.date_from,
    dateTo: parsed.data.date_to,
    allowAlways: true,
    awaitResult: true,
  }, {
    timeoutMs: PAGE_MESSAGE_TIMEOUT_MS,
    timeoutMessage: "승인 대기 시간이 초과되었습니다.",
    invalidResponseMessage: "확장 프로그램 응답이 비어 있거나 형식이 맞지 않습니다.",
    transportErrorMessage: "확장 프로그램과 통신하지 못했습니다.",
  })
    .then((response) => {
      if (!response?.ok || !response.result) {
        postBridgeMessage(responsePort, {
          source: PAGE_RESPONSE_SOURCE,
          type: PAGE_READ_RESPONSE_TYPE,
          requestId,
          ok: false,
          error: response.error ?? "요청을 처리하지 못했습니다.",
        });
        return;
      }
      postBridgeMessage(responsePort, {
        source: PAGE_RESPONSE_SOURCE,
        type: PAGE_READ_RESPONSE_TYPE,
        requestId,
        ok: true,
        result: response.result,
      });
    })
    .catch((error) => {
      postBridgeMessage(responsePort, {
        source: PAGE_RESPONSE_SOURCE,
        type: PAGE_READ_RESPONSE_TYPE,
        requestId,
        ok: false,
        error: readableError(error),
      });
    });
}

export function setupPageMcpBridge(getProvider: () => AiProvider): () => void {
  const listener = (event: MessageEvent<unknown>) => {
    if (event.source !== window || event.origin !== location.origin) {
      return;
    }
    if (!isBridgeRequestMessage(event.data)) {
      return;
    }
    const responsePort = event.ports?.[0];
    if (!responsePort) {
      return;
    }
    handleBridgeRequest(event.data, responsePort, getProvider);
  };

  window.addEventListener("message", listener);
  window.postMessage({
    source: PAGE_RESPONSE_SOURCE,
    type: PAGE_READY_TYPE,
    provider: getProvider(),
    secureChannel: "message-port-required",
    timestamp: Date.now(),
  }, location.origin);
  return () => window.removeEventListener("message", listener);
}
