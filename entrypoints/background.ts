import { ensureBackgroundReady, lockSession, clearPersistedApprovalState } from "../src/core/background/approval-engine";
import { getSettings, toReadableError } from "../src/core/background/settings";
import { trackVaultTab, untrackVaultTab, ensureVaultTab, ensureSetupTab } from "../src/core/background/tab-manager";
import { handleRuntimeMessage } from "../src/core/background/message-handlers";

export default defineBackground(() => {
  void ensureBackgroundReady();

  browser.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === "install") {
      await ensureSetupTab();
      await clearPersistedApprovalState();
      return;
    }
    if (details.reason === "update") {
      await lockSession("runtime update");
    }
  });

  browser.action.onClicked.addListener(async () => {
    const settings = await getSettings();
    if (!settings.pinConfig) {
      await ensureSetupTab();
      return;
    }
    await ensureVaultTab();
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url) {
      trackVaultTab(tabId, changeInfo.url);
      return;
    }
    if (changeInfo.status === "complete") {
      trackVaultTab(tabId, tab.url);
    }
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    untrackVaultTab(tabId);
  });

  browser.runtime.onStartup.addListener(() => {
    void lockSession("runtime startup");
  });

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    void ensureBackgroundReady()
      .then(() => handleRuntimeMessage(message, sender))
      .then((response) => sendResponse(response))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: toReadableError(error),
        });
      });
    return true;
  });
});
