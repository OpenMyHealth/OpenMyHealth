import { useEffect, useMemo, useRef, useState } from "react";
import type { AiProvider, PermissionLevel, ResourceType } from "../../packages/contracts/src/index";
import {
  defaultSelectedItemIds,
  filterSelectedItems,
  getFocusableElements,
  isStaleRequestError,
  stageColor,
  stageGuide,
} from "./overlay-utils";
import type { OverlayEvent } from "../core/messages";
import type { McpApprovalRequest } from "../core/models";
import { sendRuntimeMessage, type RuntimeOkEnvelope } from "../core/runtime-client";
import { providerLabel, secondsUntil } from "../core/utils";
import { setupPageMcpBridge } from "./page-bridge";

export type Mode = "hidden" | "unlock" | "approval" | "timeout" | "resolved" | "connected";
export type RetryAction = "open-vault" | "approve" | "deny";

const MESSAGE_TIMEOUT_MS = 20_000;

type ResponseEnvelope = RuntimeOkEnvelope & { error?: string; status?: "approved" | "denied" | "error" };

async function sendOverlayMessage(message: Record<string, unknown>): Promise<ResponseEnvelope> {
  return sendRuntimeMessage<ResponseEnvelope>(message, {
    timeoutMs: MESSAGE_TIMEOUT_MS,
    timeoutMessage: "확장 프로그램 응답 시간이 초과되었습니다.",
    invalidResponseMessage: "확장 프로그램 응답이 올바르지 않습니다.",
    transportErrorMessage: "확장 프로그램과 통신하지 못했습니다.",
  });
}

function detectProvider(): AiProvider {
  if (location.hostname.includes("claude.ai")) {
    return "claude";
  }
  return "chatgpt";
}

export interface OverlayStateDeps {
  sendMessage: (msg: Record<string, unknown>) => Promise<ResponseEnvelope>;
  getProvider: () => AiProvider;
}

let lastKnownRequestId: string | null = null;

export function getLastKnownRequestId(): string | null {
  return lastKnownRequestId;
}

export function useOverlayState(deps?: OverlayStateDeps) {
  const sendMessage = deps?.sendMessage ?? sendOverlayMessage;
  const getProvider = deps?.getProvider ?? detectProvider;

  const [mode, setMode] = useState<Mode>("hidden");
  const [request, setRequest] = useState<McpApprovalRequest | null>(null);
  const [queueLength, setQueueLength] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<ResourceType[]>([]);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [itemSelectionCustomized, setItemSelectionCustomized] = useState(false);
  const [permissionLevel, setPermissionLevel] = useState<PermissionLevel>("one-time");
  const [resolvedText, setResolvedText] = useState("");
  const [connectedText, setConnectedText] = useState("");
  const [nowMs, setNowMs] = useState(Date.now());
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [retryAction, setRetryAction] = useState<RetryAction | null>(null);
  const [alwaysConfirmPending, setAlwaysConfirmPending] = useState(false);
  const [openingVault, setOpeningVault] = useState(false);
  const [decisionPending, setDecisionPending] = useState(false);
  const [timerAnnouncement, setTimerAnnouncement] = useState("");

  const activeRequestIdRef = useRef<string | null>(null);
  const announcedTimerMarksRef = useRef<Set<number>>(new Set());
  const previousModeRef = useRef<Mode>("hidden");
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const primaryButtonRef = useRef<HTMLButtonElement | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const remainingMs = request ? Math.max(0, request.deadlineAt - nowMs) : 0;
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const stage = stageColor(remainingMs);
  const lockoutSeconds = secondsUntil(lockoutUntil);

  function clearHideTimer(): void {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }

  function scheduleHide(delayMs = 3000): void {
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => {
      setMode("hidden");
      hideTimerRef.current = null;
    }, delayMs);
  }

  function resetTimerAnnouncement(): void {
    announcedTimerMarksRef.current.clear();
    setTimerAnnouncement("");
  }

  function acknowledgeApprovalRendered(requestId: string): void {
    void sendMessage({
      type: "overlay:approval-rendered",
      requestId,
    }).catch(() => {
      // Background watchdog will fail-safe if ACK is not observed.
    });
  }

  function applyIncomingRequest(message: {
    request: McpApprovalRequest;
    queueLength: number;
  }): void {
    clearHideTimer();
    resetTimerAnnouncement();
    setRequest(message.request);
    setQueueLength(message.queueLength);
    setSelectedItemIds(defaultSelectedItemIds(message.request));
    setItemSelectionCustomized(false);
    setActionError(null);
    setRetryAction(null);
  }

  function applyPreviewUpdate(message: {
    request: McpApprovalRequest;
    queueLength: number;
  }): void {
    setQueueLength(message.queueLength);
    if (!itemSelectionCustomized) {
      setSelectedItemIds(defaultSelectedItemIds(message.request));
    }
    setRequest((current) => {
      if (!current || current.id !== message.request.id) {
        return current;
      }
      return {
        ...current,
        extensionSummary: message.request.extensionSummary,
        resourceOptions: message.request.resourceOptions,
      };
    });
  }

  function showResolvedStatus(status: "approved" | "denied" | "timeout" | "error"): void {
    if (status === "timeout") {
      setMode("timeout");
      scheduleHide(3000);
      return;
    }
    const map: Record<Exclude<typeof status, "timeout">, string> = {
      approved: "전송되었습니다.",
      denied: "거절되었습니다.",
      error: "잠시 연결이 불안정해요. 잠시 후 다시 시도해 주세요.",
    };
    setResolvedText(map[status]);
    setMode("resolved");
    setRetryAction(null);
    scheduleHide(3000);
  }

  // Track active request ID
  useEffect(() => {
    activeRequestIdRef.current = request?.id ?? null;
    lastKnownRequestId = request?.id ?? null;
  }, [request?.id]);

  // Focus management
  useEffect(() => {
    const previousMode = previousModeRef.current;
    if (previousMode === "hidden" && mode !== "hidden") {
      previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      (primaryButtonRef.current ?? dialogRef.current)?.focus();
    }
    if (previousMode !== "hidden" && mode === "hidden") {
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    }
    previousModeRef.current = mode;
  }, [mode]);

  // Bridge + message listener setup
  useEffect(() => {
    const teardownBridge = setupPageMcpBridge(getProvider);
    const provider = getProvider();
    void sendMessage({ type: "overlay:ready", provider }).catch(() => {
      setActionError("확장 프로그램과 연결하지 못했습니다. 페이지를 새로고침해 주세요.");
    });

    const listener = (message: OverlayEvent) => {
      if (message.type === "overlay:request-unlock") {
        applyIncomingRequest(message);
        setLockoutUntil(message.lockoutUntil);
        setMode("unlock");
      }

      if (message.type === "overlay:show-approval") {
        applyIncomingRequest(message);
        setSelected(message.request.resourceTypes);
        setPermissionLevel("one-time");
        setDetailOpen(false);
        setLockoutUntil(null);
        setAlwaysConfirmPending(false);
        setMode("approval");
      }

      if (message.type === "overlay:update-approval") {
        applyPreviewUpdate(message);
      }

      if (message.type === "overlay:queue") {
        setQueueLength(message.queueLength);
      }

      if (message.type === "overlay:connection-success") {
        clearHideTimer();
        setConnectedText(`${providerLabel(message.provider)} 연결이 준비되었습니다.`);
        setMode("connected");
        scheduleHide(10000);
      }

      if (message.type === "overlay:resolved") {
        if (activeRequestIdRef.current !== message.requestId) {
          return;
        }
        resetTimerAnnouncement();
        showResolvedStatus(message.status);
      }

      return undefined;
    };

    browser.runtime.onMessage.addListener(listener);

    return () => {
      teardownBridge();
      browser.runtime.onMessage.removeListener(listener);
      clearHideTimer();
    };
  }, []);

  // Approval rendered ACK
  useEffect(() => {
    if ((mode !== "approval" && mode !== "unlock") || !request?.id) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      if (dialogRef.current?.isConnected) {
        acknowledgeApprovalRendered(request.id);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mode, request?.id]);

  // Timer interval
  useEffect(() => {
    if (mode !== "approval" && mode !== "unlock") {
      return;
    }
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
      if (lockoutUntil && Date.now() >= lockoutUntil) {
        setLockoutUntil(null);
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [mode, lockoutUntil]);

  // Reset timer on hide
  useEffect(() => {
    if (mode === "hidden") {
      resetTimerAnnouncement();
    }
  }, [mode]);

  // Timer announcements for accessibility
  useEffect(() => {
    if (mode !== "approval") {
      return;
    }
    const marks = announcedTimerMarksRef.current;
    if (remainingSeconds <= 5 && !marks.has(5)) {
      marks.add(5);
      setTimerAnnouncement("남은 시간이 5초입니다. 곧 자동으로 거절됩니다.");
      return;
    }
    if (remainingSeconds <= 15 && !marks.has(15)) {
      marks.add(15);
      setTimerAnnouncement("남은 시간이 15초입니다.");
    }
  }, [mode, remainingSeconds]);

  // Keyboard handler (Tab trap + Escape)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (mode === "hidden") {
        return;
      }
      if (event.key === "Tab") {
        const root = dialogRef.current;
        if (!root) {
          return;
        }
        const focusables = getFocusableElements(root);
        if (focusables.length === 0) {
          event.preventDefault();
          root.focus();
          return;
        }
        const rootNode = root.getRootNode();
        const activeElement = rootNode instanceof ShadowRoot
          ? (rootNode.activeElement as HTMLElement | null)
          : (document.activeElement as HTMLElement | null);
        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (event.shiftKey) {
          if (!activeElement || activeElement === first || !root.contains(activeElement)) {
            event.preventDefault();
            last.focus();
          }
          return;
        }

        if (!activeElement || activeElement === last || !root.contains(activeElement)) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (mode !== "approval") {
        return;
      }
      if (event.key === "Escape") {
        event.stopPropagation();
        void deny();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode, request?.id]);

  const itemTypeMap = useMemo(() => {
    const map = new Map<string, ResourceType>();
    for (const option of request?.resourceOptions ?? []) {
      for (const item of option.items) {
        map.set(item.id, option.resourceType);
      }
    }
    return map;
  }, [request?.resourceOptions]);

  async function openVault(): Promise<void> {
    setActionError(null);
    setRetryAction("open-vault");
    setOpeningVault(true);
    try {
      const response = await sendMessage({
        type: "overlay:open-vault",
      });
      if (!response?.ok) {
        setActionError(response?.error ?? "보관함을 열지 못했습니다. 잠시 후 다시 시도해 주세요.");
        return;
      }
      setRetryAction(null);
    } catch {
      setActionError("보관함을 열지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setOpeningVault(false);
    }
  }

  function applyDecisionResponse(response: ResponseEnvelope): boolean {
    if (!response?.ok) {
      if (isStaleRequestError(response.error)) {
        setResolvedText("요청이 종료되었습니다. 다시 질문해 주세요.");
        setMode("resolved");
        scheduleHide(3000);
        setActionError(null);
        setRetryAction(null);
        return true;
      }
      setActionError(response?.error ?? "잠시 연결이 불안정해요. 잠시 후 다시 시도해 주세요.");
      return false;
    }

    if (response.status) {
      showResolvedStatus(response.status);
    }
    setActionError(null);
    setRetryAction(null);
    return true;
  }

  async function approve(): Promise<void> {
    if (!request) {
      return;
    }

    if (selected.length === 0) {
      setActionError("최소 한 개 항목을 선택해 주세요.");
      return;
    }
    const itemSelection = filterSelectedItems(selected, selectedItemIds, itemTypeMap);
    if (detailOpen && itemTypeMap.size > 0 && itemSelectionCustomized && itemSelection.length === 0) {
      setActionError("최소 한 개 항목을 선택해 주세요.");
      return;
    }
    if (itemSelectionCustomized && permissionLevel === "always") {
      setActionError("개별 항목 선택에서는 항상 허용을 사용할 수 없습니다.");
      return;
    }

    setRetryAction("approve");
    setDecisionPending(true);
    try {
      const response = await sendMessage({
        type: "approval:decision",
        requestId: request.id,
        decision: "approved",
        selectedResourceTypes: selected,
        selectedItemIds: itemSelectionCustomized && itemSelection.length > 0 ? itemSelection : undefined,
        permissionLevel,
      });
      applyDecisionResponse(response);
    } catch {
      setActionError("잠시 연결이 불안정해요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setDecisionPending(false);
    }
  }

  async function deny(): Promise<void> {
    if (!request) {
      return;
    }

    setRetryAction("deny");
    setDecisionPending(true);
    try {
      const response = await sendMessage({
        type: "approval:decision",
        requestId: request.id,
        decision: "denied",
      });
      applyDecisionResponse(response);
    } catch {
      setActionError("잠시 연결이 불안정해요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setDecisionPending(false);
    }
  }

  function toggleType(type: ResourceType): void {
    setActionError(null);
    const typeItemIds = request?.resourceOptions
      ?.find((option) => option.resourceType === type)
      ?.items
      .map((item) => item.id) ?? [];
    setSelected((current) => {
      if (current.includes(type)) {
        if (typeItemIds.length > 0) {
          setSelectedItemIds((prev) => prev.filter((id) => !typeItemIds.includes(id)));
        }
        return current.filter((item) => item !== type);
      }
      if (typeItemIds.length > 0) {
        setSelectedItemIds((prev) => [...new Set([...prev, ...typeItemIds])]);
      }
      return [...current, type];
    });
  }

  function toggleItem(type: ResourceType, itemId: string): void {
    setActionError(null);
    setItemSelectionCustomized(true);
    if (permissionLevel === "always") {
      setPermissionLevel("one-time");
      setAlwaysConfirmPending(false);
    }
    const typeItemIds = request?.resourceOptions
      ?.find((option) => option.resourceType === type)
      ?.items
      .map((item) => item.id) ?? [];

    setSelectedItemIds((current) => {
      const next = current.includes(itemId)
        ? current.filter((id) => id !== itemId)
        : [...current, itemId];

      const hasAnySelectedForType = typeItemIds.some((id) => next.includes(id));
      setSelected((types) => {
        if (hasAnySelectedForType) {
          return types.includes(type) ? types : [...types, type];
        }
        return types.filter((resourceType) => resourceType !== type);
      });

      return next;
    });
  }

  function toggleAlwaysAllow(checked: boolean): void {
    setActionError(null);
    if (!checked) {
      setPermissionLevel("one-time");
      setAlwaysConfirmPending(false);
      return;
    }
    setAlwaysConfirmPending(true);
  }

  function confirmAlwaysAllow(): void {
    setPermissionLevel("always");
    setAlwaysConfirmPending(false);
  }

  function cancelAlwaysAllow(): void {
    setAlwaysConfirmPending(false);
  }

  async function retryLastAction(): Promise<void> {
    if (retryAction === "approve") {
      await approve();
      return;
    }
    if (retryAction === "deny") {
      await deny();
      return;
    }
    if (retryAction === "open-vault") {
      await openVault();
      return;
    }
    try {
      await sendMessage({ type: "overlay:ready", provider: getProvider() });
      setActionError(null);
    } catch {
      setActionError("확장 프로그램과 연결하지 못했습니다. 페이지를 새로고침해 주세요.");
    }
  }

  return {
    // State
    mode,
    request,
    queueLength,
    detailOpen,
    selected,
    selectedItemIds,
    itemSelectionCustomized,
    permissionLevel,
    resolvedText,
    connectedText,
    nowMs,
    lockoutUntil,
    actionError,
    retryAction,
    alwaysConfirmPending,
    openingVault,
    decisionPending,
    timerAnnouncement,

    // Derived
    remainingMs,
    remainingSeconds,
    stage,
    lockoutSeconds,

    // Refs
    dialogRef,
    primaryButtonRef,

    // Setters
    setMode,
    setDetailOpen,

    // Actions
    approve,
    deny,
    openVault,
    toggleType,
    toggleItem,
    toggleAlwaysAllow,
    confirmAlwaysAllow,
    cancelAlwaysAllow,
    retryLastAction,
  };
}
