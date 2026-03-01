import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { useOverlayState, getLastKnownRequestId } from "../src/content/overlay-state";
import { retryLabel, stageGuide } from "../src/content/overlay-utils";
import { STYLE_TEXT } from "../src/content/style";
import { sendRuntimeMessage, type RuntimeOkEnvelope } from "../src/core/runtime-client";
import { providerLabel, resourceLabel } from "../src/core/utils";
import { ErrorBoundary } from "../src/components/error-boundary";

const MESSAGE_TIMEOUT_MS = 20_000;

type ResponseEnvelope = RuntimeOkEnvelope & { error?: string };

async function sendOverlayMessage(message: Record<string, unknown>): Promise<ResponseEnvelope> {
  return sendRuntimeMessage<ResponseEnvelope>(message, {
    timeoutMs: MESSAGE_TIMEOUT_MS,
    timeoutMessage: "확장 프로그램 응답 시간이 초과되었습니다.",
    invalidResponseMessage: "확장 프로그램 응답이 올바르지 않습니다.",
    transportErrorMessage: "확장 프로그램과 통신하지 못했습니다.",
  });
}

function OverlayApp(): React.ReactElement {
  const overlay = useOverlayState();

  if (overlay.mode === "hidden") {
    return <></>;
  }

  return (
    <div
      ref={overlay.dialogRef}
      className={`omh-shell ${overlay.mode === "timeout" ? "timeout" : overlay.stage}`}
      onClick={overlay.mode === "connected" ? () => overlay.setMode("hidden") : undefined}
      role={overlay.mode === "approval" || overlay.mode === "unlock" ? "dialog" : "status"}
      aria-labelledby={overlay.mode === "approval" || overlay.mode === "unlock" ? "omh-title" : undefined}
      aria-modal={overlay.mode === "approval" || overlay.mode === "unlock" ? "true" : undefined}
      aria-describedby={overlay.mode === "approval" || overlay.mode === "unlock" ? "omh-desc" : undefined}
      tabIndex={-1}
    >
      <div
        className="omh-progress"
        style={{ width: `${(overlay.remainingMs / 60_000) * 100}%` }}
        role="progressbar"
        aria-label="승인 남은 시간"
        aria-valuemin={0}
        aria-valuemax={60000}
        aria-valuenow={overlay.remainingMs}
      />

      {overlay.mode === "timeout" && (
        <div className="omh-content omh-timeout" role="status" aria-live="assertive">
          <h3 id="omh-title">시간이 초과되었습니다</h3>
          <p>{overlay.request ? `${providerLabel(overlay.request.provider)}에게 다시 질문해 주세요.` : "다시 시도해 주세요."}</p>
          <p className="omh-meta">3초 후 자동으로 닫힙니다.</p>
        </div>
      )}

      {overlay.mode === "resolved" && (
        <div className="omh-content" role="status" aria-live="assertive">
          <h3 id="omh-title">{overlay.resolvedText}</h3>
        </div>
      )}

      {overlay.mode === "connected" && (
        <div className="omh-content" role="status" aria-live="assertive">
          <h3 id="omh-title">연결 완료!</h3>
          <p>{overlay.connectedText}</p>
          <p className="omh-meta">추천 질문: 최근 혈액검사 결과를 정리해줘</p>
          <p className="omh-meta">추천 질문: 처방약 목록을 복용 시간대로 정리해줘</p>
          <p className="omh-meta">10초 후 자동으로 닫히며, 지금 클릭해도 닫을 수 있어요.</p>
        </div>
      )}

      {(overlay.mode === "unlock" || overlay.mode === "approval") && overlay.request && (
        <div className="omh-content">
          <button type="button" className="omh-close" aria-label="거절하고 닫기" onClick={() => void overlay.deny()}>
            ✕
          </button>

          <div className="omh-eyebrow">요청 앱: {providerLabel(overlay.request.provider)}</div>
          <div id="omh-title" className="omh-title">이번 요청에서 공유되는 항목</div>
          <div className="omh-summary">{overlay.request.extensionSummary}</div>
          <div className="omh-request">요청 문장: {overlay.request.aiDescription}</div>
          <div id="omh-desc" className="omh-desc">🔒 최소한의 데이터만 AI에게 전달됩니다</div>
          <div className="omh-time-row">
            <div className="omh-timer-ring" aria-hidden="true">{overlay.remainingSeconds}</div>
            <div className="omh-meta">자동 거절까지 {overlay.remainingSeconds}초</div>
          </div>
          {overlay.timerAnnouncement && <div className="omh-sr-only" role="status" aria-live="polite">{overlay.timerAnnouncement}</div>}

          {overlay.mode === "unlock" && (
            <div>
              <p className="omh-copy">
                PIN 입력은 보안을 위해 Vault에서만 가능합니다. 아래 버튼으로 Vault를 열어 계속해 주세요.
              </p>
              {overlay.lockoutSeconds > 0 && (
                <div className="omh-error" role="alert">
                  잠시만요. {overlay.lockoutSeconds}초 후 Vault에서 다시 시도해 주세요.
                </div>
              )}
              <button
                ref={overlay.primaryButtonRef}
                className="omh-primary"
                disabled={overlay.openingVault || overlay.decisionPending}
                type="button"
                onClick={() => void overlay.openVault()}
              >
                {overlay.openingVault ? "보관함 여는 중..." : "보관함 열기"}
              </button>
              {overlay.actionError && <div className="omh-error" role="alert">{overlay.actionError}</div>}
            </div>
          )}

          {overlay.mode === "approval" && (
            <>
              <button
                type="button"
                className="omh-link"
                onClick={() => overlay.setDetailOpen((v) => !v)}
                aria-expanded={overlay.detailOpen}
                aria-controls="omh-detail-panel"
              >
                {overlay.detailOpen ? "▾ 간단히 보기" : "▸ 상세 보기"}
              </button>

              {overlay.detailOpen && (
                <div id="omh-detail-panel" className="omh-detail" role="region" aria-label="공유 데이터 상세 선택">
                  {overlay.request.resourceTypes.map((type) => {
                    const option = overlay.request!.resourceOptions?.find((resource) => resource.resourceType === type);
                    const typeLabel = option ? `${resourceLabel(type)} (${option.count}건)` : resourceLabel(type);
                    return (
                      <div key={type} className="omh-type-group">
                        <label className="omh-checkbox-row">
                          <input
                            type="checkbox"
                            checked={overlay.selected.includes(type)}
                            onChange={() => overlay.toggleType(type)}
                          />
                          <span>{typeLabel}</span>
                        </label>
                        {overlay.selected.includes(type) && option?.items.map((item) => (
                          <label key={item.id} className="omh-sub-checkbox-row">
                            <input
                              type="checkbox"
                              checked={overlay.selectedItemIds.includes(item.id)}
                              onChange={() => overlay.toggleItem(type, item.id)}
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
                      checked={overlay.permissionLevel === "always"}
                      disabled={overlay.itemSelectionCustomized}
                      onChange={(event) => overlay.toggleAlwaysAllow(event.target.checked)}
                    />
                    <span>같은 요청 자동 허용 (다음부터 확인 생략)</span>
                  </label>
                  {overlay.itemSelectionCustomized && (
                    <div className="omh-meta">개별 항목 선택 중에는 항상 허용을 사용할 수 없습니다.</div>
                  )}

                  {overlay.alwaysConfirmPending && (
                    <div className="omh-confirm-inline">
                      <div className="omh-confirm-text">
                        앞으로 {overlay.selected.length > 0 ? overlay.selected.map(resourceLabel).join(", ") : "선택한 항목"} 요청은 확인 없이 자동 공유됩니다.
                        원치 않으면 지금 취소해 주세요. 해제는 Vault의 자동 공유 관리에서 언제든 가능합니다.
                      </div>
                      <div className="omh-confirm-actions">
                        <button type="button" className="omh-confirm-yes" onClick={overlay.confirmAlwaysAllow}>자동 허용 켜기</button>
                        <button type="button" className="omh-confirm-no" onClick={overlay.cancelAlwaysAllow}>취소</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="omh-actions">
                <button
                  ref={overlay.primaryButtonRef}
                  className={`omh-primary${overlay.stage === "red" ? " urgent" : ""}`}
                  onClick={() => void overlay.approve()}
                  disabled={overlay.selected.length === 0 || overlay.decisionPending}
                  type="button"
                >
                  {overlay.decisionPending ? "처리 중..." : "보내기"}
                </button>
                <button className="omh-secondary" onClick={() => void overlay.deny()} type="button" disabled={overlay.decisionPending}>
                  이번 요청 거절
                </button>
              </div>
              <div className="omh-meta">{stageGuide(overlay.remainingMs)}</div>
              {overlay.actionError && (
                <div className="omh-error" role="alert">
                  {overlay.actionError}
                  <button
                    type="button"
                    className="omh-link"
                    onClick={() => void overlay.retryLastAction()}
                  >
                    {retryLabel(overlay.retryAction)}
                  </button>
                </div>
              )}
            </>
          )}

          {overlay.queueLength > 0 && <div className="omh-queue" role="status" aria-live="polite">⏳ 추가 요청 {overlay.queueLength}건 대기 중</div>}
        </div>
      )}
    </div>
  );
}

function OverlayFallback({ error, reset }: { error: Error; reset: () => void }): React.ReactElement {
  useEffect(() => {
    const requestId = getLastKnownRequestId();
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
