import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AiProvider, ResourceType } from "../../packages/contracts/src/index";
import { MAX_UPLOAD_BYTES } from "../../src/core/constants";
import type { VaultStateResponse } from "../../src/core/messages";
import type { VaultFileSummary, VaultPermissionScope } from "../../src/core/models";
import { resourceLabel, secondsUntil } from "../../src/core/utils";
import { AuditLogSection } from "./components/audit-log-section";
import { PermissionSection } from "./components/permission-section";
import { PinSetupSection } from "./components/pin-setup-section";
import { ProviderSection } from "./components/provider-section";
import { UnlockSection } from "./components/unlock-section";
import { UploadSection } from "./components/upload-section";
import {
  humanizeUploadError,
  lockoutGuide,
  readableError,
  sendUploadMessage,
  sendVaultMessage,
  statusTone,
  summarizeUploadErrors,
  withConnectionHint,
} from "./runtime";
import { ErrorBoundary } from "../../src/components/error-boundary";
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [state, setState] = useState<VaultStateResponse | null>(null);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [locale, setLocale] = useState(navigator.language || "ko-KR");
  const [appError, setAppError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [optimisticFiles, setOptimisticFiles] = useState<VaultFileSummary[]>([]);
  const [permissions, setPermissions] = useState<VaultPermissionScope[]>([]);
  const [revokingPermissionKey, setRevokingPermissionKey] = useState<string | null>(null);
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());

  const [isSettingPin, setIsSettingPin] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [isLocking, setIsLocking] = useState(false);
  const [settingProvider, setSettingProvider] = useState<AiProvider | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const aiConnectionRef = useRef<HTMLElement | null>(null);
  const refreshEpochRef = useRef(0);

  async function refreshPermissions(): Promise<void> {
    const response = await sendVaultMessage<{ ok: true; permissions: VaultPermissionScope[] } | { ok: false; error: string }>({
      type: "vault:list-permissions",
    });
    if (!response?.ok) {
      throw new Error(response.error || "자동 공유 규칙을 불러오지 못했습니다.");
    }
    setPermissions(response.permissions);
  }

  async function refreshState(options: { silent?: boolean } = {}): Promise<void> {
    const epoch = ++refreshEpochRef.current;
    if (!options.silent) {
      setRefreshing(true);
    }

    try {
      const response = await sendVaultMessage<VaultStateResponse | { ok: false; error: string }>({ type: "vault:get-state" });
      if (!response?.ok) {
        throw new Error(response.error || "상태를 불러오지 못했습니다.");
      }
      if (epoch !== refreshEpochRef.current) {
        return;
      }
      setState(response);
      setLocale(response.settings.locale || navigator.language || "ko-KR");
      setLockoutUntil(response.session.lockoutUntil);
      setNowMs(Date.now());
      if (response.session.isUnlocked) {
        await refreshPermissions();
      } else {
        setPermissions([]);
      }
    } finally {
      if (!options.silent && epoch === refreshEpochRef.current) {
        setRefreshing(false);
      }
    }
  }

  async function refreshFilesOnly(): Promise<void> {
    const response = await sendVaultMessage<{ ok: true; files: VaultFileSummary[] } | { ok: false; error: string }>({
      type: "vault:list-files",
    });
    if (!response?.ok) {
      throw new Error(response.error || "파일 목록을 불러오지 못했습니다.");
    }
    setState((current) => (current ? { ...current, files: response.files } : current));
  }

  useEffect(() => {
    void (async () => {
      try {
        await refreshState({ silent: true });
      } catch (loadError) {
        setAppError(await withConnectionHint(loadError));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!lockoutUntil) {
      return;
    }
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNowMs(current);
      if (current >= lockoutUntil) {
        setLockoutUntil(null);
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [lockoutUntil]);

  const summaryEntries = useMemo(() => {
    const summary = state?.summary ?? {};
    return Object.entries(summary) as Array<[ResourceType, number]>;
  }, [state?.summary]);

  const visibleFiles = useMemo(() => {
    const persisted = state?.files ?? [];
    if (optimisticFiles.length === 0) {
      return persisted;
    }

    const persistedIds = new Set(persisted.map((file) => file.id));
    const pending = optimisticFiles.filter((file) => !persistedIds.has(file.id));
    return [...pending, ...persisted];
  }, [optimisticFiles, state?.files]);

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
    setAuthError(null);
    setAppError(null);

    try {
      const response = await sendVaultMessage<{ ok: boolean; isUnlocked?: boolean; error?: string }>({
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
    } catch (error) {
      setAuthError(readableError(error));
    } finally {
      setIsSettingPin(false);
    }
  }

  async function unlock(): Promise<void> {
    if (pin.length !== 6) {
      setAuthError("PIN 6자리를 입력해 주세요.");
      return;
    }

    const remaining = secondsUntil(lockoutUntil);
    if (remaining > 0) {
      setAuthError(lockoutGuide(remaining));
      return;
    }

    setIsUnlocking(true);
    setAuthError(null);

    try {
      const response = await sendVaultMessage<{ ok: boolean; isUnlocked?: boolean; error?: string; lockoutUntil?: number | null }>({
        type: "session:unlock",
        pin,
      });

      if (!response?.ok) {
        setAuthError(response.error ?? "잠금 해제 요청을 처리하지 못했습니다.");
        return;
      }

      if (!response.isUnlocked) {
        setLockoutUntil(response.lockoutUntil ?? null);
        const cooldown = secondsUntil(response.lockoutUntil ?? null);
        if (cooldown > 0) {
          setAuthError(lockoutGuide(cooldown));
        } else {
          setAuthError("PIN이 일치하지 않아요. 천천히 다시 시도해 주세요.");
        }
        return;
      }

      setAuthError(null);
      setPin("");
      setLockoutUntil(null);
      await refreshState();
    } catch (error) {
      setAuthError(readableError(error));
    } finally {
      setIsUnlocking(false);
    }
  }

  async function lock(): Promise<void> {
    setIsLocking(true);
    setAppError(null);
    try {
      const response = await sendVaultMessage<{ ok: boolean; error?: string }>({ type: "session:lock" });
      if (!response?.ok) {
        throw new Error(response.error ?? "잠금 처리에 실패했습니다.");
      }
      setAuthError(null);
      await refreshState();
    } catch (error) {
      setAppError(readableError(error));
    } finally {
      setIsLocking(false);
    }
  }

  async function setProvider(provider: AiProvider): Promise<void> {
    setSettingProvider(provider);
    setAppError(null);
    try {
      const response = await sendVaultMessage<{ ok: boolean; provider?: AiProvider; error?: string }>({
        type: "vault:set-provider",
        provider,
      });
      if (!response?.ok) {
        throw new Error(response.error ?? "AI 제공자 변경에 실패했습니다.");
      }
      await refreshState();
    } catch (error) {
      setAppError(readableError(error));
    } finally {
      setSettingProvider(null);
    }
  }

  async function triggerDownload(fileId: string): Promise<void> {
    setAppError(null);
    try {
      const response = await sendVaultMessage<
        { ok: true; file: { name: string; mimeType: string; bytes: ArrayBuffer } } | { ok: false; error: string }
      >({
        type: "vault:download-file",
        fileId,
      });

      if (!response?.ok) {
        setAppError(response.error);
        return;
      }

      const blob = new Blob([response.file.bytes], { type: response.file.mimeType || "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = response.file.name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setAppError(readableError(error));
    }
  }

  async function uploadFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) {
      return;
    }

    setUploading(true);
    setAppError(null);
    const fileErrors: string[] = [];

    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_UPLOAD_BYTES) {
          fileErrors.push(`${file.name}: 파일은 30MB 이하로 올려주세요.`);
          continue;
        }

        const optimisticId = `upload-${crypto.randomUUID()}`;
        const optimisticFile: VaultFileSummary = {
          id: optimisticId,
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          createdAt: new Date().toISOString(),
          status: "processing",
          matchedCounts: {},
        };
        setOptimisticFiles((current) => [optimisticFile, ...current]);

        const buffer = await file.arrayBuffer();
        try {
          const response = await sendUploadMessage<{ ok: boolean; error?: string }>({
            type: "vault:upload-file",
            name: file.name,
            mimeType: file.type || "application/octet-stream",
            size: file.size,
            bytes: buffer,
          });

          if (!response?.ok) {
            throw new Error(response.error ?? `${file.name} 업로드에 실패했습니다.`);
          }
        } catch (error) {
          fileErrors.push(`${file.name}: ${humanizeUploadError(error)}`);
        } finally {
          setOptimisticFiles((current) => current.filter((item) => item.id !== optimisticId));
          try {
            await refreshFilesOnly();
          } catch (refreshError) {
            fileErrors.push(`잠시 연결이 불안정해 파일 목록을 새로고침하지 못했어요: ${readableError(refreshError)}`);
          }
        }
      }

      try {
        await refreshState({ silent: true });
      } catch (refreshError) {
        fileErrors.push(`잠시 연결이 불안정해 요약 정보를 새로고침하지 못했어요: ${readableError(refreshError)}`);
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }

    if (fileErrors.length > 0) {
      setAppError(`일부 업로드에 실패했습니다. ${summarizeUploadErrors(fileErrors)}`);
    }
  }

  async function triggerDelete(fileId: string): Promise<void> {
    setAppError(null);
    try {
      const response = await sendVaultMessage<{ ok: boolean; deletedFileId?: string; error?: string }>({
        type: "vault:delete-file",
        fileId,
      });
      if (!response?.ok) {
        throw new Error(response.error ?? "파일 삭제에 실패했습니다.");
      }
      await refreshState({ silent: true });
    } catch (error) {
      setAppError(readableError(error));
    }
  }

  async function revokePermission(key: string): Promise<void> {
    setRevokingPermissionKey(key);
    setAppError(null);
    try {
      const response = await sendVaultMessage<{ ok: true } | { ok: false; error: string }>({
        type: "vault:revoke-permission",
        key,
      });
      if (!response?.ok) {
        throw new Error(response.error ?? "자동 공유 해제에 실패했습니다.");
      }
      await refreshPermissions();
    } catch (error) {
      setAppError(readableError(error));
    } finally {
      setRevokingPermissionKey(null);
    }
  }

  function moveToAiConnection(): void {
    aiConnectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (loading) {
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

  if (!state) {
    return (
      <main className="min-h-screen bg-background p-6 text-foreground">
        <div className="mx-auto max-w-3xl rounded-2xl border border-destructive/30 bg-card p-6 shadow-card">
          <h1 className="text-xl font-semibold">Vault 상태를 불러오지 못했습니다</h1>
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
                } catch (loadError) {
                  setAppError(await withConnectionHint(loadError));
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

  const { session, settings } = state;
  const lockoutSeconds = lockoutUntil ? Math.max(0, Math.ceil((lockoutUntil - nowMs) / 1000)) : 0;
  const guide = lockoutSeconds > 0 ? lockoutGuide(lockoutSeconds) : null;
  const lockoutStageLabel = lockoutSeconds >= 300
    ? "강화 잠금"
    : lockoutSeconds >= 60
      ? "보호 잠금"
      : lockoutSeconds > 0
        ? "잠시 대기"
        : null;
  const isBusy = uploading || refreshing || isSettingPin || isUnlocking || isLocking || Boolean(settingProvider);

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
                onClick={() => void lock()}
                disabled={isLocking || refreshing}
              >
                {isLocking ? "잠그는 중..." : "잠그기"}
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
                    void refreshState();
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

        {appError && (
          <section className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
            <div className="flex items-start justify-between gap-3">
              <span>{appError}</span>
              <button type="button" className="rounded border border-destructive/30 px-2 py-1 text-sm" onClick={() => setAppError(null)}>
                닫기
              </button>
            </div>
          </section>
        )}

        {!session.hasPin && (
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

        {session.hasPin && !session.isUnlocked && (
          <UnlockSection
            guide={guide}
            lockoutSeconds={lockoutSeconds}
            lockoutStageLabel={lockoutStageLabel}
            pin={pin}
            authError={authError}
            isUnlocking={isUnlocking}
            onPinChange={setPin}
            onSubmit={unlock}
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
                  자동 공유 {permissions.length}개
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {summaryEntries.length === 0 && (
                  <div className="col-span-full rounded-xl border border-dashed border-border bg-secondary/30 px-4 py-6 text-sm text-muted-foreground">
                    기록을 올리면 여기에 요약이 표시됩니다.
                  </div>
                )}

                {summaryEntries.map(([type, count]) => (
                  <div key={type} className="rounded-xl border border-border bg-accent px-4 py-4">
                    <div className="text-sm text-accent-foreground">{resourceLabel(type)}</div>
                    <div className="mt-1 text-2xl font-semibold text-accent-foreground">{count}건</div>
                  </div>
                ))}
              </div>
            </section>

            <UploadSection
              hasFiles={visibleFiles.length > 0}
              uploading={uploading}
              isBusy={isBusy}
              fileInputRef={fileInputRef}
              uploadFiles={uploadFiles}
              moveToAiConnection={moveToAiConnection}
              visibleFiles={visibleFiles}
              statusTone={statusTone}
              triggerDownload={triggerDownload}
              triggerDelete={triggerDelete}
            />

            <ProviderSection
              aiConnectionRef={aiConnectionRef}
              hasFiles={state.files.length > 0}
              connectedProvider={settings.connectedProvider}
              settingProvider={settingProvider}
              setProvider={setProvider}
            />

            <PermissionSection
              permissions={permissions}
              revokingKey={revokingPermissionKey}
              onRevoke={revokePermission}
            />

            <AuditLogSection auditLogs={state.auditLogs} />
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
