// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UnlockSection } from "./unlock-section";

vi.mock("./trust-anchor-section", () => ({
  TrustAnchorSection: () => <div data-testid="trust-anchor" />,
}));

function renderUnlock(overrides: Partial<Parameters<typeof UnlockSection>[0]> = {}) {
  const defaultProps = {
    guide: null,
    lockoutSeconds: 0,
    lockoutStageLabel: null,
    pin: "",
    authError: null,
    isUnlocking: false,
    onPinChange: vi.fn(),
    onSubmit: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { ...render(<UnlockSection {...defaultProps} />), props: defaultProps };
}

describe("UnlockSection", () => {
  it("renders PIN input", () => {
    renderUnlock();
    expect(screen.getByLabelText("PIN 6자리")).toBeInTheDocument();
  });

  it("shows lockout countdown when lockoutSeconds > 0", () => {
    renderUnlock({ lockoutSeconds: 30, lockoutStageLabel: "1단계 잠금" });
    expect(screen.getByText("30s")).toBeInTheDocument();
    expect(screen.getByText("1단계 잠금")).toBeInTheDocument();
  });

  it("disables input and submit when locked out", () => {
    renderUnlock({ lockoutSeconds: 10 });
    expect(screen.getByLabelText("PIN 6자리")).toBeDisabled();
    expect(screen.getByRole("button", { name: "잠금 해제" })).toBeDisabled();
  });

  it("shows authError message", () => {
    renderUnlock({ authError: "Wrong PIN" });
    expect(screen.getByRole("alert")).toHaveTextContent("Wrong PIN");
  });

  it("does not show authError when it equals guide", () => {
    renderUnlock({ authError: "same message", guide: "same message" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows guide message when provided", () => {
    renderUnlock({ guide: "Enter your PIN" });
    expect(screen.getByRole("status")).toHaveTextContent("Enter your PIN");
  });

  it("submit calls onSubmit with PIN", () => {
    const { props } = renderUnlock({ pin: "123456" });
    const btn = screen.getByRole("button", { name: "잠금 해제" });
    fireEvent.click(btn);
    expect(props.onSubmit).toHaveBeenCalled();
  });

  it("shows loading state when isUnlocking=true", () => {
    renderUnlock({ isUnlocking: true });
    const btn = screen.getByRole("button", { name: "확인 중..." });
    expect(btn).toBeDisabled();
  });

  it("shows 잠금 대기 as fallback when lockoutStageLabel is null", () => {
    renderUnlock({ lockoutSeconds: 10, lockoutStageLabel: null });
    expect(screen.getByText("잠금 대기")).toBeInTheDocument();
  });

  it("filters non-digit characters from PIN input", () => {
    const { props } = renderUnlock();
    const input = screen.getByLabelText("PIN 6자리");
    fireEvent.change(input, { target: { value: "12ab34" } });
    expect(props.onPinChange).toHaveBeenCalledWith("1234");
  });
});
