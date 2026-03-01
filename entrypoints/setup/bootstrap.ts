const root = document.getElementById("root");

type BootState = {
  scriptLoaded: boolean;
  appMounted: boolean;
};

declare global {
  interface Window {
    __OMH_SETUP_BOOT_STATE__?: BootState;
  }
}

const bootState: BootState = window.__OMH_SETUP_BOOT_STATE__ ?? {
  scriptLoaded: false,
  appMounted: false,
};
bootState.scriptLoaded = true;
window.__OMH_SETUP_BOOT_STATE__ = bootState;

function renderBootstrapError(message: string): void {
  if (!root) {
    return;
  }

  root.innerHTML = `
    <main class="shell" role="alert">
      <h1 class="title">설정 화면을 시작하지 못했습니다</h1>
      <p class="copy">${message}</p>
      <button id="setup-retry-btn" class="retry-btn" type="button">다시 시도</button>
    </main>
  `;

  const retryButton = document.getElementById("setup-retry-btn");
  retryButton?.addEventListener("click", () => {
    location.reload();
  });
}

const bootTimeout = window.setTimeout(() => {
  renderBootstrapError(
    "설정 화면 시작이 지연되고 있습니다. chrome://extensions에서 OpenMyHealth를 새로고침한 뒤 Setup 탭을 다시 열어 주세요.",
  );
}, 20_000);

void import("./main")
  .then(() => {
    window.clearTimeout(bootTimeout);
    bootState.appMounted = true;
    window.__OMH_SETUP_BOOT_STATE__ = bootState;
  })
  .catch(() => {
    window.clearTimeout(bootTimeout);
    renderBootstrapError("업데이트가 완전히 적용되지 않았어요. chrome://extensions에서 새로고침 후 다시 시도해 주세요.");
  });

export {};
