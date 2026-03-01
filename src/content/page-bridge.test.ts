// @vitest-environment happy-dom
import type { AiProvider, ReadHealthRecordsResponse } from "../../packages/contracts/src/index";
import type { RuntimeOkEnvelope } from "../core/runtime-client";

vi.mock("../core/runtime-client", () => ({
  sendRuntimeMessage: vi.fn(),
}));

import { sendRuntimeMessage } from "../core/runtime-client";
import {
  PAGE_REQUEST_SOURCE,
  PAGE_RESPONSE_SOURCE,
  PAGE_READ_REQUEST_TYPE,
  PAGE_READ_RESPONSE_TYPE,
  PAGE_READY_TYPE,
  isBridgeRequestMessage,
  normalizeRequestId,
  postBridgeMessage,
  handleBridgeRequest,
  setupPageMcpBridge,
} from "./page-bridge";

const mockedSendRuntimeMessage = vi.mocked(sendRuntimeMessage);

function createMockPort(): MessagePort {
  return { postMessage: vi.fn() } as unknown as MessagePort;
}

const VALID_PAYLOAD = {
  resource_types: ["Observation" as const],
  depth: "summary" as const,
};

const VALID_REQUEST = {
  source: PAGE_REQUEST_SOURCE,
  type: PAGE_READ_REQUEST_TYPE,
  requestId: "req-1",
  payload: VALID_PAYLOAD,
};

const SUCCESS_RESULT: ReadHealthRecordsResponse = {
  schema_version: "1.0",
  status: "ok",
  depth: "summary",
  resources: [],
  count: 0,
  meta: { total_available: 0, filtered_count: 0, query_matched: false },
};

beforeEach(() => {
  mockedSendRuntimeMessage.mockReset();
});

describe("page-bridge", () => {
  describe("constants", () => {
    it("PAGE_REQUEST_SOURCE equals 'openmyhealth-page'", () => {
      expect(PAGE_REQUEST_SOURCE).toBe("openmyhealth-page");
    });

    it("PAGE_RESPONSE_SOURCE equals 'openmyhealth-extension'", () => {
      expect(PAGE_RESPONSE_SOURCE).toBe("openmyhealth-extension");
    });

    it("PAGE_READ_REQUEST_TYPE has correct value", () => {
      expect(PAGE_READ_REQUEST_TYPE).toBe("openmyhealth:mcp:read-health-records");
    });

    it("PAGE_READ_RESPONSE_TYPE has correct value", () => {
      expect(PAGE_READ_RESPONSE_TYPE).toBe("openmyhealth:mcp:read-health-records:result");
    });

    it("PAGE_READY_TYPE has correct value", () => {
      expect(PAGE_READY_TYPE).toBe("openmyhealth:mcp:ready");
    });
  });

  describe("isBridgeRequestMessage", () => {
    it("returns true for valid bridge request", () => {
      expect(isBridgeRequestMessage(VALID_REQUEST)).toBe(true);
    });

    it("returns false for null", () => {
      expect(isBridgeRequestMessage(null)).toBe(false);
    });

    it("returns false for non-object", () => {
      expect(isBridgeRequestMessage("string")).toBe(false);
    });

    it("returns false for wrong source", () => {
      expect(isBridgeRequestMessage({ ...VALID_REQUEST, source: "other" })).toBe(false);
    });

    it("returns false for wrong type", () => {
      expect(isBridgeRequestMessage({ ...VALID_REQUEST, type: "other" })).toBe(false);
    });
  });

  describe("normalizeRequestId", () => {
    it("returns the value when it is a non-empty string", () => {
      expect(normalizeRequestId("abc-123")).toBe("abc-123");
    });

    it("returns a UUID for empty string", () => {
      const result = normalizeRequestId("");
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("returns a UUID for non-string value", () => {
      const result = normalizeRequestId(42);
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("returns a UUID for undefined", () => {
      const result = normalizeRequestId(undefined);
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("postBridgeMessage", () => {
    it("posts message on the port", () => {
      const port = createMockPort();
      const payload = {
        source: PAGE_RESPONSE_SOURCE as typeof PAGE_RESPONSE_SOURCE,
        type: PAGE_READ_RESPONSE_TYPE as typeof PAGE_READ_RESPONSE_TYPE,
        requestId: "req-1",
        ok: true as const,
        result: SUCCESS_RESULT,
      };
      postBridgeMessage(port, payload);
      expect(port.postMessage).toHaveBeenCalledWith(payload);
    });
  });

  describe("handleBridgeRequest", () => {
    it("sends success response on valid request", async () => {
      const port = createMockPort();
      const getProvider = () => "chatgpt" as AiProvider;
      const runtimeResponse: RuntimeOkEnvelope & { result: ReadHealthRecordsResponse } = {
        ok: true,
        result: SUCCESS_RESULT,
      };
      mockedSendRuntimeMessage.mockResolvedValue(runtimeResponse);

      handleBridgeRequest(VALID_REQUEST, port, getProvider);
      await vi.waitFor(() => {
        expect(port.postMessage).toHaveBeenCalled();
      });

      expect(mockedSendRuntimeMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "mcp:enqueue-request",
          provider: "chatgpt",
          resourceTypes: ["Observation"],
          depth: "summary",
        }),
        expect.any(Object),
      );
      expect(port.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          source: PAGE_RESPONSE_SOURCE,
          type: PAGE_READ_RESPONSE_TYPE,
          requestId: "req-1",
          ok: true,
          result: SUCCESS_RESULT,
        }),
      );
    });

    it("sends error response for invalid schema", () => {
      const port = createMockPort();
      const getProvider = () => "chatgpt" as AiProvider;
      const invalidRequest = { ...VALID_REQUEST, payload: {} };

      handleBridgeRequest(invalidRequest, port, getProvider);

      expect(port.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: false,
          error: expect.any(String),
        }),
      );
      expect(mockedSendRuntimeMessage).not.toHaveBeenCalled();
    });

    it("sends error response when sendRuntimeMessage rejects", async () => {
      const port = createMockPort();
      const getProvider = () => "chatgpt" as AiProvider;
      mockedSendRuntimeMessage.mockRejectedValue(new Error("network fail"));

      handleBridgeRequest(VALID_REQUEST, port, getProvider);
      await vi.waitFor(() => {
        expect(port.postMessage).toHaveBeenCalled();
      });

      expect(port.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: false,
          error: "network fail",
        }),
      );
    });

    it("sends error response when runtime returns not-ok", async () => {
      const port = createMockPort();
      const getProvider = () => "chatgpt" as AiProvider;
      mockedSendRuntimeMessage.mockResolvedValue({ ok: false, error: "denied" });

      handleBridgeRequest(VALID_REQUEST, port, getProvider);
      await vi.waitFor(() => {
        expect(port.postMessage).toHaveBeenCalled();
      });

      expect(port.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: false,
          error: "denied",
        }),
      );
    });

    it("normalizes missing requestId", async () => {
      const port = createMockPort();
      const getProvider = () => "chatgpt" as AiProvider;
      mockedSendRuntimeMessage.mockResolvedValue({ ok: true, result: SUCCESS_RESULT });

      handleBridgeRequest({ ...VALID_REQUEST, requestId: undefined }, port, getProvider);
      await vi.waitFor(() => {
        expect(port.postMessage).toHaveBeenCalled();
      });

      const call = (port.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(typeof call.requestId).toBe("string");
      expect(call.requestId.length).toBeGreaterThan(0);
    });
  });

  describe("handleBridgeRequest edge cases", () => {
    it("sends error with readableError for non-Error rejection", async () => {
      const port = createMockPort();
      const getProvider = () => "chatgpt" as AiProvider;
      mockedSendRuntimeMessage.mockRejectedValue("string error");

      handleBridgeRequest(VALID_REQUEST, port, getProvider);
      await vi.waitFor(() => {
        expect(port.postMessage).toHaveBeenCalled();
      });

      expect(port.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: false,
          error: "string error",
        }),
      );
    });

    it("uses fallback error when response not ok and no error field", async () => {
      const port = createMockPort();
      const getProvider = () => "chatgpt" as AiProvider;
      mockedSendRuntimeMessage.mockResolvedValue({ ok: false });

      handleBridgeRequest(VALID_REQUEST, port, getProvider);
      await vi.waitFor(() => {
        expect(port.postMessage).toHaveBeenCalled();
      });

      expect(port.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: false,
          error: expect.any(String),
        }),
      );
    });
  });

  describe("setupPageMcpBridge", () => {
    it("posts ready message on setup", () => {
      const postMessageSpy = vi.spyOn(window, "postMessage").mockImplementation(() => {});
      const getProvider = () => "claude" as AiProvider;

      const teardown = setupPageMcpBridge(getProvider);

      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          source: PAGE_RESPONSE_SOURCE,
          type: PAGE_READY_TYPE,
          provider: "claude",
        }),
        expect.any(String),
      );

      teardown();
      postMessageSpy.mockRestore();
    });

    it("returns a teardown function that removes listener", () => {
      const addSpy = vi.spyOn(window, "addEventListener");
      const removeSpy = vi.spyOn(window, "removeEventListener");
      vi.spyOn(window, "postMessage").mockImplementation(() => {});
      const getProvider = () => "chatgpt" as AiProvider;

      const teardown = setupPageMcpBridge(getProvider);
      expect(addSpy).toHaveBeenCalledWith("message", expect.any(Function));

      teardown();
      expect(removeSpy).toHaveBeenCalledWith("message", expect.any(Function));

      addSpy.mockRestore();
      removeSpy.mockRestore();
    });

    it("listener ignores messages from different source", () => {
      let listener: ((event: MessageEvent) => void) | null = null;
      vi.spyOn(window, "addEventListener").mockImplementation((type: string, fn: EventListenerOrEventListenerObject) => {
        if (type === "message") {
          listener = fn as (event: MessageEvent) => void;
        }
      });
      vi.spyOn(window, "removeEventListener").mockImplementation(() => {});
      vi.spyOn(window, "postMessage").mockImplementation(() => {});

      const getProvider = () => "chatgpt" as AiProvider;
      const teardown = setupPageMcpBridge(getProvider);

      // Simulate message from different window source
      listener?.({
        source: null,
        origin: location.origin,
        data: VALID_REQUEST,
        ports: [],
      } as unknown as MessageEvent);

      // Should not call sendRuntimeMessage since source !== window
      expect(mockedSendRuntimeMessage).not.toHaveBeenCalled();

      teardown();
    });

    it("listener ignores non-bridge messages", () => {
      let listener: ((event: MessageEvent) => void) | null = null;
      vi.spyOn(window, "addEventListener").mockImplementation((type: string, fn: EventListenerOrEventListenerObject) => {
        if (type === "message") {
          listener = fn as (event: MessageEvent) => void;
        }
      });
      vi.spyOn(window, "removeEventListener").mockImplementation(() => {});
      vi.spyOn(window, "postMessage").mockImplementation(() => {});

      const getProvider = () => "chatgpt" as AiProvider;
      const teardown = setupPageMcpBridge(getProvider);

      listener?.({
        source: window,
        origin: location.origin,
        data: { source: "other", type: "other" },
        ports: [],
      } as unknown as MessageEvent);

      expect(mockedSendRuntimeMessage).not.toHaveBeenCalled();

      teardown();
    });

    it("listener ignores messages without response port", () => {
      let listener: ((event: MessageEvent) => void) | null = null;
      vi.spyOn(window, "addEventListener").mockImplementation((type: string, fn: EventListenerOrEventListenerObject) => {
        if (type === "message") {
          listener = fn as (event: MessageEvent) => void;
        }
      });
      vi.spyOn(window, "removeEventListener").mockImplementation(() => {});
      vi.spyOn(window, "postMessage").mockImplementation(() => {});

      const getProvider = () => "chatgpt" as AiProvider;
      const teardown = setupPageMcpBridge(getProvider);

      listener?.({
        source: window,
        origin: location.origin,
        data: VALID_REQUEST,
        ports: [],
      } as unknown as MessageEvent);

      expect(mockedSendRuntimeMessage).not.toHaveBeenCalled();

      teardown();
    });

    it("listener dispatches valid bridge request to handleBridgeRequest", async () => {
      let listener: ((event: MessageEvent) => void) | null = null;
      vi.spyOn(window, "addEventListener").mockImplementation((type: string, fn: EventListenerOrEventListenerObject) => {
        if (type === "message") {
          listener = fn as (event: MessageEvent) => void;
        }
      });
      vi.spyOn(window, "removeEventListener").mockImplementation(() => {});
      vi.spyOn(window, "postMessage").mockImplementation(() => {});

      const port = createMockPort();
      mockedSendRuntimeMessage.mockResolvedValue({ ok: true, result: SUCCESS_RESULT });

      const getProvider = () => "chatgpt" as AiProvider;
      const teardown = setupPageMcpBridge(getProvider);

      listener?.({
        source: window,
        origin: location.origin,
        data: VALID_REQUEST,
        ports: [port],
      } as unknown as MessageEvent);

      await vi.waitFor(() => {
        expect(port.postMessage).toHaveBeenCalled();
      });

      expect(port.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: true,
          result: SUCCESS_RESULT,
        }),
      );

      teardown();
    });
  });
});
