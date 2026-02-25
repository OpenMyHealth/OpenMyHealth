import type { SidepanelElements } from "./dom";
import type { UIState } from "./state";

export function showToast(el: SidepanelElements, message: string, type: "ok" | "error" = "ok"): void {
  el.toast.textContent = message;
  el.toast.dataset.type = type;
  el.toast.classList.add("show");
  window.setTimeout(() => {
    el.toast.classList.remove("show");
  }, 2600);
}

export function updateStatusBadge(ui: UIState, el: SidepanelElements): void {
  if (!ui.appState) return;

  if (!ui.appState.vaultInitialized) {
    el.statusBadge.textContent = "금고 미설정";
    el.statusBadge.dataset.mode = "idle";
    return;
  }

  if (!ui.appState.unlocked) {
    el.statusBadge.textContent = "잠김";
    el.statusBadge.dataset.mode = "warn";
    return;
  }

  el.statusBadge.textContent = "잠금 해제";
  el.statusBadge.dataset.mode = "ok";
}

export function renderAuthCard(ui: UIState, el: SidepanelElements): void {
  if (!ui.appState) return;

  if (!ui.appState.vaultInitialized) {
    el.authTitle.textContent = "건강 금고 만들기";
    el.authHint.textContent = "이 비밀번호로 로컬 금고가 암호화됩니다. 서버에 저장되지 않습니다.";
    el.passphraseConfirmInput.style.display = "block";
    el.passphraseInput.style.display = "block";
    el.passphraseInput.disabled = false;
    el.passphraseConfirmInput.disabled = false;
    el.authActionButton.textContent = "금고 생성";
    el.authActionButton.disabled = false;
    el.lockButton.style.display = "none";
    return;
  }

  if (!ui.appState.unlocked) {
    el.authTitle.textContent = "건강 금고 잠금 해제";
    el.authHint.textContent = "비밀번호를 입력하면 이 기기에서만 데이터가 복호화됩니다.";
    el.passphraseConfirmInput.style.display = "none";
    el.passphraseInput.style.display = "block";
    el.passphraseInput.disabled = false;
    el.authActionButton.textContent = "잠금 해제";
    el.authActionButton.disabled = false;
    el.lockButton.style.display = "none";
    return;
  }

  el.authTitle.textContent = "건강 금고";
  el.authHint.textContent = "데이터는 로컬에 암호화 저장되며, 승인한 항목만 AI에 전달됩니다.";
  el.passphraseInput.style.display = "none";
  el.passphraseConfirmInput.style.display = "none";
  el.authActionButton.textContent = "잠금 해제됨";
  el.authActionButton.disabled = true;
  el.lockButton.style.display = "inline-flex";
}

export function renderSources(ui: UIState, el: SidepanelElements): void {
  if (!ui.appState) return;

  const html = ui.appState.adapters
    .map((adapter) => {
      const connectedLabel = adapter.connected ? `연동됨 · ${adapter.recordCount}건` : "미연동";
      const lastSync = adapter.lastSyncedAt ? new Date(adapter.lastSyncedAt).toLocaleString() : "-";

      return `
        <article class="source-card">
          <header>
            <h3>${escapeHtml(adapter.name)}</h3>
            <span class="country">${escapeHtml(adapter.country)}</span>
          </header>
          <p>${escapeHtml(adapter.description)}</p>
          <div class="source-meta">
            <span>${escapeHtml(connectedLabel)}</span>
            <span>최근: ${escapeHtml(lastSync)}</span>
          </div>
          <button class="secondary" data-source-connect="${escapeHtml(adapter.id)}">연동 가이드 시작</button>
        </article>
      `;
    })
    .join("");

  el.sourceList.innerHTML = html || '<p class="empty">사용 가능한 소스가 없습니다.</p>';
}

export function renderSourceStatus(ui: UIState, el: SidepanelElements): void {
  if (!ui.appState?.activeSourceStatus) {
    el.sourceStatusWrap.style.display = "none";
    return;
  }

  const status = ui.appState.activeSourceStatus;
  const adapter = ui.appState.adapters.find((item) => item.id === status.sourceId);
  if (!adapter) {
    el.sourceStatusWrap.style.display = "none";
    return;
  }

  el.sourceStatusWrap.style.display = "block";
  el.sourceStatusTitle.textContent = `${adapter.name} 코파일럿 가이드`;

  const stepEntries = Object.entries(status.stepState);
  el.sourceStepList.innerHTML = stepEntries
    .map(([stepId, done]) => {
      const label = readableStepLabel(stepId);
      return `<li class="${done ? "done" : "pending"}">${done ? "✅" : "⬜"} ${escapeHtml(label)}</li>`;
    })
    .join("");

  el.sourceEstimate.textContent =
    status.estimatedRecordCount !== undefined
      ? `감지된 기록: ${status.estimatedRecordCount}건`
      : "아직 기록을 감지하지 못했습니다.";

  el.captureSourceButton.dataset.sourceId = status.sourceId;
}

export function renderCandidates(ui: UIState, el: SidepanelElements): void {
  const html = ui.candidates
    .map((candidate) => {
      const checked = ui.selectedIds.has(candidate.id) ? "checked" : "";
      return `
        <label class="candidate-item">
          <input type="checkbox" data-candidate-id="${escapeHtml(candidate.id)}" ${checked} />
          <div>
            <div class="candidate-title">${escapeHtml(candidate.title)} <span>${escapeHtml(candidate.date)}</span></div>
            <p>${escapeHtml(candidate.summary)}</p>
            <small>${escapeHtml(candidate.sourceName)} · score ${candidate.score.toFixed(3)}</small>
          </div>
        </label>
      `;
    })
    .join("");

  el.candidateList.innerHTML = html || '<p class="empty">검색 결과가 없습니다.</p>';
  el.buildPreviewButton.disabled = ui.selectedIds.size === 0;
}

export function renderTransferAudits(ui: UIState, el: SidepanelElements): void {
  if (!ui.appState?.unlocked) {
    el.transferList.innerHTML = '<p class="empty">금고 잠금 해제 후 전송 이력을 확인할 수 있습니다.</p>';
    return;
  }

  const rows = ui.appState.recentTransfers;
  if (!rows.length) {
    el.transferList.innerHTML = '<p class="empty">아직 AI 전송 이력이 없습니다.</p>';
    return;
  }

  el.transferList.innerHTML = rows
    .map((row) => {
      const when = new Date(row.createdAt).toLocaleString();
      const platform = row.platform === "unknown" ? "미확인" : row.platform;
      return `
        <div class="record-row">
          <div>
            <strong>${escapeHtml(row.query)}</strong>
            <p>${escapeHtml(when)} · ${escapeHtml(platform)} · ${row.recordCount}건 · 마스킹 ${row.redactionCount}건</p>
          </div>
        </div>
      `;
    })
    .join("");
}

export function readableStepLabel(stepId: string): string {
  const map: Record<string, string> = {
    auth: "본인인증 완료",
    "view-records": "진료기록 화면 표시",
    capture: "금고 저장",
  };
  return map[stepId] ?? stepId;
}

export function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
