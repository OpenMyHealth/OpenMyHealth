import React from "react";
import { createRoot } from "react-dom/client";
import { resourceLabel } from "../../src/core/utils";
import { AuditLogSection } from "./components/audit-log-section";
import { PermissionSection } from "./components/permission-section";
import { PinSetupSection } from "./components/pin-setup-section";
import { ProviderSection } from "./components/provider-section";
import { UnlockSection } from "./components/unlock-section";
import { UploadSection } from "./components/upload-section";
import { statusTone } from "./runtime";
import { ErrorBoundary } from "../../src/components/error-boundary";
import { useVaultState } from "./use-vault-state";
import "../../assets/css/global.css";

function RootFallback({ error, reset }: { error: Error; reset: () => void }): React.ReactElement {
  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto max-w-3xl rounded-2xl border border-destructive/40 bg-card p-6 shadow-card">
        <h1 className="text-xl font-semibold">Vault 화면을 표시하지 못했습니다</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          확장 프로그램 빌드가 섞였거나 업데이트가 완전히 반영되지 않았을 수 있습니다.
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

function App(): React.ReactElement {
  const vault = useVaultState();

  if (vault.loading) {
    return (
      <main className="min-h-screen bg-background p-6 text-foreground">
        <div className="mx-auto max-w-3xl animate-slide-up-fade rounded-2xl border border-border bg-card p-6 shadow-card">
          <div className="h-6 w-56 animate-pulse rounded bg-muted" />
          <div className="mt-3 h-4 w-72 animate-pulse rounded bg-muted" />
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="h-24 animate-pulse rounded-xl bg-muted" />
            <div className="h-24 animate-pulse rounded-xl bg-muted" />
            <div className="h-24 animate-pulse rounded-xl bg-muted" />
          </div>
          <p className="mt-4 text-sm text-muted-foreground">Vault 상태를 불러오는 중입니다...</p>
        </div>
      </main>
    );
  }

  if (!vault.state) {
    return (
      <main className="min-h-screen bg-background p-6 text-foreground">
        <div className="mx-auto max-w-3xl rounded-2xl border border-destructive/30 bg-card p-6 shadow-card">
          <h1 className="text-xl font-semibold">Vault 상태를 불러오지 못했습니다</h1>
          <p className="mt-2 text-sm text-muted-foreground">확장 프로그램을 새로고침한 뒤 다시 시도해 주세요.</p>
          {vault.appError && <p className="mt-3 text-sm text-destructive" role="alert">{vault.appError}</p>}
          <button
            type="button"
            className="mt-4 min-h-[48px] rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-secondary"
            onClick={() => {
              void (async () => {
                try {
                  await vault.refreshState();
                  vault.setAppError(null);
                } catch (loadError) {
                  vault.setAppError(await vault.withConnectionHint(loadError));
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

  const { session, settings } = vault.state;

  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground md:px-8">
      <div className="mx-auto grid max-w-5xl gap-6">
        <section className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-card">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_0%_0%,hsl(var(--accent))_0%,transparent_52%)] opacity-80" />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.12em] text-primary">OpenMyHealth</p>
              <h1 className="mt-1 text-2xl font-semibold md:text-3xl">건강 보관함 (Health Vault)</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                건강기록은 이 기기에서 암호화되어 저장되며, 승인된 항목만 AI에 전달됩니다.
              </p>
            </div>
            {session.isUnlocked && (
              <button
                type="button"
                className="min-h-[48px] w-full rounded-lg border border-border bg-background/70 px-4 py-2 text-sm font-semibold hover:bg-secondary disabled:opacity-60 sm:w-auto"
                onClick={() => void vault.lock()}
                disabled={vault.isLocking || vault.refreshing}
              >
                {vault.isLocking ? "잠그는 중..." : "잠그기"}
              </button>
            )}
          </div>
          <div className="relative mt-4 grid gap-2 sm:grid-cols-3">
            <div className={`rounded-lg px-3 py-2 text-sm font-semibold ${session.isUnlocked ? "bg-success/15 text-success" : "bg-primary text-primary-foreground"}`}>
              1 PIN {session.isUnlocked ? "완료" : "설정/해제"}
            </div>
            <div className={`rounded-lg px-3 py-2 text-sm font-semibold ${session.isUnlocked ? "bg-secondary text-secondary-foreground" : "bg-secondary/60 text-muted-foreground"}`}>
              2 기록 업로드
            </div>
            <div className={`rounded-lg px-3 py-2 text-sm font-semibold ${settings.connectedProvider ? "bg-success/15 text-success" : "bg-secondary text-secondary-foreground"}`}>
              3 AI 연결
            </div>
          </div>
        </section>

        {settings.integrationWarning && (
          <section className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning" role="alert">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>{settings.integrationWarning}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="min-h-[48px] rounded border border-warning/40 px-3 py-1 text-sm hover:bg-warning/15"
                  onClick={() => {
                    void vault.refreshState();
                  }}
                >
                  연결 상태 다시 확인
                </button>
                <a
                  className="inline-flex min-h-[48px] items-center rounded border border-warning/40 px-3 py-1 text-sm hover:bg-warning/15"
                  href="chrome://extensions"
                >
                  확장 프로그램 업데이트 확인
                </a>
              </div>
            </div>
          </section>
        )}

        {vault.appError && (
          <section className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
            <div className="flex items-start justify-between gap-3">
              <span>{vault.appError}</span>
              <button type="button" className="rounded border border-destructive/30 px-2 py-1 text-sm" onClick={() => vault.setAppError(null)}>
                닫기
              </button>
            </div>
          </section>
        )}

        {!session.hasPin && (
          <PinSetupSection
            locale={vault.locale}
            pin={vault.pin}
            confirmPin={vault.confirmPin}
            authError={vault.authError}
            isSettingPin={vault.isSettingPin}
            onLocaleChange={vault.setLocale}
            onPinChange={vault.setPin}
            onConfirmPinChange={vault.setConfirmPin}
            onSubmit={vault.setupPin}
          />
        )}

        {session.hasPin && !session.isUnlocked && (
          <UnlockSection
            guide={vault.guide}
            lockoutSeconds={vault.lockoutSeconds}
            lockoutStageLabel={vault.lockoutStageLabel}
            pin={vault.pin}
            authError={vault.authError}
            isUnlocking={vault.isUnlocking}
            onPinChange={vault.setPin}
            onSubmit={vault.unlock}
          />
        )}

        {session.isUnlocked && (
          <>
            <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold">내 건강 데이터 요약</h2>
                  <p className="text-sm text-muted-foreground">업로드/분석/공유 이력을 한 번에 확인합니다.</p>
                </div>
                <div className="rounded-full bg-secondary px-3 py-1 text-sm font-medium text-secondary-foreground">
                  자동 공유 {vault.permissions.length}개
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {vault.summaryEntries.length === 0 && (
                  <div className="col-span-full rounded-xl border border-dashed border-border bg-secondary/30 px-4 py-6 text-sm text-muted-foreground">
                    기록을 올리면 여기에 요약이 표시됩니다.
                  </div>
                )}

                {vault.summaryEntries.map(([type, count]) => (
                  <div key={type} className="rounded-xl border border-border bg-accent px-4 py-4">
                    <div className="text-sm text-accent-foreground">{resourceLabel(type)}</div>
                    <div className="mt-1 text-2xl font-semibold text-accent-foreground">{count}건</div>
                  </div>
                ))}
              </div>
            </section>

            <UploadSection
              hasFiles={vault.visibleFiles.length > 0}
              uploading={vault.uploading}
              isBusy={vault.isBusy}
              fileInputRef={vault.fileInputRef}
              uploadFiles={vault.uploadFiles}
              moveToAiConnection={vault.moveToAiConnection}
              visibleFiles={vault.visibleFiles}
              statusTone={statusTone}
              triggerDownload={vault.triggerDownload}
              triggerDelete={vault.triggerDelete}
            />

            <ProviderSection
              aiConnectionRef={vault.aiConnectionRef}
              hasFiles={vault.state.files.length > 0}
              connectedProvider={settings.connectedProvider}
              settingProvider={vault.settingProvider}
              setProvider={vault.setProvider}
            />

            <PermissionSection
              permissions={vault.permissions}
              revokingKey={vault.revokingPermissionKey}
              onRevoke={vault.revokePermission}
            />

            <AuditLogSection auditLogs={vault.state.auditLogs} />
          </>
        )}
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary fallback={(error, reset) => <RootFallback error={error} reset={reset} />}>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
