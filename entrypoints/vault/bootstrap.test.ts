// @vitest-environment happy-dom

describe("vault/bootstrap", () => {
  let setTimeoutSpy: ReturnType<typeof vi.spyOn>;
  let clearTimeoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Create a fresh #root element for each test
    document.body.innerHTML = '<div id="root"></div>';

    // Reset the boot-state so the module can be re-evaluated cleanly
    delete (window as Record<string, unknown>).__OMH_VAULT_BOOT_STATE__;

    setTimeoutSpy = vi.spyOn(window, "setTimeout");
    clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("sets a 20-second boot timeout", async () => {
    // Mock the dynamic import so it never resolves (we just want to check the timeout)
    vi.doMock("./main", () => new Promise(() => {}));

    await import("./bootstrap");

    const timeoutCall = setTimeoutSpy.mock.calls.find(
      ([, delay]) => delay === 20_000,
    );
    expect(timeoutCall).toBeDefined();
  });

  it("renders error UI when the timeout fires", async () => {
    vi.useFakeTimers();

    // Mock the dynamic import so it never resolves
    vi.doMock("./main", () => new Promise(() => {}));

    await import("./bootstrap");

    vi.advanceTimersByTime(20_000);

    const root = document.getElementById("root")!;
    expect(root.querySelector('[role="alert"]')).not.toBeNull();
    expect(root.innerHTML).toContain("보관함을 시작하지 못했습니다");
    expect(root.querySelector("#vault-retry-btn")).not.toBeNull();

    vi.useRealTimers();
  });

  it("clears timeout and sets appMounted on successful import", async () => {
    // Mock the dynamic import to resolve immediately
    vi.doMock("./main", () => Promise.resolve({ default: {} }));

    await import("./bootstrap");

    // Wait for the microtask (dynamic import .then) to flush
    await vi.waitFor(() => {
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    expect(window.__OMH_VAULT_BOOT_STATE__?.appMounted).toBe(true);
  });

  it("clears timeout and shows error UI on import failure", async () => {
    vi.doMock("./main", () => Promise.reject(new Error("chunk fail")));

    await import("./bootstrap");

    // Wait for the microtask (.catch) to flush
    await vi.waitFor(() => {
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    const root = document.getElementById("root")!;
    expect(root.querySelector('[role="alert"]')).not.toBeNull();
    expect(root.innerHTML).toContain("업데이트가 완전히 적용되지 않았어요");
  });

  it("sets scriptLoaded on the boot state", async () => {
    vi.doMock("./main", () => new Promise(() => {}));

    await import("./bootstrap");

    expect(window.__OMH_VAULT_BOOT_STATE__?.scriptLoaded).toBe(true);
  });

  it("retry button reloads the page", async () => {
    vi.useFakeTimers();

    vi.doMock("./main", () => new Promise(() => {}));

    // Mock location.reload
    const reloadMock = vi.fn();
    Object.defineProperty(window, "location", {
      value: { reload: reloadMock },
      writable: true,
      configurable: true,
    });

    await import("./bootstrap");

    vi.advanceTimersByTime(20_000);

    const retryBtn = document.getElementById("vault-retry-btn")!;
    retryBtn.click();

    expect(reloadMock).toHaveBeenCalled();

    vi.useRealTimers();
  });
});
