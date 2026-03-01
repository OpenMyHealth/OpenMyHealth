import React from "react";
import { TrustAnchorSection } from "./trust-anchor-section";

type UnlockSectionProps = {
  guide: string | null;
  lockoutSeconds: number;
  lockoutStageLabel: string | null;
  pin: string;
  authError: string | null;
  isUnlocking: boolean;
  onPinChange: (pin: string) => void;
  onSubmit: () => Promise<void>;
};

export function UnlockSection({
  guide,
  lockoutSeconds,
  lockoutStageLabel,
  pin,
  authError,
  isUnlocking,
  onPinChange,
  onSubmit,
}: UnlockSectionProps): React.ReactElement {
  const errorId = authError ? "vault-pin-unlock-error" : undefined;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_0%_0%,hsl(var(--accent))_0%,transparent_55%)] opacity-70" />
      <div className="relative">
        <h2 className="text-2xl font-semibold">잠금 해제</h2>
        <p className="mt-1 text-sm text-muted-foreground">Vault를 사용하려면 PIN을 입력해 주세요.</p>
      </div>

      {guide && (
        <p className="mt-3 rounded-lg border border-status-warning-border bg-status-warning-surface px-3 py-2 text-sm text-warning" role="status">
          {guide}
        </p>
      )}
      {lockoutSeconds > 0 && (
        <div className="mt-3 flex items-center gap-3 rounded-lg border border-status-warning-border bg-status-warning-surface px-3 py-2 text-warning">
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-warning/40 bg-background text-sm font-semibold">
            {lockoutSeconds}s
          </div>
          <div className="text-sm">
            <div className="font-medium">{lockoutStageLabel ?? "잠금 대기"}</div>
            <div className="text-sm">PIN 입력이 일시적으로 제한되었습니다.</div>
          </div>
        </div>
      )}

      <form
        className="relative mt-4"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit();
        }}
      >
        <div className="max-w-sm grid gap-2">
          <label className="text-sm text-muted-foreground" htmlFor="vault-pin-unlock">PIN 6자리</label>
          <input
            id="vault-pin-unlock"
            className="h-12 w-full rounded-lg border border-border px-3 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2"
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            disabled={lockoutSeconds > 0 || isUnlocking}
            onChange={(event) => onPinChange(event.target.value.replace(/\D/g, ""))}
            placeholder="PIN 6자리"
            aria-invalid={Boolean(errorId)}
            aria-describedby={errorId}
          />
        </div>

        {authError && authError !== guide && (
          <p id="vault-pin-unlock-error" className="mt-3 text-sm text-destructive" role="alert">
            {authError}
          </p>
        )}

        <button
          type="submit"
          className="mt-4 min-h-[48px] rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          disabled={lockoutSeconds > 0 || isUnlocking}
        >
          {isUnlocking ? "확인 중..." : "잠금 해제"}
        </button>
      </form>
      <TrustAnchorSection />
    </section>
  );
}
