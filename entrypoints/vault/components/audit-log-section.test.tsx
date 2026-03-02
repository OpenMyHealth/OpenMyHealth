// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { AuditLogSection } from "./audit-log-section";
import type { AuditEntry } from "../../../src/core/models";

vi.mock("../../../src/core/utils", () => ({
  providerLabel: (p: string) => ({ chatgpt: "ChatGPT", claude: "Claude", gemini: "Gemini" })[p],
  resourceLabel: (t: string) => t,
}));

function makeLog(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: "log-1",
    timestamp: "2025-01-01T00:00:00Z",
    ai_provider: "chatgpt",
    resource_types: ["Observation"],
    depth: "summary",
    result: "approved",
    permission_level: "one-time",
    ...overrides,
  };
}

describe("AuditLogSection", () => {
  it("shows empty state when no logs", () => {
    render(<AuditLogSection auditLogs={[]} />);
    expect(screen.getByText(/아직 공유 이력이 없습니다/)).toBeInTheDocument();
  });

  it("renders log entries", () => {
    render(<AuditLogSection auditLogs={[makeLog()]} />);
    expect(screen.getByText("ChatGPT")).toBeInTheDocument();
  });

  it("result label shows '승인' for approved", () => {
    render(<AuditLogSection auditLogs={[makeLog({ result: "approved" })]} />);
    expect(screen.getByText("승인")).toBeInTheDocument();
  });

  it("result label shows '거절' for denied with destructive class", () => {
    render(<AuditLogSection auditLogs={[makeLog({ result: "denied" })]} />);
    const badge = screen.getByText("거절");
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain("text-destructive");
  });

  it("result label shows '시간 초과' for timeout with warning class", () => {
    render(<AuditLogSection auditLogs={[makeLog({ result: "timeout" })]} />);
    const badge = screen.getByText("시간 초과");
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain("text-warning");
  });

  it("result label shows '오류' for error with destructive class", () => {
    render(<AuditLogSection auditLogs={[makeLog({ result: "error" })]} />);
    const badge = screen.getByText("오류");
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain("text-destructive");
  });

  it("permission level badge shows correct text", () => {
    render(<AuditLogSection auditLogs={[makeLog({ permission_level: "always" })]} />);
    expect(screen.getByText("항상 허용")).toBeInTheDocument();
  });

  it("permission level badge shows 1회 허용 for one-time", () => {
    render(<AuditLogSection auditLogs={[makeLog({ permission_level: "one-time" })]} />);
    expect(screen.getByText("1회 허용")).toBeInTheDocument();
  });

  it("shows depth label codes", () => {
    render(<AuditLogSection auditLogs={[makeLog({ depth: "codes" })]} />);
    expect(screen.getByText(/코드/)).toBeInTheDocument();
  });

  it("shows depth label summary", () => {
    render(<AuditLogSection auditLogs={[makeLog({ depth: "summary" })]} />);
    expect(screen.getByText(/요약/)).toBeInTheDocument();
  });

  it("shows depth label detail", () => {
    render(<AuditLogSection auditLogs={[makeLog({ depth: "detail" })]} />);
    expect(screen.getByText(/상세/)).toBeInTheDocument();
  });

  it("shows requested resource counts", () => {
    render(<AuditLogSection auditLogs={[makeLog({ requested_resource_counts: { Observation: 5 } })]} />);
    expect(screen.getByText(/요청 건수/)).toBeInTheDocument();
    expect(screen.getByText(/Observation 5건/)).toBeInTheDocument();
  });

  it("shows shared resource types", () => {
    render(<AuditLogSection auditLogs={[makeLog({ shared_resource_types: ["Observation", "Condition"] })]} />);
    expect(screen.getByText(/공유됨: Observation, Condition/)).toBeInTheDocument();
  });

  it("shows shared resource counts", () => {
    render(<AuditLogSection auditLogs={[makeLog({ shared_resource_counts: { Observation: 3 } })]} />);
    expect(screen.getByText(/공유 건수/)).toBeInTheDocument();
  });

  it("shows 요청 항목 전체 for approved log with no shared_resource_types", () => {
    render(<AuditLogSection auditLogs={[makeLog({ result: "approved" })]} />);
    expect(screen.getByText(/요청 항목 전체/)).toBeInTheDocument();
  });

  it("shows 없음 for denied log", () => {
    render(<AuditLogSection auditLogs={[makeLog({ result: "denied" })]} />);
    expect(screen.getByText(/공유됨: 없음/)).toBeInTheDocument();
  });

  it("shows reason when provided", () => {
    render(<AuditLogSection auditLogs={[makeLog({ reason: "test reason" })]} />);
    expect(screen.getByText(/test reason/)).toBeInTheDocument();
  });

  it("does not show requested_resource_counts when counts are zero", () => {
    render(<AuditLogSection auditLogs={[makeLog({ requested_resource_counts: { Observation: 0 } })]} />);
    expect(screen.queryByText(/요청 건수/)).not.toBeInTheDocument();
  });

  it("handles formatResourceCounts with undefined counts", () => {
    render(<AuditLogSection auditLogs={[makeLog({ requested_resource_counts: undefined })]} />);
    expect(screen.queryByText(/요청 건수/)).not.toBeInTheDocument();
  });
});
