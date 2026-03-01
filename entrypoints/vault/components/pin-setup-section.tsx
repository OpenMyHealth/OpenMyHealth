import React from "react";
import { TrustAnchorSection } from "./trust-anchor-section";

type PinSetupSectionProps = {
  locale: string;
  pin: string;
  confirmPin: string;
  authError: string | null;
  isSettingPin: boolean;
  onLocaleChange: (locale: string) => void;
  onPinChange: (pin: string) => void;
  onConfirmPinChange: (pin: string) => void;
  onSubmit: () => Promise<void>;
};

export function PinSetupSection({
  locale,
  pin,
  confirmPin,
  authError,
  isSettingPin,
  onLocaleChange,
  onPinChange,
  onConfirmPinChange,
  onSubmit,
}: PinSetupSectionProps): React.ReactElement {
  const errorId = authError ? "vault-pin-setup-error" : undefined;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_0%_0%,hsl(var(--accent))_0%,transparent_55%)] opacity-70" />
      <div className="relative">
        <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-xl" aria-hidden="true">
          🔐
        </div>
        <h2 className="mt-3 text-2xl font-semibold">PIN 설정</h2>
        <p className="mt-1 text-sm text-muted-foreground">숫자 6자리 PIN으로 로컬 데이터 암호화를 시작합니다.</p>
        <p className="mt-2 text-sm text-warning">PIN을 잊으면 기존 데이터를 복구할 수 없습니다.</p>
      </div>

      <form
        className="relative mt-4"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit();
        }}
      >
        <div className="grid max-w-sm gap-2">
          <label className="text-sm text-muted-foreground" htmlFor="vault-locale">언어</label>
          <select
            id="vault-locale"
            className="h-12 rounded-lg border border-border px-3 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2"
            value={locale}
            onChange={(event) => onLocaleChange(event.target.value)}
            disabled={isSettingPin}
          >
            <option value="ko-KR">한국어</option>
            <option value="en-US">English</option>
          </select>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="grid gap-2">
            <label className="text-sm text-muted-foreground" htmlFor="vault-pin-setup">PIN 6자리</label>
            <input
              id="vault-pin-setup"
              className="h-12 rounded-lg border border-border px-3 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2"
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(event) => onPinChange(event.target.value.replace(/\D/g, ""))}
              placeholder="PIN 6자리"
              disabled={isSettingPin}
              aria-invalid={Boolean(errorId)}
              aria-describedby={errorId}
            />
          </div>
          <div className="grid gap-2">
            <label className="text-sm text-muted-foreground" htmlFor="vault-pin-confirm">PIN 확인</label>
            <input
              id="vault-pin-confirm"
              className="h-12 rounded-lg border border-border px-3 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2"
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={confirmPin}
              onChange={(event) => onConfirmPinChange(event.target.value.replace(/\D/g, ""))}
              placeholder="PIN 확인"
              disabled={isSettingPin}
              aria-invalid={Boolean(errorId)}
              aria-describedby={errorId}
            />
          </div>
        </div>

        {authError && (
          <p id="vault-pin-setup-error" className="mt-3 text-sm text-destructive" role="alert">
            {authError}
          </p>
        )}

        <button
          type="submit"
          className="mt-4 min-h-[48px] rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          disabled={isSettingPin}
        >
          {isSettingPin ? "PIN 설정 중..." : "PIN 설정 완료"}
        </button>
      </form>

      <TrustAnchorSection />
      <p className="mt-3 text-sm text-muted-foreground">
        이 서비스는 전문 의료 조언을 대체하지 않습니다. 치료/복약 판단은 반드시 담당 의료진과 상담하세요.
      </p>
    </section>
  );
}
