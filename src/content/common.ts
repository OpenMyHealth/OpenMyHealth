import type { AIPlatform, SourceStatus } from "../shared/types";
import type { RuntimeMessage } from "../shared/messages";
import { findAdapterById, findAdapterByUrl } from "../shared/adapters";

function getActiveEditable(): HTMLElement | null {
  const preferred = [
    "textarea",
    "div[contenteditable='true']",
    "div[role='textbox'][contenteditable='true']",
    "input[type='text']",
  ];

  for (const selector of preferred) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) return el;
  }

  return null;
}

function setInputValue(target: HTMLElement, text: string): void {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
    target.focus();
    target.value = text;
    target.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }

  target.focus();
  target.textContent = text;
  target.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
}

export function initAiBridge(platform: AIPlatform): void {
  const readyMessage: RuntimeMessage = {
    type: "OMH_AI_PAGE_READY",
    platform,
  };

  chrome.runtime.sendMessage(readyMessage).catch(() => {
    // ignore
  });

  chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
    if (message.type !== "OMH_INSERT_CONTEXT") {
      return false;
    }

    const target = getActiveEditable();
    if (!target) {
      sendResponse({ ok: false, error: "입력창을 찾을 수 없습니다." });
      return false;
    }

    const block = [
      "[OpenMyHealth Approved Context]",
      message.payload.contextText,
      "",
      "[User Question]",
      message.payload.query,
    ].join("\n");

    setInputValue(target, block);
    sendResponse({ ok: true, inserted: true });
    return false;
  });
}

function clearPreviousHighlight(): void {
  document.querySelectorAll(".omh-source-highlight").forEach((el) => {
    el.classList.remove("omh-source-highlight");
  });
}

function ensureHighlightStyle(): void {
  if (document.getElementById("omh-highlight-style")) return;

  const style = document.createElement("style");
  style.id = "omh-highlight-style";
  style.textContent = `
    .omh-source-highlight {
      outline: 3px solid #00c26f !important;
      box-shadow: 0 0 0 4px rgba(0, 194, 111, 0.24) !important;
      transition: box-shadow .2s ease;
    }

    #omh-guide-overlay {
      position: fixed;
      right: 16px;
      bottom: 16px;
      width: min(360px, calc(100vw - 24px));
      background: linear-gradient(140deg, rgba(10, 35, 22, 0.97), rgba(8, 25, 17, 0.97));
      color: #e9fff2;
      border: 1px solid rgba(122, 214, 163, 0.4);
      border-radius: 14px;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.38);
      z-index: 2147483647;
      font-family: "Pretendard", "Noto Sans KR", "Segoe UI", sans-serif;
      overflow: hidden;
    }

    #omh-guide-overlay header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 12px;
      border-bottom: 1px solid rgba(122, 214, 163, 0.2);
      background: rgba(14, 57, 36, 0.55);
    }

    #omh-guide-overlay h2 {
      margin: 0;
      font-size: 13px;
      letter-spacing: -0.01em;
      font-weight: 700;
    }

    #omh-guide-overlay button {
      background: transparent;
      color: #c9f8dc;
      border: 1px solid rgba(122, 214, 163, 0.4);
      border-radius: 8px;
      font-size: 11px;
      padding: 4px 8px;
      cursor: pointer;
    }

    #omh-guide-overlay .body {
      padding: 10px 12px 12px;
    }

    #omh-guide-overlay .hint {
      margin: 0 0 8px;
      color: #b8ebce;
      font-size: 12px;
      line-height: 1.45;
    }

    #omh-guide-overlay ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 6px;
    }

    #omh-guide-overlay li {
      padding: 7px 8px;
      border-radius: 8px;
      font-size: 12px;
      line-height: 1.4;
      border: 1px solid transparent;
    }

    #omh-guide-overlay li.done {
      background: rgba(58, 162, 108, 0.2);
      border-color: rgba(93, 208, 145, 0.35);
      color: #d3ffea;
    }

    #omh-guide-overlay li.active {
      background: rgba(255, 195, 81, 0.18);
      border-color: rgba(255, 213, 128, 0.38);
      color: #ffe8b8;
    }

    #omh-guide-overlay li.pending {
      background: rgba(255, 255, 255, 0.04);
      border-color: rgba(255, 255, 255, 0.08);
      color: #d2eadc;
    }

    #omh-guide-overlay .foot {
      margin-top: 8px;
      color: #88d8af;
      font-size: 11px;
    }
  `;
  document.head.append(style);
}

function highlightFirstIncomplete(status: SourceStatus): void {
  const adapter = findAdapterById(status.sourceId);
  if (!adapter) return;

  ensureHighlightStyle();
  clearPreviousHighlight();

  const nextStep = adapter.guideSteps.find((step) => !status.stepState[step.id] && step.selector);
  if (!nextStep?.selector) {
    return;
  }

  const target = document.querySelector<HTMLElement>(nextStep.selector);
  if (!target) {
    return;
  }

  target.classList.add("omh-source-highlight");
  target.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
}

function removeGuideOverlay(): void {
  document.getElementById("omh-guide-overlay")?.remove();
}

function renderGuideOverlay(status: SourceStatus): void {
  const adapter = findAdapterById(status.sourceId);
  if (!adapter) {
    removeGuideOverlay();
    return;
  }

  ensureHighlightStyle();
  const hidden = sessionStorage.getItem(`omh.hide.${adapter.id}`) === "1";
  if (hidden) {
    removeGuideOverlay();
    return;
  }

  const allDone = adapter.guideSteps.every((step) => Boolean(status.stepState[step.id]));
  const nextStep = adapter.guideSteps.find((step) => !status.stepState[step.id]);
  const overlayId = "omh-guide-overlay";
  let overlay = document.getElementById(overlayId);
  if (!overlay) {
    overlay = document.createElement("aside");
    overlay.id = overlayId;
    document.body.append(overlay);
  }

  const items = adapter.guideSteps
    .map((step) => {
      const done = Boolean(status.stepState[step.id]);
      const isActive = !done && nextStep?.id === step.id;
      const cls = done ? "done" : isActive ? "active" : "pending";
      const marker = done ? "✅" : isActive ? "👉" : "⬜";
      return `<li class="${cls}">${marker} ${escapeHtml(step.title)}<br/><small>${escapeHtml(step.description)}</small></li>`;
    })
    .join("");

  const estimate =
    status.estimatedRecordCount !== undefined
      ? `감지된 기록 ${status.estimatedRecordCount}건`
      : "기록 감지 대기 중";

  overlay.innerHTML = `
    <header>
      <h2>🛡️ OpenMyHealth 코파일럿 · ${escapeHtml(adapter.name)}</h2>
      <button type="button" id="omh-guide-close">숨기기</button>
    </header>
    <div class="body">
      <p class="hint">${
        allDone
          ? "준비 완료. Side Panel에서 [이 페이지 데이터 가져오기]를 눌러 저장하세요."
          : "본인인증/조회는 사이트에서 직접 진행하세요. OpenMyHealth는 인증정보를 저장하지 않습니다."
      }</p>
      <ul>${items}</ul>
      <div class="foot">${escapeHtml(estimate)}</div>
    </div>
  `;

  overlay.querySelector<HTMLButtonElement>("#omh-guide-close")?.addEventListener("click", () => {
    sessionStorage.setItem(`omh.hide.${adapter.id}`, "1");
    removeGuideOverlay();
  });
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function createLiveSourceStatus(sourceId: string): SourceStatus | null {
  const adapter = findAdapterById(sourceId) ?? findAdapterByUrl(location.href);
  if (!adapter) return null;
  const stepState = adapter.detectStepState(document);
  const estimatedRecordCount = adapter.parseRawRecords(document).length;
  return {
    sourceId: adapter.id,
    supported: true,
    url: location.href,
    stepState,
    estimatedRecordCount,
  };
}

function startSourceCopilotLoop(sourceId: string): void {
  const refresh = () => {
    const status = createLiveSourceStatus(sourceId);
    if (!status) return;
    highlightFirstIncomplete(status);
    renderGuideOverlay(status);
  };
  refresh();
  window.setInterval(refresh, 2200);
}

export function initSourceBridge(): void {
  chrome.runtime.sendMessage({ type: "OMH_SOURCE_PAGE_READY" as const }).catch(() => {
    // ignore
  });

  const activeAdapter = findAdapterByUrl(location.href);
  if (activeAdapter) {
    startSourceCopilotLoop(activeAdapter.id);
  }

  chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
    if (message.type === "OMH_GET_SOURCE_STATUS") {
      const status = createLiveSourceStatus(message.sourceId);
      if (!status) {
        sendResponse({ ok: false, error: "지원되지 않는 소스 페이지" });
        return false;
      }

      highlightFirstIncomplete(status);
      renderGuideOverlay(status);
      sendResponse({ ok: true, sourceStatus: status });
      return false;
    }

    if (message.type === "OMH_CAPTURE_SOURCE_PAGE") {
      const adapter = findAdapterById(message.sourceId) ?? findAdapterByUrl(location.href);
      if (!adapter) {
        sendResponse({ ok: false, error: "지원되지 않는 소스 페이지" });
        return false;
      }

      const records = adapter.parseRawRecords(document);
      sendResponse({ ok: true, records });
      return false;
    }

    return false;
  });
}
