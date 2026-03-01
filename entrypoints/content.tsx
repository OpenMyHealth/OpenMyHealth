import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AiProvider, PermissionLevel, ResourceType } from "../packages/contracts/src/index";
import { setupPageMcpBridge } from "../src/content/page-bridge";
import { STYLE_TEXT } from "../src/content/style";
import {
  defaultSelectedItemIds,
  filterSelectedItems,
  getFocusableElements,
  isStaleRequestError,
  retryLabel,
  stageColor,
  stageGuide,
} from "../src/content/overlay-utils";
import type { OverlayEvent } from "../src/core/messages";
import type { McpApprovalRequest } from "../src/core/models";
import { sendRuntimeMessage, type RuntimeOkEnvelope } from "../src/core/runtime-client";
import { providerLabel, resourceLabel, secondsUntil } from "../src/core/utils";
import { ErrorBoundary } from "../src/components/error-boundary";

type Mode = "hidden" | "unlock" | "approval" | "timeout" | "resolved" | "connected";
const MESSAGE_TIMEOUT_MS = 20_000;
type RetryAction = "open-vault" | "approve" | "deny";
let lastKnownRequestId: string | null = null;

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

function OverlayApp(): React.ReactElement {
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
    void sendOverlayMessage({
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

  useEffect(() => {
    activeRequestIdRef.current = request?.id ?? null;
    lastKnownRequestId = request?.id ?? null;
  }, [request?.id]);

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

  useEffect(() => {
    const teardownBridge = setupPageMcpBridge(detectProvider);
    const provider = detectProvider();
    void sendOverlayMessage({ type: "overlay:ready", provider }).catch(() => {
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

  useEffect(() => {
    if (mode === "hidden") {
      resetTimerAnnouncement();
    }
  }, [mode]);

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
      const response = await sendOverlayMessage({
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
      const response = await sendOverlayMessage({
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
      const response = await sendOverlayMessage({
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
      await sendOverlayMessage({ type: "overlay:ready", provider: detectProvider() });
      setActionError(null);
    } catch {
      setActionError("확장 프로그램과 연결하지 못했습니다. 페이지를 새로고침해 주세요.");
    }
  }

  if (mode === "hidden") {
    return <></>;
  }

  return (
    <div
      ref={dialogRef}
      className={`omh-shell ${mode === "timeout" ? "timeout" : stage}`}
      onClick={mode === "connected" ? () => setMode("hidden") : undefined}
      role={mode === "approval" || mode === "unlock" ? "dialog" : "status"}
      aria-labelledby={mode === "approval" || mode === "unlock" ? "omh-title" : undefined}
      aria-modal={mode === "approval" || mode === "unlock" ? "true" : undefined}
      aria-describedby={mode === "approval" || mode === "unlock" ? "omh-desc" : undefined}
      tabIndex={-1}
    >
      <div
        className="omh-progress"
        style={{ width: `${(remainingMs / 60_000) * 100}%` }}
        role="progressbar"
        aria-label="승인 남은 시간"
        aria-valuemin={0}
        aria-valuemax={60000}
        aria-valuenow={remainingMs}
      />

      {mode === "timeout" && (
        <div className="omh-content omh-timeout" role="status" aria-live="assertive">
          <h3 id="omh-title">시간이 초과되었습니다</h3>
          <p>{request ? `${providerLabel(request.provider)}에게 다시 질문해 주세요.` : "다시 시도해 주세요."}</p>
          <p className="omh-meta">3초 후 자동으로 닫힙니다.</p>
        </div>
      )}

      {mode === "resolved" && (
        <div className="omh-content" role="status" aria-live="assertive">
          <h3 id="omh-title">{resolvedText}</h3>
        </div>
      )}

      {mode === "connected" && (
        <div className="omh-content" role="status" aria-live="assertive">
          <h3 id="omh-title">연결 완료!</h3>
          <p>{connectedText}</p>
          <p className="omh-meta">추천 질문: 최근 혈액검사 결과를 정리해줘</p>
          <p className="omh-meta">추천 질문: 처방약 목록을 복용 시간대로 정리해줘</p>
          <p className="omh-meta">10초 후 자동으로 닫히며, 지금 클릭해도 닫을 수 있어요.</p>
        </div>
      )}

      {(mode === "unlock" || mode === "approval") && request && (
        <div className="omh-content">
          <button type="button" className="omh-close" aria-label="거절하고 닫기" onClick={() => void deny()}>
            ✕
          </button>

          <div className="omh-eyebrow">요청 앱: {providerLabel(request.provider)}</div>
          <div id="omh-title" className="omh-title">이번 요청에서 공유되는 항목</div>
          <div className="omh-summary">{request.extensionSummary}</div>
          <div className="omh-request">요청 문장: {request.aiDescription}</div>
          <div id="omh-desc" className="omh-desc">🔒 최소한의 데이터만 AI에게 전달됩니다</div>
          <div className="omh-time-row">
            <div className="omh-timer-ring" aria-hidden="true">{remainingSeconds}</div>
            <div className="omh-meta">자동 거절까지 {remainingSeconds}초</div>
          </div>
          {timerAnnouncement && <div className="omh-sr-only" role="status" aria-live="polite">{timerAnnouncement}</div>}

          {mode === "unlock" && (
            <div>
              <p className="omh-copy">
                PIN 입력은 보안을 위해 Vault에서만 가능합니다. 아래 버튼으로 Vault를 열어 계속해 주세요.
              </p>
              {lockoutSeconds > 0 && (
                <div className="omh-error" role="alert">
                  잠시만요. {lockoutSeconds}초 후 Vault에서 다시 시도해 주세요.
                </div>
              )}
              <button
                ref={primaryButtonRef}
                className="omh-primary"
                disabled={openingVault || decisionPending}
                type="button"
                onClick={() => void openVault()}
              >
                {openingVault ? "보관함 여는 중..." : "보관함 열기"}
              </button>
              {actionError && <div className="omh-error" role="alert">{actionError}</div>}
            </div>
          )}

          {mode === "approval" && (
            <>
              <button
                type="button"
                className="omh-link"
                onClick={() => setDetailOpen((v) => !v)}
                aria-expanded={detailOpen}
                aria-controls="omh-detail-panel"
              >
                {detailOpen ? "▾ 간단히 보기" : "▸ 상세 보기"}
              </button>

              {detailOpen && (
                <div id="omh-detail-panel" className="omh-detail" role="region" aria-label="공유 데이터 상세 선택">
                  {request.resourceTypes.map((type) => {
                    const option = request.resourceOptions?.find((resource) => resource.resourceType === type);
                    const typeLabel = option ? `${resourceLabel(type)} (${option.count}건)` : resourceLabel(type);
                    return (
                      <div key={type} className="omh-type-group">
                        <label className="omh-checkbox-row">
                          <input
                            type="checkbox"
                            checked={selected.includes(type)}
                            onChange={() => toggleType(type)}
                          />
                          <span>{typeLabel}</span>
                        </label>
                        {selected.includes(type) && option?.items.map((item) => (
                          <label key={item.id} className="omh-sub-checkbox-row">
                            <input
                              type="checkbox"
                              checked={selectedItemIds.includes(item.id)}
                              onChange={() => toggleItem(type, item.id)}
                            />
                            <span>{item.label}</span>
                          </label>
                        ))}
                      </div>
                    );
                  })}

                  <label className="omh-checkbox-row">
                    <input
                      type="checkbox"
                      checked={permissionLevel === "always"}
                      disabled={itemSelectionCustomized}
                      onChange={(event) => toggleAlwaysAllow(event.target.checked)}
                    />
                    <span>같은 요청 자동 허용 (다음부터 확인 생략)</span>
                  </label>
                  {itemSelectionCustomized && (
                    <div className="omh-meta">개별 항목 선택 중에는 항상 허용을 사용할 수 없습니다.</div>
                  )}

                  {alwaysConfirmPending && (
                    <div className="omh-confirm-inline">
                      <div className="omh-confirm-text">
                        앞으로 {selected.length > 0 ? selected.map(resourceLabel).join(", ") : "선택한 항목"} 요청은 확인 없이 자동 공유됩니다.
                        원치 않으면 지금 취소해 주세요. 해제는 Vault의 자동 공유 관리에서 언제든 가능합니다.
                      </div>
                      <div className="omh-confirm-actions">
                        <button type="button" className="omh-confirm-yes" onClick={confirmAlwaysAllow}>자동 허용 켜기</button>
                        <button type="button" className="omh-confirm-no" onClick={cancelAlwaysAllow}>취소</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="omh-actions">
                <button
                  ref={primaryButtonRef}
                  className={`omh-primary${stage === "red" ? " urgent" : ""}`}
                  onClick={() => void approve()}
                  disabled={selected.length === 0 || decisionPending}
                  type="button"
                >
                  {decisionPending ? "처리 중..." : "보내기"}
                </button>
                <button className="omh-secondary" onClick={() => void deny()} type="button" disabled={decisionPending}>
                  이번 요청 거절
                </button>
              </div>
              <div className="omh-meta">{stageGuide(remainingMs)}</div>
              {actionError && (
                <div className="omh-error" role="alert">
                  {actionError}
                  <button
                    type="button"
                    className="omh-link"
                    onClick={() => void retryLastAction()}
                  >
                    {retryLabel(retryAction)}
                  </button>
                </div>
              )}
            </>
          )}

          {queueLength > 0 && <div className="omh-queue" role="status" aria-live="polite">⏳ 추가 요청 {queueLength}건 대기 중</div>}
        </div>
      )}
    </div>
  );
}

function OverlayFallback({ error, reset }: { error: Error; reset: () => void }): React.ReactElement {
  useEffect(() => {
    const requestId = lastKnownRequestId;
    if (!requestId) {
      return;
    }
    void sendOverlayMessage({
      type: "overlay:render-failed",
      requestId,
    }).catch(() => {
      // Background watchdog covers fallback error paths.
    });
  }, []);

  return (
    <div className="omh-shell timeout" role="alert">
      <div className="omh-content omh-timeout">
        <h3 id="omh-title">OpenMyHealth 오버레이를 표시하지 못했습니다</h3>
        <p className="omh-meta">{error.message || "알 수 없는 오류"}</p>
        <div className="omh-actions">
          <button
            className="omh-primary"
            type="button"
            onClick={() => {
              reset();
              location.reload();
            }}
          >
            새로고침
          </button>
          <button className="omh-secondary" type="button" onClick={() => reset()}>
            다시 렌더링
          </button>
        </div>
      </div>
    </div>
  );
}

export default defineContentScript({
  matches: ["https://chatgpt.com/*", "https://claude.ai/*"],
  runAt: "document_idle",
  main() {
    const existing = document.getElementById("openmyhealth-overlay-root");
    if (existing) {
      existing.remove();
    }

    const host = document.createElement("div");
    host.id = "openmyhealth-overlay-root";
    host.style.position = "fixed";
    host.style.bottom = "max(16px, env(safe-area-inset-bottom))";
    host.style.right = "max(16px, env(safe-area-inset-right))";
    host.style.zIndex = "2147483647";

    const shadowRoot = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = STYLE_TEXT;

    const mount = document.createElement("div");

    shadowRoot.appendChild(style);
    shadowRoot.appendChild(mount);
    document.documentElement.appendChild(host);

    const root = createRoot(mount);
    root.render(
      <ErrorBoundary fallback={(error, reset) => <OverlayFallback error={error} reset={reset} />}>
        <OverlayApp />
      </ErrorBoundary>,
    );
  },
});
