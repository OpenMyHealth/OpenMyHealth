// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PinSetupSection } from "./pin-setup-section";

vi.mock("./trust-anchor-section", () => ({
  TrustAnchorSection: () => <div data-testid="trust-anchor" />,
}));

function renderSetup(overrides: Partial<Parameters<typeof PinSetupSection>[0]> = {}) {
  const defaultProps = {
    locale: "ko-KR",
    pin: "",
    confirmPin: "",
    authError: null,
    isSettingPin: false,
    onLocaleChange: vi.fn(),
    onPinChange: vi.fn(),
    onConfirmPinChange: vi.fn(),
    onSubmit: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { ...render(<PinSetupSection {...defaultProps} />), props: defaultProps };
}

describe("PinSetupSection", () => {
  it("renders PIN input fields", () => {
    renderSetup();
    expect(screen.getByLabelText("PIN 6자리")).toBeInTheDocument();
    expect(screen.getByLabelText("PIN 확인")).toBeInTheDocument();
  });

  it("filters non-digit characters via onPinChange", () => {
    const { props } = renderSetup();
    const input = screen.getByLabelText("PIN 6자리");
    fireEvent.change(input, { target: { value: "12ab34" } });
    expect(props.onPinChange).toHaveBeenCalledWith("1234");
  });

  it("filters non-digit characters via onConfirmPinChange", () => {
    const { props } = renderSetup();
    const input = screen.getByLabelText("PIN 확인");
    fireEvent.change(input, { target: { value: "ab56cd" } });
    expect(props.onConfirmPinChange).toHaveBeenCalledWith("56");
  });

  it("submit button is present and not disabled by default", () => {
    renderSetup();
    const btn = screen.getByRole("button", { name: "PIN 설정 완료" });
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });

  it("calls onSubmit when form is submitted", () => {
    const { props } = renderSetup({ pin: "123456", confirmPin: "123456" });
    const btn = screen.getByRole("button", { name: "PIN 설정 완료" });
    fireEvent.click(btn);
    expect(props.onSubmit).toHaveBeenCalled();
  });

  it("shows loading state when isSettingPin=true", () => {
    renderSetup({ isSettingPin: true });
    const btn = screen.getByRole("button", { name: "PIN 설정 중..." });
    expect(btn).toBeInTheDocument();
    expect(btn).toBeDisabled();
  });

  it("disables inputs when isSettingPin=true", () => {
    renderSetup({ isSettingPin: true });
    expect(screen.getByLabelText("PIN 6자리")).toBeDisabled();
    expect(screen.getByLabelText("PIN 확인")).toBeDisabled();
  });

  it("shows auth error message when provided", () => {
    renderSetup({ authError: "PIN mismatch" });
    expect(screen.getByRole("alert")).toHaveTextContent("PIN mismatch");
  });

  it("locale selector calls onLocaleChange", () => {
    const { props } = renderSetup();
    const select = screen.getByLabelText("언어");
    fireEvent.change(select, { target: { value: "en-US" } });
    expect(props.onLocaleChange).toHaveBeenCalledWith("en-US");
  });

  it("renders trust anchor section", () => {
    renderSetup();
    expect(screen.getByTestId("trust-anchor")).toBeInTheDocument();
  });

  it("locale selector is disabled when isSettingPin=true", () => {
    renderSetup({ isSettingPin: true });
    expect(screen.getByLabelText("언어")).toBeDisabled();
  });
});
