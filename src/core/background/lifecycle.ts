import { ensureBackgroundReady, lockSession, clearPersistedApprovalState } from "./approval-engine";
import { getSettings, toReadableError } from "./settings";
import { trackVaultTab, untrackVaultTab, ensureVaultTab, ensureSetupTab } from "./tab-manager";
import { handleRuntimeMessage } from "./message-handlers";

export async function onInstalled(details: chrome.runtime.InstalledDetails): Promise<void> {
  if (details.reason === "install") {
    await ensureSetupTab();
    await clearPersistedApprovalState();
    return;
  }
  if (details.reason === "update") {
    await lockSession("runtime update");
  }
}

export async function onActionClicked(tab: chrome.tabs.Tab): Promise<void> {
  void tab;
  const settings = await getSettings();
  if (!settings.pinConfig) {
    await ensureSetupTab();
    return;
  }
  await ensureVaultTab();
}

export function onTabUpdated(tabId: number, changeInfo: { url?: string; status?: string }, tab: { url?: string }): void {
  if (changeInfo.url) {
    trackVaultTab(tabId, changeInfo.url);
    return;
  }
  if (changeInfo.status === "complete") {
    trackVaultTab(tabId, tab.url);
  }
}

export function onTabRemoved(tabId: number): void {
  untrackVaultTab(tabId);
}

export async function onStartup(): Promise<void> {
  await lockSession("runtime startup");
}

export function onMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
): boolean {
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
}
