// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { render, screen, act } from "@testing-library/react";
import { ErrorBoundary } from "./error-boundary";

function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("test render error");
  }
  return <div>child content</div>;
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("renders children normally when no error", () => {
    render(
      <ErrorBoundary fallback={(err) => <div>fallback: {err.message}</div>}>
        <div>safe child</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("safe child")).toBeInTheDocument();
  });

  it("shows fallback UI when child throws", () => {
    render(
      <ErrorBoundary fallback={(err) => <div>fallback: {err.message}</div>}>
        <ThrowingChild shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByText("fallback: test render error")).toBeInTheDocument();
  });

  it("fallback receives error object with message", () => {
    const fallbackSpy = vi.fn((err: Error) => <div>{err.message}</div>);
    render(
      <ErrorBoundary fallback={fallbackSpy}>
        <ThrowingChild shouldThrow />
      </ErrorBoundary>,
    );
    expect(fallbackSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: "test render error" }),
      expect.any(Function),
    );
  });

  it("reset callback re-renders children (error clears)", () => {
    let shouldThrow = true;
    function ConditionalChild() {
      if (shouldThrow) {
        throw new Error("boom");
      }
      return <div>recovered</div>;
    }

    let resetFn: (() => void) | undefined;
    render(
      <ErrorBoundary
        fallback={(err, reset) => {
          resetFn = reset;
          return <div>fallback: {err.message}</div>;
        }}
      >
        <ConditionalChild />
      </ErrorBoundary>,
    );
    expect(screen.getByText("fallback: boom")).toBeInTheDocument();

    shouldThrow = false;
    act(() => { resetFn!(); });
    expect(screen.getByText("recovered")).toBeInTheDocument();
  });

  it("console.error is called via componentDidCatch", () => {
    const consoleSpy = vi.spyOn(console, "error");
    render(
      <ErrorBoundary fallback={(err) => <div>{err.message}</div>}>
        <ThrowingChild shouldThrow />
      </ErrorBoundary>,
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      "[ui] uncaught render error:",
      expect.any(Error),
    );
  });

  it("multiple errors after reset still show fallback", () => {
    function AlwaysThrowChild() {
      throw new Error("persistent error");
    }

    let resetFn: (() => void) | undefined;
    render(
      <ErrorBoundary
        fallback={(err, reset) => {
          resetFn = reset;
          return <div>fallback: {err.message}</div>;
        }}
      >
        <AlwaysThrowChild />
      </ErrorBoundary>,
    );
    expect(screen.getByText("fallback: persistent error")).toBeInTheDocument();

    act(() => { resetFn!(); });
    expect(screen.getByText("fallback: persistent error")).toBeInTheDocument();
  });
});
