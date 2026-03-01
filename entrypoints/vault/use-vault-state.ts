import { useEffect, useMemo, useRef, useState } from "react";
import type { AiProvider, ResourceType } from "../../packages/contracts/src/index";
import { MAX_UPLOAD_BYTES } from "../../src/core/constants";
import type { VaultStateResponse } from "../../src/core/messages";
import type { VaultFileSummary, VaultPermissionScope } from "../../src/core/models";
import { secondsUntil } from "../../src/core/utils";
import {
  humanizeUploadError,
  lockoutGuide,
  readableError,
  sendUploadMessage as defaultSendUploadMessage,
  sendVaultMessage as defaultSendVaultMessage,
  summarizeUploadErrors,
  withConnectionHint,
} from "./runtime";

type OkEnvelope = { ok: boolean; error?: string };

export interface VaultStateDeps {
  sendVaultMessage?: <T extends OkEnvelope>(msg: Record<string, unknown>) => Promise<T>;
  sendUploadMessage?: <T extends OkEnvelope>(msg: Record<string, unknown>) => Promise<T>;
}

export function useVaultState(deps?: VaultStateDeps) {
  const sendVaultMessage = deps?.sendVaultMessage ?? defaultSendVaultMessage;
  const sendUploadMessage = deps?.sendUploadMessage ?? defaultSendUploadMessage;

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
      throw new Error((response as { error?: string }).error || "자동 공유 규칙을 불러오지 못했습니다.");
    }
    setPermissions((response as { ok: true; permissions: VaultPermissionScope[] }).permissions);
  }

  async function refreshState(options: { silent?: boolean } = {}): Promise<void> {
    const epoch = ++refreshEpochRef.current;
    if (!options.silent) {
      setRefreshing(true);
    }

    try {
      const response = await sendVaultMessage<VaultStateResponse | { ok: false; error: string }>({ type: "vault:get-state" });
      if (!response?.ok) {
        throw new Error((response as { error?: string }).error || "상태를 불러오지 못했습니다.");
      }
      if (epoch !== refreshEpochRef.current) {
        return;
      }
      const vaultState = response as VaultStateResponse;
      setState(vaultState);
      setLocale(vaultState.settings.locale || navigator.language || "ko-KR");
      setLockoutUntil(vaultState.session.lockoutUntil);
      setNowMs(Date.now());
      if (vaultState.session.isUnlocked) {
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
      throw new Error((response as { error?: string }).error || "파일 목록을 불러오지 못했습니다.");
    }
    setState((current) => (current ? { ...current, files: (response as { ok: true; files: VaultFileSummary[] }).files } : current));
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
        throw new Error((response as { error?: string }).error ?? "자동 공유 해제에 실패했습니다.");
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

  return {
    // State
    loading,
    refreshing,
    state,
    pin,
    confirmPin,
    locale,
    appError,
    authError,
    uploading,
    permissions,
    revokingPermissionKey,
    lockoutUntil,
    nowMs,
    isSettingPin,
    isUnlocking,
    isLocking,
    settingProvider,

    // Derived
    summaryEntries,
    visibleFiles,
    lockoutSeconds,
    guide,
    lockoutStageLabel,
    isBusy,

    // Refs
    fileInputRef,
    aiConnectionRef,

    // Setters
    setPin,
    setConfirmPin,
    setLocale,
    setAppError,

    // Actions
    setupPin,
    unlock,
    lock,
    setProvider,
    uploadFiles,
    triggerDownload,
    triggerDelete,
    revokePermission,
    moveToAiConnection,
    refreshState,
    withConnectionHint,
  };
}
