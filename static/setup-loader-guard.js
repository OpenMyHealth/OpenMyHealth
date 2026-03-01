(function setupLoaderGuard() {
  var root = document.getElementById("root");
  if (!root) {
    return;
  }

  var BOOT_STATE_KEY = "__OMH_SETUP_BOOT_STATE__";
  if (!window[BOOT_STATE_KEY]) {
    window[BOOT_STATE_KEY] = {
      scriptLoaded: false,
      appMounted: false,
    };
  }

  function renderGuard(message, detail) {
    var shell = document.getElementById("setup-bootstrap-shell");
    if (!shell) {
      return;
    }

    root.innerHTML = [
      '<main class="shell" role="alert">',
      '<h1 class="title">설정 화면을 시작하지 못했습니다</h1>',
      '<p class="copy">' + message + "</p>",
      '<p class="copy">' + detail + "</p>",
      '<button id="setup-guard-retry-btn" class="retry-btn" type="button">다시 시도</button>',
      "</main>",
    ].join("");

    var retryButton = document.getElementById("setup-guard-retry-btn");
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
        "설정 스크립트를 불러오지 못했습니다.",
        "chrome://extensions에서 OpenMyHealth를 새로고침한 뒤 다시 시도해 주세요.",
      );
      return;
    }

    renderGuard(
      "설정 시작이 지연되고 있습니다.",
      "확장 프로그램을 새로고침한 뒤 Setup 탭을 다시 열어 주세요.",
    );
  }, 15_000);
}());
