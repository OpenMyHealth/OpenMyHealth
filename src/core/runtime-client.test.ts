import { sendRuntimeMessage, withTimeout } from "./runtime-client";
import type { RuntimeOkEnvelope, RuntimeSendOptions } from "./runtime-client";

const defaultOptions: RuntimeSendOptions = {
  timeoutMs: 1000,
  timeoutMessage: "Request timed out",
  invalidResponseMessage: "Invalid response",
  transportErrorMessage: "Transport error",
};

describe("withTimeout", () => {
  it("resolves before timeout and returns value", async () => {
    const promise = Promise.resolve("hello");
    const result = await withTimeout(promise, 1000, "timeout");
    expect(result).toBe("hello");
  });

  it("rejects with timeout message when exceeding timeout", async () => {
    const neverResolve = new Promise<string>(() => {});
    await expect(withTimeout(neverResolve, 10, "Custom timeout")).rejects.toThrow("Custom timeout");
  });

  it("clears timer on success (no leaks)", async () => {
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const promise = Promise.resolve(42);
    await withTimeout(promise, 5000, "timeout");
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it("clears timer on rejection (no leaks)", async () => {
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const promise = Promise.reject(new Error("fail"));
    await expect(withTimeout(promise, 5000, "timeout")).rejects.toThrow("fail");
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});

describe("sendRuntimeMessage", () => {
  it("returns valid response with ok envelope", async () => {
    vi.spyOn(browser.runtime, "sendMessage").mockResolvedValue({ ok: true, data: "result" });
    const result = await sendRuntimeMessage<RuntimeOkEnvelope & { data: string }>(
      { type: "test" },
      defaultOptions,
    );
    expect(result).toEqual({ ok: true, data: "result" });
  });

  it("throws invalidResponseMessage for non-ok-envelope response", async () => {
    vi.spyOn(browser.runtime, "sendMessage").mockResolvedValue({ foo: "bar" });
    await expect(sendRuntimeMessage({ type: "test" }, defaultOptions))
      .rejects.toThrow("Invalid response");
  });

  it("throws transportErrorMessage when runtime.sendMessage throws", async () => {
    vi.spyOn(browser.runtime, "sendMessage").mockRejectedValue(new Error("Connection closed"));
    await expect(sendRuntimeMessage({ type: "test" }, defaultOptions))
      .rejects.toThrow("Transport error (Connection closed)");
  });

  it("throws timeoutMessage on timeout", async () => {
    vi.spyOn(browser.runtime, "sendMessage").mockImplementation(
      () => new Promise(() => {}),
    );
    const opts: RuntimeSendOptions = {
      ...defaultOptions,
      timeoutMs: 10,
      timeoutMessage: "Timed out waiting",
    };
    await expect(sendRuntimeMessage({ type: "test" }, opts))
      .rejects.toThrow("Timed out waiting");
  });

  it("throws invalidResponseMessage for null response", async () => {
    vi.spyOn(browser.runtime, "sendMessage").mockResolvedValue(null);
    await expect(sendRuntimeMessage({ type: "test" }, defaultOptions))
      .rejects.toThrow("Invalid response");
  });

  it("returns typed envelope with extra fields", async () => {
    vi.spyOn(browser.runtime, "sendMessage").mockResolvedValue({ ok: true, data: "x" });

    type Extended = RuntimeOkEnvelope & { data: string };
    const result = await sendRuntimeMessage<Extended>({ type: "ping" }, defaultOptions);
    expect(result.ok).toBe(true);
    expect(result.data).toBe("x");
  });

  it("stringifies non-Error thrown value in transport error", async () => {
    vi.spyOn(browser.runtime, "sendMessage").mockRejectedValue("raw string error");
    await expect(sendRuntimeMessage({ type: "test" }, defaultOptions))
      .rejects.toThrow("Transport error (raw string error)");
  });
});
