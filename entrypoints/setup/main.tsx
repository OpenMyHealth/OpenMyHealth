import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { VAULT_PAGE_PATH } from "../../src/core/constants";
import type { VaultStateResponse } from "../../src/core/messages";
import { ErrorBoundary } from "../../src/components/error-boundary";
import { PinSetupSection } from "../vault/components/pin-setup-section";
import { readableError, sendVaultMessage, withConnectionHint } from "../vault/runtime";
import "../../assets/css/global.css";

function SetupFallback({ error, reset }: { error: Error; reset: () => void }): React.ReactElement {
  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto max-w-3xl rounded-2xl border border-destructive/40 bg-card p-6 shadow-card">
        <h1 className="text-xl font-semibold">설정 화면을 표시하지 못했습니다</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          확장 프로그램 업데이트가 완전히 적용되지 않았을 수 있습니다.
        </p>
        <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {error.message || "알 수 없는 오류"}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="min-h-[48px] rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            onClick={() => {
              reset();
              location.reload();
            }}
          >
            다시 시도
          </button>
          <a
            className="inline-flex min-h-[48px] items-center rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-secondary"
            href="chrome://extensions"
          >
            확장 프로그램 관리 열기
          </a>
        </div>
      </div>
    </main>
  );
}

function openVaultPage(): void {
  location.href = browser.runtime.getURL(VAULT_PAGE_PATH);
}

function SetupApp(): React.ReactElement {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<VaultStateResponse | null>(null);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [locale, setLocale] = useState(navigator.language || "ko-KR");
  const [isSettingPin, setIsSettingPin] = useState(false);
  const [appError, setAppError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  async function refreshState(): Promise<void> {
    const response = await sendVaultMessage<VaultStateResponse | { ok: false; error: string }>({
      type: "vault:get-state",
    });
    if (!response?.ok) {
      throw new Error(response.error || "설정 상태를 불러오지 못했습니다.");
    }
    setState(response);
    setLocale(response.settings.locale || navigator.language || "ko-KR");
  }

  useEffect(() => {
    void (async () => {
      try {
        await refreshState();
      } catch (error) {
        setAppError(await withConnectionHint(error));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function setupPin(): Promise<void> {
    if (pin.length !== 6 || confirmPin.length !== 6) {
      setAuthError("PIN 6자리를 입력해 주세요.");
      return;
    }
    if (pin !== confirmPin) {
      setAuthError("입력한 PIN이 서로 달라요. 천천히 다시 확인해 주세요.");
      return;
    }

    setIsSettingPin(true);
    setAppError(null);
    setAuthError(null);

    try {
      const response = await sendVaultMessage<{ ok: boolean; error?: string }>({
        type: "session:setup-pin",
        pin,
        locale,
      });
      if (!response?.ok) {
        setAuthError(response.error ?? "PIN 설정 중 문제가 발생했습니다.");
        return;
      }

      setPin("");
      setConfirmPin("");
      await refreshState();
      openVaultPage();
    } catch (error) {
      setAuthError(readableError(error));
    } finally {
      setIsSettingPin(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-background p-6 text-foreground">
        <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-card p-6 shadow-card">
          <div className="h-6 w-52 motion-safe:animate-pulse rounded-md bg-muted" />
          <div className="mt-3 h-4 w-72 motion-safe:animate-pulse rounded-md bg-muted" />
          <div className="mt-6 h-48 motion-safe:animate-pulse rounded-xl bg-muted" />
        </div>
      </main>
    );
  }

  if (!state) {
    return (
      <main className="min-h-screen bg-background p-6 text-foreground">
        <div className="mx-auto max-w-3xl rounded-2xl border border-destructive/30 bg-card p-6 shadow-card">
          <h1 className="text-xl font-semibold">설정 상태를 불러오지 못했습니다</h1>
          <p className="mt-2 text-sm text-muted-foreground">확장 프로그램을 새로고침한 뒤 다시 시도해 주세요.</p>
          {appError && <p className="mt-3 text-sm text-destructive" role="alert">{appError}</p>}
          <button
            type="button"
            className="mt-4 min-h-[48px] rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-secondary"
            onClick={() => {
              void (async () => {
                try {
                  await refreshState();
                  setAppError(null);
                } catch (error) {
                  setAppError(await withConnectionHint(error));
                }
              })();
            }}
          >
            다시 시도
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground md:px-8">
      <div className="mx-auto grid max-w-5xl gap-6">
        <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-primary">OpenMyHealth · Setup</p>
          <h1 className="mt-1 text-2xl font-semibold md:text-3xl">처음 설정</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            1) PIN 설정 2) 기록 업로드(선택) 3) AI 연결 순서로 진행됩니다.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {[
              { label: "1 PIN 설정", tone: "bg-primary text-primary-foreground" },
              { label: "2 기록 업로드", tone: "bg-secondary text-secondary-foreground" },
              { label: "3 AI 연결", tone: "bg-secondary text-secondary-foreground" },
            ].map((step) => (
              <div key={step.label} className={`rounded-lg px-3 py-2 text-sm font-semibold ${step.tone}`}>
                {step.label}
              </div>
            ))}
          </div>
        </section>

        {state.session.hasPin ? (
          <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
            <h2 className="text-xl font-semibold">설정이 완료되었습니다</h2>
            <p className="mt-2 text-sm text-muted-foreground">이제 Health Vault로 이동해 기록 업로드와 AI 연결을 진행할 수 있습니다.</p>
            <button
              type="button"
              className="mt-4 min-h-[48px] rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
              onClick={openVaultPage}
            >
              Health Vault 열기
            </button>
          </section>
        ) : (
          <PinSetupSection
            locale={locale}
            pin={pin}
            confirmPin={confirmPin}
            authError={authError}
            isSettingPin={isSettingPin}
            onLocaleChange={setLocale}
            onPinChange={setPin}
            onConfirmPinChange={setConfirmPin}
            onSubmit={setupPin}
          />
        )}

        {appError && (
          <section className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
            {appError}
          </section>
        )}
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary fallback={(error, reset) => <SetupFallback error={error} reset={reset} />}>
      <SetupApp />
    </ErrorBoundary>
  </React.StrictMode>,
);
