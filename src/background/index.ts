import { findAdapterByUrl, listSourceAdapters } from "../shared/adapters";
import type { RuntimeMessage } from "../shared/messages";
import type { AIPlatform, AppState, SourceStatus } from "../shared/types";
import { VaultStore } from "../shared/storage/vaultStore";
import { createRuntimeMessageHandler, failRuntimeResponse } from "./messageHandlers";

const vault = new VaultStore();

let lastAiTabId: number | null = null;
let lastAiPlatform: AIPlatform | null = null;
const SIDE_PANEL_ALLOWED_URL_RE = [/^https:\/\/chatgpt\.com(?:\/|$)/i, /^https:\/\/chat\.openai\.com(?:\/|$)/i];

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] ?? null;
}

function isAiUrl(url: string): boolean {
  return /chatgpt\.com|chat\.openai\.com|gemini\.google\.com|claude\.ai/i.test(url);
}

function isSidePanelAllowedUrl(url: string): boolean {
  return SIDE_PANEL_ALLOWED_URL_RE.some((re) => re.test(url));
}

function getAiPlatformFromUrl(url: string): AIPlatform | null {
  if (/chatgpt\.com|chat\.openai\.com/i.test(url)) return "chatgpt";
  if (/gemini\.google\.com/i.test(url)) return "gemini";
  if (/claude\.ai/i.test(url)) return "claude";
  return null;
}

async function sendToTab<T>(tabId: number, message: RuntimeMessage): Promise<T> {
  return chrome.tabs.sendMessage(tabId, message) as Promise<T>;
}

async function resolveTargetAiTabId(): Promise<number | null> {
  const activeTab = await getActiveTab();
  if (activeTab?.id && activeTab.url && isAiUrl(activeTab.url)) {
    return activeTab.id;
  }

  if (lastAiTabId == null) {
    return null;
  }

  try {
    const rememberedTab = await chrome.tabs.get(lastAiTabId);
    if (rememberedTab.id && rememberedTab.url && isAiUrl(rememberedTab.url)) {
      return rememberedTab.id;
    }
  } catch {
    // Tab might be closed or inaccessible.
  }

  return null;
}

function setLastAiContext(tabId: number, platform: AIPlatform): void {
  lastAiTabId = tabId;
  lastAiPlatform = platform;
}

async function maybeOpenSidePanel(tabId: number): Promise<void> {
  try {
    await chrome.sidePanel.open({ tabId });
  } catch {
    // Browser may refuse if not user gesture; this is best effort.
  }
}

async function maybeCloseSidePanel(tabId: number): Promise<void> {
  try {
    await chrome.sidePanel.close({ tabId });
  } catch {
    // Older runtimes or restricted contexts may not support this API.
  }
}

async function configureSidePanelBehavior(): Promise<void> {
  try {
    // We open the side panel manually with tabId in action.onClicked.
    // Keeping openPanelOnActionClick disabled prevents window-level sticky panel behavior.
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  } catch {
    // Older runtimes or restricted contexts may not support this API.
  }
}

async function computeAppState(): Promise<AppState> {
  const initialized = await vault.isInitialized();
  const unlocked = vault.isUnlocked();
  const sourceSync = unlocked ? await vault.getSourceSync() : [];
  const recentTransfers = unlocked ? await vault.listTransferAudits(12) : [];
  const syncMap = new Map(sourceSync.map((item) => [item.sourceId, item]));

  const adapters = listSourceAdapters().map((adapter) => {
    const sync = syncMap.get(adapter.id);
    return {
      id: adapter.id,
      country: adapter.country,
      name: adapter.name,
      description: adapter.description,
      connected: Boolean(sync),
      lastSyncedAt: sync?.lastSyncedAt ?? null,
      recordCount: sync?.recordCount ?? 0,
    };
  });

  const activeStatus = await getActiveSourceStatus();

  return {
    vaultInitialized: initialized,
    unlocked,
    sourceSync,
    recentTransfers,
    adapters,
    activeSourceStatus: activeStatus,
    lastAiPlatform,
  };
}

async function getActiveSourceStatus(): Promise<SourceStatus | null> {
  const activeTab = await getActiveTab();
  const url = activeTab?.url ?? "";
  if (!activeTab?.id || !url) return null;

  const adapter = findAdapterByUrl(url);
  if (!adapter) {
    return null;
  }

  try {
    const response = await sendToTab<{ ok: boolean; sourceStatus?: SourceStatus }>(activeTab.id, {
      type: "OMH_GET_SOURCE_STATUS",
      sourceId: adapter.id,
    });

    if (response?.ok && response.sourceStatus) {
      return response.sourceStatus;
    }
  } catch {
    // Ignore unsupported page states.
  }

  return {
    sourceId: adapter.id,
    supported: true,
    url,
    stepState: adapter.guideSteps.reduce<Record<string, boolean>>((acc, step) => {
      acc[step.id] = false;
      return acc;
    }, {}),
  };
}

async function enableSidePanelForTab(tabId: number, url?: string): Promise<void> {
  try {
    const enabled = Boolean(url && isSidePanelAllowedUrl(url));
    await chrome.sidePanel.setOptions({ tabId, enabled, path: "sidepanel.html" });
    if (enabled) {
      await chrome.action.enable(tabId);
    } else {
      await chrome.action.disable(tabId);
    }
  } catch {
    // Ignore tabs that do not support side panel configuration.
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await configureSidePanelBehavior();
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id) continue;
    await enableSidePanelForTab(tab.id, tab.url);
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await configureSidePanelBehavior();
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id) continue;
    await enableSidePanelForTab(tab.id, tab.url);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" || changeInfo.url) {
    const nextUrl = tab.url ?? changeInfo.url;
    await enableSidePanelForTab(tabId, nextUrl);
    if (tab.active && (!nextUrl || !isSidePanelAllowedUrl(nextUrl))) {
      await maybeCloseSidePanel(tabId);
    }
  }

  const url = tab.url ?? changeInfo.url;
  if (url && isAiUrl(url)) {
    const platform = getAiPlatformFromUrl(url);
    if (platform) {
      setLastAiContext(tabId, platform);
    }
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId);
  await enableSidePanelForTab(tabId, tab.url);
  if (!tab.url || !isSidePanelAllowedUrl(tab.url)) {
    await maybeCloseSidePanel(tabId);
  }
  if (tab.url && isAiUrl(tab.url)) {
    const platform = getAiPlatformFromUrl(tab.url);
    if (platform) {
      setLastAiContext(tabId, platform);
    }
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id === undefined) return;
  await enableSidePanelForTab(tab.id, tab.url);
  if (!tab.url || !isSidePanelAllowedUrl(tab.url)) {
    await maybeCloseSidePanel(tab.id);
    return;
  }
  await maybeOpenSidePanel(tab.id);
});

const handleMessage = createRuntimeMessageHandler({
  vault,
  getAppState: computeAppState,
  getActiveSourceStatus,
  getActiveTab,
  sendToTab,
  openSidePanel: maybeOpenSidePanel,
  resolveTargetAiTabId,
  getLastAiPlatform: () => lastAiPlatform,
  setLastAiContext,
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((response) => {
      sendResponse(response);
    })
    .catch((error) => {
      sendResponse(failRuntimeResponse(error));
    });

  return true;
});
