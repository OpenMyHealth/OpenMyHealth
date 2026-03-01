import React from "react";
import type { VaultPermissionScope } from "../../../src/core/models";
import { providerLabel, resourceLabel } from "../../../src/core/utils";

type PermissionSectionProps = {
  permissions: VaultPermissionScope[];
  revokingKey: string | null;
  onRevoke: (key: string) => Promise<void>;
};

function depthLabel(depth: VaultPermissionScope["depth"]): string {
  if (depth === "codes") {
    return "코드";
  }
  if (depth === "summary") {
    return "요약";
  }
  return "상세";
}

function dateRangeLabel(permission: VaultPermissionScope): string | null {
  if (!permission.dateFrom && !permission.dateTo) {
    return null;
  }
  if (permission.dateFrom && permission.dateTo) {
    return `${permission.dateFrom} ~ ${permission.dateTo}`;
  }
  return permission.dateFrom ? `${permission.dateFrom} 이후` : `${permission.dateTo} 이전`;
}

export function PermissionSection({
  permissions,
  revokingKey,
  onRevoke,
}: PermissionSectionProps): React.ReactElement {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <h2 className="text-xl font-semibold">자동 공유 관리</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        이전에 허용한 자동 공유 규칙을 확인하고 언제든 해제할 수 있습니다.
      </p>

      <div className="mt-4 grid gap-3">
        {permissions.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-secondary/30 px-4 py-5 text-sm text-muted-foreground">
            자동 공유로 저장된 규칙이 없습니다.
          </div>
        )}

        {permissions.map((permission) => {
          const dateRange = dateRangeLabel(permission);
          const isPending = revokingKey === permission.key;
          return (
            <div key={permission.key} className="rounded-xl border border-border px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    {providerLabel(permission.provider)} · {resourceLabel(permission.resourceType)} · {depthLabel(permission.depth)}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    {permission.query && (
                      <span className="rounded-full border border-border bg-secondary px-2 py-0.5">
                        검색어: {permission.query}
                      </span>
                    )}
                    {dateRange && (
                      <span className="rounded-full border border-border bg-secondary px-2 py-0.5">
                        기간: {dateRange}
                      </span>
                    )}
                    {permission.legacy && (
                      <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-warning">
                        기존 규칙
                      </span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  className="min-h-[48px] rounded-lg border border-destructive/35 px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60"
                  onClick={() => void onRevoke(permission.key)}
                  disabled={isPending}
                >
                  {isPending ? "해제 중..." : "해제"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
