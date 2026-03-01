// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProviderSection } from "./provider-section";

vi.mock("../../../src/core/utils", () => ({
  providerLabel: (p: string) => ({ chatgpt: "ChatGPT", claude: "Claude", gemini: "Gemini" })[p],
}));

function renderProvider(overrides: Partial<Parameters<typeof ProviderSection>[0]> = {}) {
  const ref = React.createRef<HTMLElement>();
  const defaultProps = {
    aiConnectionRef: ref,
    hasFiles: false,
    connectedProvider: null,
    settingProvider: null,
    setProvider: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { ...render(<ProviderSection {...defaultProps} />), props: defaultProps };
}

describe("ProviderSection", () => {
  it("renders 3 provider options", () => {
    renderProvider();
    expect(screen.getByText("ChatGPT")).toBeInTheDocument();
    expect(screen.getByText("Claude")).toBeInTheDocument();
    expect(screen.getByText("Gemini")).toBeInTheDocument();
  });

  it("Gemini radio is disabled", () => {
    renderProvider();
    const geminiRadio = screen.getByRole("radio", { name: /Gemini/i });
    expect(geminiRadio).toBeDisabled();
  });

  it("selection change calls setProvider", () => {
    const { props } = renderProvider();
    const chatgptRadio = screen.getByRole("radio", { name: /ChatGPT/i });
    fireEvent.click(chatgptRadio);
    expect(props.setProvider).toHaveBeenCalledWith("chatgpt");
  });

  it("shows connected indicator for selected provider", () => {
    renderProvider({ connectedProvider: "claude" });
    expect(screen.getByText("선택됨")).toBeInTheDocument();
  });

  it("chatgpt and claude radios are enabled", () => {
    renderProvider();
    expect(screen.getByRole("radio", { name: /ChatGPT/i })).not.toBeDisabled();
    expect(screen.getByRole("radio", { name: /Claude/i })).not.toBeDisabled();
  });

  it("shows connection ready panel when provider selected", () => {
    renderProvider({ connectedProvider: "chatgpt" });
    expect(screen.getByText(/연결 준비 완료/)).toBeInTheDocument();
  });

  it("shows pending text when settingProvider matches", () => {
    renderProvider({ settingProvider: "claude" });
    expect(screen.getByText("적용 중...")).toBeInTheDocument();
  });
});
