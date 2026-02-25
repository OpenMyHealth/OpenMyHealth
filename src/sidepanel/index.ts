import type { RuntimeMessage, RuntimeResponse } from "../shared/messages";
import { getSidepanelElements } from "./dom";
import { createInitialUIState } from "./state";
import {
  escapeHtml,
  renderAuthCard,
  renderCandidates,
  renderSourceStatus,
  renderSources,
  renderTransferAudits,
  showToast,
  updateStatusBadge,
} from "./view";

const ui = createInitialUIState();
const el = getSidepanelElements();

async function sendMessage(message: RuntimeMessage): Promise<RuntimeResponse> {
  return chrome.runtime.sendMessage(message) as Promise<RuntimeResponse>;
}

function resetPreview(): void {
  ui.preview = null;
  el.previewTextarea.value = "";
  el.insertButton.disabled = true;
}

function renderPreview(): void {
  if (!ui.preview) {
    el.previewTextarea.value = "";
    el.insertButton.disabled = true;
    return;
  }

  el.previewTextarea.value = `${ui.preview.contextText}\n\n[Redactions] ${ui.preview.redactionCount}`;
  el.insertButton.disabled = false;
}

async function renderRecords(): Promise<void> {
  if (!ui.appState?.unlocked) {
    el.recordsList.innerHTML = '<p class="empty">금고 잠금 해제 후 기록을 확인할 수 있습니다.</p>';
    return;
  }

  const res = await sendMessage({ type: "OMH_LIST_RECORDS", limit: 30 });
  if (!res.ok || !("records" in res)) {
    el.recordsList.innerHTML = '<p class="empty">기록을 불러오지 못했습니다.</p>';
    return;
  }

  const html = res.records
    .map(
      (record) => `
      <div class="record-row">
        <div>
          <strong>${escapeHtml(record.title)}</strong>
          <p>${escapeHtml(record.sourceName)} · ${escapeHtml(record.date)}</p>
        </div>
        <button class="danger" data-delete-record="${escapeHtml(record.id)}">삭제</button>
      </div>
    `,
    )
    .join("");

  el.recordsList.innerHTML = html || '<p class="empty">저장된 기록이 없습니다.</p>';
}

async function refreshAll(): Promise<void> {
  const res = await sendMessage({ type: "OMH_GET_APP_STATE" });
  if (!res.ok || !("state" in res)) {
    showToast(el, res.ok ? "상태를 가져오지 못했습니다." : res.error, "error");
    return;
  }

  ui.appState = res.state;
  updateStatusBadge(ui, el);
  renderAuthCard(ui, el);
  renderSources(ui, el);
  renderSourceStatus(ui, el);
  await renderRecords();
  renderTransferAudits(ui, el);
}

async function submitAuth(): Promise<void> {
  const passphrase = el.passphraseInput.value.trim();
  if (passphrase.length < 8) {
    showToast(el, "비밀번호는 8자 이상이어야 합니다.", "error");
    return;
  }

  if (!ui.appState?.vaultInitialized) {
    if (passphrase !== el.passphraseConfirmInput.value.trim()) {
      showToast(el, "비밀번호 확인 값이 일치하지 않습니다.", "error");
      return;
    }

    const created = await sendMessage({ type: "OMH_SET_PASSPHRASE", passphrase });
    if (!created.ok) {
      showToast(el, created.error, "error");
      return;
    }

    showToast(el, "건강 금고를 생성했습니다.");
    el.passphraseInput.value = "";
    el.passphraseConfirmInput.value = "";
    await refreshAll();
    return;
  }

  const unlocked = await sendMessage({ type: "OMH_UNLOCK_VAULT", passphrase });
  if (!unlocked.ok || !("unlocked" in unlocked) || !unlocked.unlocked) {
    showToast(el, unlocked.ok ? "잠금 해제에 실패했습니다." : unlocked.error, "error");
    return;
  }

  showToast(el, "금고 잠금이 해제되었습니다.");
  el.passphraseInput.value = "";
  await refreshAll();
}

async function lockVault(): Promise<void> {
  const res = await sendMessage({ type: "OMH_LOCK_VAULT" });
  if (!res.ok) {
    showToast(el, res.error, "error");
    return;
  }
  showToast(el, "금고를 잠갔습니다.");
  ui.selectedIds.clear();
  ui.candidates = [];
  resetPreview();
  await refreshAll();
}

async function startGuide(sourceId: string): Promise<void> {
  const res = await sendMessage({ type: "OMH_START_SOURCE_GUIDE", sourceId });
  if (!res.ok) {
    showToast(el, res.error, "error");
    return;
  }
  showToast(el, "소스 가이드를 시작했습니다.");
  window.setTimeout(() => {
    refreshAll().catch(() => {
      // no-op
    });
  }, 800);
}

async function refreshSourceStatus(): Promise<void> {
  const res = await sendMessage({ type: "OMH_GET_ACTIVE_SOURCE_STATUS" });
  if (!res.ok || !("sourceStatus" in res)) {
    return;
  }

  if (!ui.appState) return;
  ui.appState.activeSourceStatus = res.sourceStatus;
  renderSourceStatus(ui, el);
}

async function captureSource(sourceId: string): Promise<void> {
  const res = await sendMessage({ type: "OMH_CAPTURE_ACTIVE_SOURCE", sourceId });
  if (!res.ok) {
    showToast(el, res.error, "error");
    return;
  }

  if ("capturedCount" in res) {
    showToast(el, `기록 ${res.capturedCount}건을 금고에 저장했습니다.`);
  }
  await refreshAll();
}

async function addManualRecord(): Promise<void> {
  const title = el.manualTitleInput.value.trim();
  const summary = el.manualSummaryInput.value.trim();
  const date = el.manualDateInput.value.trim();
  const tags = el.manualTagsInput.value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const res = await sendMessage({
    type: "OMH_ADD_MANUAL_RECORD",
    input: {
      title,
      summary,
      date,
      tags,
    },
  });

  if (!res.ok) {
    showToast(el, res.error, "error");
    return;
  }

  el.manualTitleInput.value = "";
  el.manualSummaryInput.value = "";
  el.manualTagsInput.value = "";
  showToast(el, "수동 기록을 저장했습니다.");
  await refreshAll();
}

async function searchCandidates(): Promise<void> {
  const query = el.queryInput.value.trim();
  if (!query) {
    showToast(el, "질문을 입력하세요.", "error");
    return;
  }

  const res = await sendMessage({ type: "OMH_SEARCH_CANDIDATES", query, limit: 15 });
  if (!res.ok || !("candidates" in res)) {
    showToast(el, res.ok ? "검색 실패" : res.error, "error");
    return;
  }

  ui.candidates = res.candidates;
  ui.selectedIds = new Set(res.candidates.slice(0, 5).map((item) => item.id));
  ui.previewQuery = query;
  resetPreview();
  renderCandidates(ui, el);
}

async function buildPreview(): Promise<void> {
  const query = ui.previewQuery || el.queryInput.value.trim();
  const ids = [...ui.selectedIds];
  if (!query || ids.length === 0) {
    showToast(el, "선택된 후보가 없습니다.", "error");
    return;
  }

  const res = await sendMessage({
    type: "OMH_BUILD_APPROVAL_PREVIEW",
    query,
    ids,
  });

  if (!res.ok || !("preview" in res)) {
    showToast(el, res.ok ? "미리보기 생성 실패" : res.error, "error");
    return;
  }

  ui.preview = res.preview;
  ui.previewQuery = res.preview.query;
  renderPreview();
}

async function insertToChat(): Promise<void> {
  if (!ui.preview) {
    showToast(el, "먼저 미리보기를 생성하세요.", "error");
    return;
  }

  const res = await sendMessage({
    type: "OMH_INSERT_CONTEXT_TO_CHAT",
    preview: ui.preview,
  });

  if (!res.ok) {
    showToast(el, res.error, "error");
    return;
  }

  showToast(el, "승인된 컨텍스트를 채팅 입력창에 넣었습니다.");
  await refreshAll();
}

async function deleteRecord(id: string): Promise<void> {
  const res = await sendMessage({ type: "OMH_DELETE_RECORD", id });
  if (!res.ok || !("deleted" in res) || !res.deleted) {
    showToast(el, res.ok ? "삭제 실패" : res.error, "error");
    return;
  }

  showToast(el, "기록을 삭제했습니다.");
  await refreshAll();
}

function bindEvents(): void {
  el.authActionButton.addEventListener("click", () => {
    submitAuth().catch((error) => showToast(el, String(error), "error"));
  });

  el.lockButton.addEventListener("click", () => {
    lockVault().catch((error) => showToast(el, String(error), "error"));
  });

  el.sourceList.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const sourceId = target.getAttribute("data-source-connect");
    if (!sourceId) return;

    startGuide(sourceId).catch((error) => showToast(el, String(error), "error"));
  });

  el.captureSourceButton.addEventListener("click", () => {
    const sourceId = el.captureSourceButton.dataset.sourceId;
    if (!sourceId) {
      showToast(el, "현재 소스 페이지를 찾지 못했습니다.", "error");
      return;
    }

    captureSource(sourceId).catch((error) => showToast(el, String(error), "error"));
  });

  el.manualSaveButton.addEventListener("click", () => {
    addManualRecord().catch((error) => showToast(el, String(error), "error"));
  });

  el.searchButton.addEventListener("click", () => {
    searchCandidates().catch((error) => showToast(el, String(error), "error"));
  });

  el.candidateList.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement;
    const candidateId = target.getAttribute("data-candidate-id");
    if (!candidateId) return;

    if (target.checked) {
      ui.selectedIds.add(candidateId);
    } else {
      ui.selectedIds.delete(candidateId);
    }
    resetPreview();
    renderCandidates(ui, el);
  });

  el.buildPreviewButton.addEventListener("click", () => {
    buildPreview().catch((error) => showToast(el, String(error), "error"));
  });

  el.insertButton.addEventListener("click", () => {
    insertToChat().catch((error) => showToast(el, String(error), "error"));
  });

  el.refreshRecordsButton.addEventListener("click", () => {
    renderRecords().catch((error) => showToast(el, String(error), "error"));
  });

  el.recordsList.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const id = target.getAttribute("data-delete-record");
    if (!id) return;

    deleteRecord(id).catch((error) => showToast(el, String(error), "error"));
  });
}

async function main(): Promise<void> {
  bindEvents();
  await refreshAll();

  window.setInterval(() => {
    refreshSourceStatus().catch(() => {
      // no-op
    });
  }, 2500);
}

main().catch((error) => {
  showToast(el, String(error), "error");
});
