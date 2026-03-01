// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PermissionSection } from "./permission-section";
import type { VaultPermissionScope } from "../../../src/core/models";

vi.mock("../../../src/core/utils", () => ({
  providerLabel: (p: string) => ({ chatgpt: "ChatGPT", claude: "Claude", gemini: "Gemini" })[p],
  resourceLabel: (t: string) => t,
}));

function makePermission(overrides: Partial<VaultPermissionScope> = {}): VaultPermissionScope {
  return {
    key: "perm-1",
    provider: "chatgpt",
    resourceType: "Observation",
    depth: "summary",
    legacy: false,
    ...overrides,
  };
}

function renderPermission(overrides: Partial<Parameters<typeof PermissionSection>[0]> = {}) {
  const defaultProps = {
    permissions: [] as VaultPermissionScope[],
    revokingKey: null,
    onRevoke: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { ...render(<PermissionSection {...defaultProps} />), props: defaultProps };
}

describe("PermissionSection", () => {
  it("shows empty state message when no permissions", () => {
    renderPermission();
    expect(screen.getByText(/자동 공유로 저장된 규칙이 없습니다/)).toBeInTheDocument();
  });

  it("renders permission cards", () => {
    const perm = makePermission();
    renderPermission({ permissions: [perm] });
    expect(screen.getByText(/ChatGPT/)).toBeInTheDocument();
  });

  it("shows provider and resource type on card", () => {
    const perm = makePermission({ provider: "claude", resourceType: "MedicationStatement" });
    renderPermission({ permissions: [perm] });
    expect(screen.getByText(/Claude · MedicationStatement · 요약/)).toBeInTheDocument();
  });

  it("revoke button calls onRevoke with key", () => {
    const perm = makePermission({ key: "test-key" });
    const { props } = renderPermission({ permissions: [perm] });
    fireEvent.click(screen.getByRole("button", { name: "해제" }));
    expect(props.onRevoke).toHaveBeenCalledWith("test-key");
  });

  it("shows revoking state when revokingKey matches", () => {
    const perm = makePermission({ key: "rk" });
    renderPermission({ permissions: [perm], revokingKey: "rk" });
    const btn = screen.getByRole("button", { name: "해제 중..." });
    expect(btn).toBeDisabled();
  });

  it("renders multiple permission cards", () => {
    const perms = [
      makePermission({ key: "k1", provider: "chatgpt" }),
      makePermission({ key: "k2", provider: "claude" }),
    ];
    renderPermission({ permissions: perms });
    const buttons = screen.getAllByRole("button", { name: "해제" });
    expect(buttons).toHaveLength(2);
  });

  it("shows depth label codes", () => {
    const perm = makePermission({ depth: "codes" });
    renderPermission({ permissions: [perm] });
    expect(screen.getByText(/코드/)).toBeInTheDocument();
  });

  it("shows depth label detail", () => {
    const perm = makePermission({ depth: "detail" });
    renderPermission({ permissions: [perm] });
    expect(screen.getByText(/상세/)).toBeInTheDocument();
  });

  it("shows date range when both dateFrom and dateTo are set", () => {
    const perm = makePermission({ dateFrom: "2025-01-01", dateTo: "2025-12-31" });
    renderPermission({ permissions: [perm] });
    expect(screen.getByText(/2025-01-01 ~ 2025-12-31/)).toBeInTheDocument();
  });

  it("shows dateFrom only when dateTo is not set", () => {
    const perm = makePermission({ dateFrom: "2025-01-01" });
    renderPermission({ permissions: [perm] });
    expect(screen.getByText(/2025-01-01 이후/)).toBeInTheDocument();
  });

  it("shows dateTo only when dateFrom is not set", () => {
    const perm = makePermission({ dateTo: "2025-12-31" });
    renderPermission({ permissions: [perm] });
    expect(screen.getByText(/2025-12-31 이전/)).toBeInTheDocument();
  });

  it("shows query when set", () => {
    const perm = makePermission({ query: "blood test" });
    renderPermission({ permissions: [perm] });
    expect(screen.getByText(/blood test/)).toBeInTheDocument();
  });

  it("shows legacy badge when legacy is true", () => {
    const perm = makePermission({ legacy: true });
    renderPermission({ permissions: [perm] });
    expect(screen.getByText("기존 규칙")).toBeInTheDocument();
  });
});
