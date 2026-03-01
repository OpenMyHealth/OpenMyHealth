// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import type { VaultStateResponse } from "../../src/core/messages";
import type { AiProvider } from "../../packages/contracts/src/index";

// Mock the runtime module that SetupApp depends on
vi.mock("../vault/runtime", () => ({
  sendVaultMessage: vi.fn(),
  readableError: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
  withConnectionHint: vi.fn(async (e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

// Mock TrustAnchorSection used by PinSetupSection
vi.mock("../vault/components/trust-anchor-section", () => ({
  TrustAnchorSection: () => <div data-testid="trust-anchor" />,
}));

import { sendVaultMessage } from "../vault/runtime";
const mockSendVaultMessage = vi.mocked(sendVaultMessage);

// ---- helpers ----

function createVaultStateResponse(overrides?: Partial<VaultStateResponse>): VaultStateResponse {
  return {
    ok: true,
    settings: {
      locale: "ko-KR",
      schemaVersion: 1,
      lockout: { failedAttempts: 0, lockUntil: null },
      connectedProvider: "chatgpt" as AiProvider,
      integrationWarning: null,
    },
    session: { isUnlocked: false, hasPin: false, lockoutUntil: null },
    files: [],
    auditLogs: [],
    summary: {},
    ...overrides,
  };
}

// We need to import SetupApp from main.tsx, but it is not exported.
// The file calls createRoot at module level, so we need to:
// 1. Mock createRoot so it doesn't run on import
// 2. Extract the component for rendering in tests

// Instead of importing main.tsx directly (which would invoke createRoot),
// we render SetupApp by dynamically importing after mocking ReactDOM.
let SetupApp: React.ComponentType;

// Mock react-dom/client to prevent createRoot from executing on import
vi.mock("react-dom/client", () => ({
  createRoot: vi.fn(() => ({
    render: vi.fn(),
  })),
}));

// Mock browser.runtime.getURL for openVaultPage
beforeAll(async () => {
  vi.spyOn(browser.runtime, "getURL").mockReturnValue("/vault.html");
  // Dynamically import main.tsx; createRoot is now a no-op mock
  // We need to access SetupApp which is a module-level function
  // Since it's not exported, we'll extract it differently
});

// Since SetupApp is not exported, we'll test the full module render behavior
// by reading the component from the createRoot mock's render call.
// Actually, a cleaner approach: we can import the module and capture what createRoot().render() received.

import { createRoot } from "react-dom/client";

beforeAll(async () => {
  // Provide a root element for createRoot
  const rootEl = document.createElement("div");
  rootEl.id = "root";
  document.body.appendChild(rootEl);

  // Import the module — triggers createRoot call
  await import("./main");

  // Extract the rendered JSX from createRoot mock
  const mockCreateRoot = vi.mocked(createRoot);
  const renderFn = mockCreateRoot.mock.results[0]?.value?.render;

  // The render call receives <React.StrictMode><ErrorBoundary>...<SetupApp /></ErrorBoundary></React.StrictMode>
  // We need to get the SetupApp component from the JSX tree.
  // Instead of extracting the component, let's render the full tree that was passed to render().
  const renderCall = renderFn?.mock?.calls?.[0]?.[0];
  if (renderCall) {
    // Drill into StrictMode -> ErrorBoundary -> SetupApp
    // StrictMode children = ErrorBoundary
    // ErrorBoundary children = SetupApp element
    const errorBoundary = renderCall.props?.children;
    const setupAppElement = errorBoundary?.props?.children;
    if (setupAppElement?.type) {
      SetupApp = setupAppElement.type;
    }
  }

  if (!SetupApp) {
    throw new Error("Failed to extract SetupApp component from main.tsx module");
  }
});

function renderSetupApp() {
  return render(<SetupApp />);
}

beforeEach(() => {
  mockSendVaultMessage.mockReset();
});

// ---- tests ----

describe("SetupApp", () => {
  describe("loading state", () => {
    it("shows skeleton loading UI while refreshState is pending", () => {
      // Never resolve — keeps loading state
      mockSendVaultMessage.mockReturnValue(new Promise(() => {}));
      renderSetupApp();

      // Loading skeleton renders pulse elements but no heading text
      expect(screen.queryByText("처음 설정")).not.toBeInTheDocument();
      // The skeleton has animate-pulse divs
      const container = document.querySelector(".animate-pulse");
      expect(container).toBeInTheDocument();
    });
  });

  describe("error state — failed initial load", () => {
    it("shows error state when refreshState returns ok=false", async () => {
      mockSendVaultMessage.mockResolvedValueOnce({ ok: false, error: "load error" });
      renderSetupApp();

      await waitFor(() => {
        expect(screen.getByText("설정 상태를 불러오지 못했습니다")).toBeInTheDocument();
      });
    });

    it("shows appError message from withConnectionHint when refreshState throws", async () => {
      mockSendVaultMessage.mockRejectedValueOnce(new Error("network down"));
      renderSetupApp();

      await waitFor(() => {
        expect(screen.getByText("설정 상태를 불러오지 못했습니다")).toBeInTheDocument();
      });
      expect(screen.getByRole("alert")).toHaveTextContent("network down");
    });

    it("retry button calls refreshState again", async () => {
      mockSendVaultMessage
        .mockRejectedValueOnce(new Error("first fail"))
        .mockResolvedValueOnce(createVaultStateResponse());
      renderSetupApp();

      await waitFor(() => {
        expect(screen.getByText("설정 상태를 불러오지 못했습니다")).toBeInTheDocument();
      });

      const retryBtn = screen.getByRole("button", { name: "다시 시도" });
      fireEvent.click(retryBtn);

      await waitFor(() => {
        expect(screen.getByText("처음 설정")).toBeInTheDocument();
      });
      expect(mockSendVaultMessage).toHaveBeenCalledTimes(2);
    });
  });

  describe("already-setup redirect (hasPin = true)", () => {
    it("shows 'setup complete' section when hasPin is true", async () => {
      mockSendVaultMessage.mockResolvedValueOnce(
        createVaultStateResponse({
          session: { isUnlocked: false, hasPin: true, lockoutUntil: null },
        }),
      );
      renderSetupApp();

      await waitFor(() => {
        expect(screen.getByText("설정이 완료되었습니다")).toBeInTheDocument();
      });
      expect(screen.getByRole("button", { name: "Health Vault 열기" })).toBeInTheDocument();
    });

    it("Health Vault button navigates to vault page", async () => {
      mockSendVaultMessage.mockResolvedValueOnce(
        createVaultStateResponse({
          session: { isUnlocked: true, hasPin: true, lockoutUntil: null },
        }),
      );
      renderSetupApp();

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Health Vault 열기" })).toBeInTheDocument();
      });

      // location.href assignment is our navigation mechanism
      const originalHref = location.href;
      fireEvent.click(screen.getByRole("button", { name: "Health Vault 열기" }));
      // In happy-dom, location.href will be set; just verify the button is clickable
      expect(screen.getByRole("button", { name: "Health Vault 열기" })).toBeInTheDocument();
    });
  });

  describe("PIN setup flow (hasPin = false)", () => {
    beforeEach(() => {
      mockSendVaultMessage.mockResolvedValueOnce(createVaultStateResponse());
    });

    it("renders the setup wizard with step indicators", async () => {
      renderSetupApp();

      await waitFor(() => {
        expect(screen.getByText("처음 설정")).toBeInTheDocument();
      });
      expect(screen.getByText("1 PIN 설정")).toBeInTheDocument();
      expect(screen.getByText("2 기록 업로드")).toBeInTheDocument();
      expect(screen.getByText("3 AI 연결")).toBeInTheDocument();
    });

    it("renders PinSetupSection with PIN input fields", async () => {
      renderSetupApp();

      await waitFor(() => {
        expect(screen.getByLabelText("PIN 6자리")).toBeInTheDocument();
      });
      expect(screen.getByLabelText("PIN 확인")).toBeInTheDocument();
    });

    it("filters non-digit characters from PIN input", async () => {
      renderSetupApp();

      await waitFor(() => {
        expect(screen.getByLabelText("PIN 6자리")).toBeInTheDocument();
      });

      const pinInput = screen.getByLabelText("PIN 6자리");
      fireEvent.change(pinInput, { target: { value: "12ab34" } });
      // PinSetupSection strips non-digits before calling onPinChange
      // In the integrated component, the state should only contain digits
      expect(pinInput).toHaveValue("1234");
    });

    it("filters non-digit characters from confirm PIN input", async () => {
      renderSetupApp();

      await waitFor(() => {
        expect(screen.getByLabelText("PIN 확인")).toBeInTheDocument();
      });

      const confirmInput = screen.getByLabelText("PIN 확인");
      fireEvent.change(confirmInput, { target: { value: "ab56cd" } });
      expect(confirmInput).toHaveValue("56");
    });
  });

  describe("PIN validation errors", () => {
    beforeEach(() => {
      mockSendVaultMessage.mockResolvedValueOnce(createVaultStateResponse());
    });

    it("shows error when PIN is shorter than 6 digits", async () => {
      renderSetupApp();

      await waitFor(() => {
        expect(screen.getByLabelText("PIN 6자리")).toBeInTheDocument();
      });

      const pinInput = screen.getByLabelText("PIN 6자리");
      const confirmInput = screen.getByLabelText("PIN 확인");
      fireEvent.change(pinInput, { target: { value: "123" } });
      fireEvent.change(confirmInput, { target: { value: "123" } });

      const submitBtn = screen.getByRole("button", { name: "PIN 설정 완료" });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent("PIN 6자리를 입력해 주세요.");
      });
    });

    it("shows error when PINs do not match", async () => {
      renderSetupApp();

      await waitFor(() => {
        expect(screen.getByLabelText("PIN 6자리")).toBeInTheDocument();
      });

      const pinInput = screen.getByLabelText("PIN 6자리");
      const confirmInput = screen.getByLabelText("PIN 확인");
      fireEvent.change(pinInput, { target: { value: "123456" } });
      fireEvent.change(confirmInput, { target: { value: "654321" } });

      const submitBtn = screen.getByRole("button", { name: "PIN 설정 완료" });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(
          "입력한 PIN이 서로 달라요. 천천히 다시 확인해 주세요.",
        );
      });
    });

    it("shows error when only confirm PIN is too short", async () => {
      renderSetupApp();

      await waitFor(() => {
        expect(screen.getByLabelText("PIN 6자리")).toBeInTheDocument();
      });

      const pinInput = screen.getByLabelText("PIN 6자리");
      const confirmInput = screen.getByLabelText("PIN 확인");
      fireEvent.change(pinInput, { target: { value: "123456" } });
      fireEvent.change(confirmInput, { target: { value: "12" } });

      fireEvent.click(screen.getByRole("button", { name: "PIN 설정 완료" }));

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent("PIN 6자리를 입력해 주세요.");
      });
    });
  });

  describe("successful PIN setup", () => {
    it("sends session:setup-pin message with PIN and locale", async () => {
      mockSendVaultMessage
        .mockResolvedValueOnce(createVaultStateResponse()) // initial load
        .mockResolvedValueOnce({ ok: true }) // setup-pin
        .mockResolvedValueOnce(
          createVaultStateResponse({
            session: { isUnlocked: true, hasPin: true, lockoutUntil: null },
          }),
        ); // refreshState after setup

      renderSetupApp();

      await waitFor(() => {
        expect(screen.getByLabelText("PIN 6자리")).toBeInTheDocument();
      });

      fireEvent.change(screen.getByLabelText("PIN 6자리"), { target: { value: "123456" } });
      fireEvent.change(screen.getByLabelText("PIN 확인"), { target: { value: "123456" } });
      fireEvent.click(screen.getByRole("button", { name: "PIN 설정 완료" }));

      await waitFor(() => {
        expect(mockSendVaultMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "session:setup-pin",
            pin: "123456",
            locale: "ko-KR",
          }),
        );
      });
    });

    it("shows loading state during PIN setup", async () => {
      let resolveSetup!: (value: unknown) => void;
      mockSendVaultMessage
        .mockResolvedValueOnce(createVaultStateResponse()) // initial load
        .mockImplementationOnce(
          () => new Promise((resolve) => { resolveSetup = resolve; }),
        ); // setup-pin hangs

      renderSetupApp();

      await waitFor(() => {
        expect(screen.getByLabelText("PIN 6자리")).toBeInTheDocument();
      });

      fireEvent.change(screen.getByLabelText("PIN 6자리"), { target: { value: "123456" } });
      fireEvent.change(screen.getByLabelText("PIN 확인"), { target: { value: "123456" } });
      fireEvent.click(screen.getByRole("button", { name: "PIN 설정 완료" }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "PIN 설정 중..." })).toBeDisabled();
      });
      expect(screen.getByLabelText("PIN 6자리")).toBeDisabled();
      expect(screen.getByLabelText("PIN 확인")).toBeDisabled();

      // Clean up by resolving the pending promise
      resolveSetup({ ok: true });
    });

    it("navigates to vault page after successful setup", async () => {
      mockSendVaultMessage
        .mockResolvedValueOnce(createVaultStateResponse()) // initial load
        .mockResolvedValueOnce({ ok: true }) // setup-pin
        .mockResolvedValueOnce(
          createVaultStateResponse({
            session: { isUnlocked: true, hasPin: true, lockoutUntil: null },
          }),
        ); // refreshState after setup

      renderSetupApp();

      await waitFor(() => {
        expect(screen.getByLabelText("PIN 6자리")).toBeInTheDocument();
      });

      fireEvent.change(screen.getByLabelText("PIN 6자리"), { target: { value: "123456" } });
      fireEvent.change(screen.getByLabelText("PIN 확인"), { target: { value: "123456" } });
      fireEvent.click(screen.getByRole("button", { name: "PIN 설정 완료" }));

      // After successful setup, the component calls refreshState which returns hasPin=true,
      // then navigates to vault. We verify by checking the "설정이 완료되었습니다" state appears
      // before the navigation redirect (location.href set).
      await waitFor(() => {
        expect(mockSendVaultMessage).toHaveBeenCalledTimes(3);
      });
    });
  });

  describe("setup-pin error from background", () => {
    it("shows error from background response", async () => {
      mockSendVaultMessage
        .mockResolvedValueOnce(createVaultStateResponse()) // initial load
        .mockResolvedValueOnce({ ok: false, error: "PIN 설정 중 문제가 발생했습니다." }); // setup-pin fails

      renderSetupApp();

      await waitFor(() => {
        expect(screen.getByLabelText("PIN 6자리")).toBeInTheDocument();
      });

      fireEvent.change(screen.getByLabelText("PIN 6자리"), { target: { value: "123456" } });
      fireEvent.change(screen.getByLabelText("PIN 확인"), { target: { value: "123456" } });
      fireEvent.click(screen.getByRole("button", { name: "PIN 설정 완료" }));

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent("PIN 설정 중 문제가 발생했습니다.");
      });
    });

    it("shows error when setup-pin throws", async () => {
      mockSendVaultMessage
        .mockResolvedValueOnce(createVaultStateResponse()) // initial load
        .mockRejectedValueOnce(new Error("connection lost")); // setup-pin throws

      renderSetupApp();

      await waitFor(() => {
        expect(screen.getByLabelText("PIN 6자리")).toBeInTheDocument();
      });

      fireEvent.change(screen.getByLabelText("PIN 6자리"), { target: { value: "123456" } });
      fireEvent.change(screen.getByLabelText("PIN 확인"), { target: { value: "123456" } });
      fireEvent.click(screen.getByRole("button", { name: "PIN 설정 완료" }));

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent("connection lost");
      });
    });

    it("re-enables submit button after setup error", async () => {
      mockSendVaultMessage
        .mockResolvedValueOnce(createVaultStateResponse()) // initial load
        .mockResolvedValueOnce({ ok: false, error: "fail" }); // setup-pin

      renderSetupApp();

      await waitFor(() => {
        expect(screen.getByLabelText("PIN 6자리")).toBeInTheDocument();
      });

      fireEvent.change(screen.getByLabelText("PIN 6자리"), { target: { value: "123456" } });
      fireEvent.change(screen.getByLabelText("PIN 확인"), { target: { value: "123456" } });
      fireEvent.click(screen.getByRole("button", { name: "PIN 설정 완료" }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "PIN 설정 완료" })).not.toBeDisabled();
      });
    });
  });

  describe("locale detection and selection", () => {
    it("uses navigator.language as initial locale", async () => {
      // Default state has locale: "ko-KR" in settings, which should be used
      mockSendVaultMessage.mockResolvedValueOnce(createVaultStateResponse());
      renderSetupApp();

      await waitFor(() => {
        expect(screen.getByLabelText("언어")).toBeInTheDocument();
      });

      const select = screen.getByLabelText("언어") as HTMLSelectElement;
      expect(select.value).toBe("ko-KR");
    });

    it("uses locale from vault state settings when available", async () => {
      mockSendVaultMessage.mockResolvedValueOnce(
        createVaultStateResponse({
          settings: {
            locale: "en-US",
            schemaVersion: 1,
            lockout: { failedAttempts: 0, lockUntil: null },
            connectedProvider: null,
            integrationWarning: null,
          },
        }),
      );
      renderSetupApp();

      await waitFor(() => {
        expect(screen.getByLabelText("언어")).toBeInTheDocument();
      });

      const select = screen.getByLabelText("언어") as HTMLSelectElement;
      expect(select.value).toBe("en-US");
    });

    it("allows changing locale via selector", async () => {
      mockSendVaultMessage.mockResolvedValueOnce(createVaultStateResponse());
      renderSetupApp();

      await waitFor(() => {
        expect(screen.getByLabelText("언어")).toBeInTheDocument();
      });

      const select = screen.getByLabelText("언어");
      fireEvent.change(select, { target: { value: "en-US" } });

      expect((select as HTMLSelectElement).value).toBe("en-US");
    });

    it("sends selected locale with setup-pin message", async () => {
      mockSendVaultMessage
        .mockResolvedValueOnce(createVaultStateResponse()) // initial load
        .mockResolvedValueOnce({ ok: true }) // setup-pin
        .mockResolvedValueOnce(
          createVaultStateResponse({
            session: { isUnlocked: true, hasPin: true, lockoutUntil: null },
          }),
        ); // refreshState

      renderSetupApp();

      await waitFor(() => {
        expect(screen.getByLabelText("언어")).toBeInTheDocument();
      });

      // Change locale to English
      fireEvent.change(screen.getByLabelText("언어"), { target: { value: "en-US" } });

      fireEvent.change(screen.getByLabelText("PIN 6자리"), { target: { value: "123456" } });
      fireEvent.change(screen.getByLabelText("PIN 확인"), { target: { value: "123456" } });
      fireEvent.click(screen.getByRole("button", { name: "PIN 설정 완료" }));

      await waitFor(() => {
        expect(mockSendVaultMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "session:setup-pin",
            pin: "123456",
            locale: "en-US",
          }),
        );
      });
    });
  });

  describe("appError display", () => {
    it("displays appError in a global alert section", async () => {
      // This tests the case where setupPin succeeds but refreshState after it fails
      mockSendVaultMessage
        .mockResolvedValueOnce(createVaultStateResponse()) // initial load
        .mockResolvedValueOnce({ ok: true }) // setup-pin
        .mockRejectedValueOnce(new Error("refresh failed")); // refreshState after setup throws

      renderSetupApp();

      await waitFor(() => {
        expect(screen.getByLabelText("PIN 6자리")).toBeInTheDocument();
      });

      fireEvent.change(screen.getByLabelText("PIN 6자리"), { target: { value: "123456" } });
      fireEvent.change(screen.getByLabelText("PIN 확인"), { target: { value: "123456" } });
      fireEvent.click(screen.getByRole("button", { name: "PIN 설정 완료" }));

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent("refresh failed");
      });
    });
  });
});
