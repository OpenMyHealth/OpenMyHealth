import React from "react";
import type { McpDepth, ResourceType } from "../../../packages/contracts/src/index";
import type { AuditEntry } from "../../../src/core/models";
import { providerLabel, resourceLabel } from "../../../src/core/utils";

function depthLabel(depth: McpDepth): string {
  if (depth === "codes") {
    return "코드";
  }
  if (depth === "summary") {
    return "요약";
  }
  return "상세";
}

function formatResourceCounts(counts?: Partial<Record<ResourceType, number>>): string | null {
  if (!counts) {
    return null;
  }
  const pairs = Object.entries(counts)
    .filter(([, count]) => typeof count === "number" && count > 0)
    .map(([type, count]) => `${resourceLabel(type as ResourceType)} ${count}건`);
  return pairs.length > 0 ? pairs.join(", ") : null;
}

function resultLabel(result: AuditEntry["result"]): string {
  if (result === "approved") {
    return "승인";
  }
  if (result === "denied") {
    return "거절";
  }
  if (result === "timeout") {
    return "시간 초과";
  }
  return "오류";
}

function resultTone(result: AuditEntry["result"]): string {
  if (result === "approved") {
    return "text-success";
  }
  if (result === "denied") {
    return "text-destructive";
  }
  if (result === "timeout") {
    return "text-warning";
  }
  return "text-destructive";
}

export function AuditLogSection({ auditLogs }: { auditLogs: AuditEntry[] }): React.ReactElement {
  return (
    <section className="rounded-2xl border border-border/80 bg-card/95 p-5 shadow-card">
      <h2 className="text-xl font-semibold">공유 이력</h2>
      <p className="mt-1 text-sm text-muted-foreground">현재 최근 100건까지 표시됩니다.</p>
      <div className="mt-3 grid gap-2">
        {auditLogs.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-secondary/30 px-4 py-6 text-sm text-muted-foreground">
            아직 공유 이력이 없습니다.
          </div>
        )}

        {auditLogs.map((log) => (
          <div key={log.id} className="rounded-xl border border-border p-4 transition-colors hover:bg-secondary/20">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="font-medium">{providerLabel(log.ai_provider)}</div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-sm font-medium ${resultTone(log.result)}`}>
                  {resultLabel(log.result)}
                </span>
                <span className="text-sm text-muted-foreground">{new Date(log.timestamp).toLocaleString()}</span>
              </div>
            </div>

            <div className="mt-2 flex flex-wrap gap-2 text-sm text-muted-foreground">
              <span className="rounded-full border border-border bg-secondary px-2 py-0.5">
                {log.permission_level === "always" ? "항상 허용" : "1회 허용"}
              </span>
              <span className="rounded-full border border-border bg-secondary px-2 py-0.5">
                요청 범위: {depthLabel(log.depth)}
              </span>
            </div>

            <div className="mt-1 text-sm text-muted-foreground">
              요청됨: {log.resource_types.map(resourceLabel).join(", ")}
            </div>
            {formatResourceCounts(log.requested_resource_counts) && (
              <div className="mt-1 text-sm text-muted-foreground">
                요청 건수: {formatResourceCounts(log.requested_resource_counts)}
              </div>
            )}
            {log.shared_resource_types && log.shared_resource_types.length > 0 && (
              <div className="mt-1 text-sm text-muted-foreground">
                공유됨: {log.shared_resource_types.map(resourceLabel).join(", ")}
              </div>
            )}
            {formatResourceCounts(log.shared_resource_counts) && (
              <div className="mt-1 text-sm text-muted-foreground">
                공유 건수: {formatResourceCounts(log.shared_resource_counts)}
              </div>
            )}
            {!log.shared_resource_types?.length && log.result === "approved" && (
              <div className="mt-1 text-sm text-muted-foreground">
                공유됨: 요청 항목 전체
              </div>
            )}
            {log.result !== "approved" && (
              <div className="mt-1 text-sm text-muted-foreground">
                공유됨: 없음
              </div>
            )}
            {log.reason && <div className="mt-1 text-sm text-muted-foreground">사유: {log.reason}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}
