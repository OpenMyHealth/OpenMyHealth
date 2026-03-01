(function vaultLoaderGuard() {
  var root = document.getElementById("root");
  if (!root) {
    return;
  }

  var BOOT_STATE_KEY = "__OMH_VAULT_BOOT_STATE__";
  if (!window[BOOT_STATE_KEY]) {
    window[BOOT_STATE_KEY] = {
      scriptLoaded: false,
      appMounted: false,
    };
  }

  function renderGuard(message, detail) {
    var shell = document.getElementById("vault-bootstrap-shell");
    if (!shell) {
      return;
    }

    root.innerHTML = [
      '<main class="shell" role="alert">',
      '<h1 class="title">보관함을 시작하지 못했습니다</h1>',
      '<p class="copy">' + message + "</p>",
      '<p class="copy">' + detail + "</p>",
      '<button id="vault-guard-retry-btn" class="retry-btn" type="button">다시 시도</button>',
      "</main>",
    ].join("");

    var retryButton = document.getElementById("vault-guard-retry-btn");
    if (retryButton) {
      retryButton.addEventListener("click", function onClick() {
        location.reload();
      });
    }
  }

  window.setTimeout(function onTimeout() {
    var state = window[BOOT_STATE_KEY];
    if (!state || state.appMounted) {
      return;
    }

    if (!state.scriptLoaded) {
      renderGuard(
        "Vault 스크립트를 불러오지 못했습니다.",
        "dev 번들을 사용 중이면 `pnpm dev`를 실행하거나, chrome://extensions에서 `.output/chrome-mv3`를 다시 로드해 주세요.",
      );
      return;
    }

    renderGuard(
      "Vault 시작이 지연되고 있습니다.",
      "chrome://extensions에서 OpenMyHealth를 새로고침한 뒤 Vault 탭을 다시 열어 주세요.",
    );
  }, 15_000);
}());
