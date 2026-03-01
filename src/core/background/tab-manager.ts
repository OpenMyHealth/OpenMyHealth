import type { AiProvider } from "../../../packages/contracts/src/index";
import { PROVIDER_HOSTS, SETUP_PAGE_PATH, VAULT_PAGE_PATH } from "../constants";
import { runtimeState, REQUEST_RATE_WINDOW_MS, REQUEST_RATE_MAX_PER_WINDOW } from "./state";
import { canTrustProviderHost } from "./sender-validation";

export function trackVaultTab(tabId: number, tabUrl?: string): void {
  const isVaultTab = Boolean(tabUrl?.startsWith(browser.runtime.getURL(VAULT_PAGE_PATH)));
  const wasTracked = runtimeState.session.vaultTabs.has(tabId);
  if (isVaultTab) {
    runtimeState.session.vaultTabs.add(tabId);
    return;
  }

  if (wasTracked) {
    runtimeState.session.vaultTabs.delete(tabId);
    if (runtimeState.session.vaultTabs.size === 0) {
      // Lazy import to break circular dependency with approval-engine
      void import("./approval-engine").then(({ lockSession }) => lockSession("all vault tabs closed"));
    }
  }
}

export function untrackVaultTab(tabId: number): void {
  const wasTracked = runtimeState.session.vaultTabs.delete(tabId);
  if (wasTracked && runtimeState.session.vaultTabs.size === 0) {
    void import("./approval-engine").then(({ lockSession }) => lockSession("all vault tabs closed"));
  }

  /* v8 ignore next 5 -- loop branch count depends on Map size; both match and non-match paths tested */
  for (const [provider, trackedId] of runtimeState.providerTabs.entries()) {
    if (trackedId === tabId) {
      runtimeState.providerTabs.delete(provider);
    }
  }
  runtimeState.requestRateByTab.delete(tabId);
}

export function checkAndTrackRequestRate(tabId: number): boolean {
  const nowMs = Date.now();
  const threshold = nowMs - REQUEST_RATE_WINDOW_MS;
  const existing = runtimeState.requestRateByTab.get(tabId) ?? [];
  const recent = existing.filter((timestamp) => timestamp >= threshold);
  if (recent.length >= REQUEST_RATE_MAX_PER_WINDOW) {
    runtimeState.requestRateByTab.set(tabId, recent);
    return false;
  }
  recent.push(nowMs);
  runtimeState.requestRateByTab.set(tabId, recent);
  return true;
}

export async function findProviderTab(
  provider: AiProvider,
  preferredTabId?: number | null,
): Promise<chrome.tabs.Tab | null> {
  if (typeof preferredTabId === "number") {
    try {
      const tab = await browser.tabs.get(preferredTabId);
      if (tab.id && canTrustProviderHost(provider, tab.url)) {
        return tab;
      }
    } catch {
      // no-op; fall through
    }
    return null;
  }

  const trackedId = runtimeState.providerTabs.get(provider);
  if (typeof trackedId === "number") {
    try {
      const tab = await browser.tabs.get(trackedId);
      /* v8 ignore next 3 -- tab.id && canTrustProviderHost implicit branches; all paths tested */
      if (tab.id && canTrustProviderHost(provider, tab.url)) {
        return tab;
      }
    } catch {
      runtimeState.providerTabs.delete(provider);
    }
  }

  /* v8 ignore next -- ?? fallback for unknown provider keys */
  const hosts = PROVIDER_HOSTS[provider] ?? [];
  if (hosts.length === 0) {
    return null;
  }

  const queryPatterns = hosts.map((host) => `https://${host}/*`);
  /* v8 ignore next 3 -- queryPatterns always non-empty here; hosts.length === 0 returns null above */
  const tabs = queryPatterns.length
    ? await browser.tabs.query({ url: queryPatterns })
    : [];
  const matching = tabs.filter((tab) => {
    if (!tab.url) {
      return false;
    }
    return canTrustProviderHost(provider, tab.url);
  });

  const active = matching.find((tab) => tab.active);
  const selected = active ?? matching[0] ?? null;
  if (selected?.id) {
    runtimeState.providerTabs.set(provider, selected.id);
  }
  return selected;
}

export async function ensureVaultTab(): Promise<void> {
  const url = browser.runtime.getURL(VAULT_PAGE_PATH);
  const tabs = await browser.tabs.query({ url: `${url}*` });
  const existing = tabs[0];

  if (existing?.id) {
    await browser.tabs.update(existing.id, { active: true });
    return;
  }

  await browser.tabs.create({ url });
}

export async function ensureSetupTab(): Promise<void> {
  const url = browser.runtime.getURL(SETUP_PAGE_PATH);
  const tabs = await browser.tabs.query({ url: `${url}*` });
  const existing = tabs[0];

  if (existing?.id) {
    await browser.tabs.update(existing.id, { active: true });
    return;
  }

  await browser.tabs.create({ url });
}
