import type { AiProvider } from "../../../packages/contracts/src/index";
import { PROVIDER_HOSTS, SETUP_PAGE_PATH, VAULT_PAGE_PATH } from "../constants";
import type { RuntimeResponse } from "../messages";
import { runtimeState } from "./state";

export function canTrustProviderHost(provider: AiProvider, url?: string): boolean {
  if (!url) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const isLocalE2E = import.meta.env.OMH_E2E
    && parsed.protocol === "http:"
    && parsed.hostname === "localhost";
  if (parsed.protocol !== "https:" && !isLocalE2E) {
    return false;
  }

  const hosts = PROVIDER_HOSTS[provider] ?? [];
  return hosts.some((host) => parsed.hostname === host);
}

export function isTrustedSenderForProvider(sender: chrome.runtime.MessageSender, provider: AiProvider): boolean {
  if (sender.id !== browser.runtime.id) {
    return false;
  }
  if (!sender.tab?.id) {
    return false;
  }
  if (typeof sender.frameId === "number" && sender.frameId !== 0) {
    return false;
  }
  /* v8 ignore next -- ?? fallback branches tested via url/tab.url/undefined sender cases */
  return canTrustProviderHost(provider, sender.url ?? sender.tab.url ?? undefined);
}

export function isVaultPageSender(sender: chrome.runtime.MessageSender): boolean {
  const vaultUrl = browser.runtime.getURL(VAULT_PAGE_PATH);
  /* v8 ignore next -- ?? fallback branches tested via url/tab.url/undefined sender cases */
  const senderUrl = sender.url ?? sender.tab?.url ?? "";
  if (sender.id !== browser.runtime.id) {
    return false;
  }

  if (senderUrl.startsWith(vaultUrl)) {
    if (sender.tab?.id) {
      runtimeState.session.vaultTabs.add(sender.tab.id);
    }
    return true;
  }
  return false;
}

export function isVaultOrSetupPageSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== browser.runtime.id) {
    return false;
  }

  /* v8 ignore next -- ?? fallback branches tested via url/tab.url/undefined sender cases */
  const senderUrl = sender.url ?? sender.tab?.url ?? "";
  const vaultUrl = browser.runtime.getURL(VAULT_PAGE_PATH);
  const setupUrl = browser.runtime.getURL(SETUP_PAGE_PATH);
  const isVault = senderUrl.startsWith(vaultUrl);
  const isSetup = senderUrl.startsWith(setupUrl);

  if (!isVault && !isSetup) {
    return false;
  }

  /* v8 ignore next -- ?. implicit branch from sender.tab?.id */
  if (isVault && sender.tab?.id) {
    runtimeState.session.vaultTabs.add(sender.tab.id);
  }
  return true;
}

export function isTrustedOverlaySender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== browser.runtime.id) {
    return false;
  }
  if (!sender.tab?.id) {
    return false;
  }
  if (typeof sender.frameId === "number" && sender.frameId !== 0) {
    return false;
  }
  /* v8 ignore next -- ?? fallback branches tested via url/tab.url/undefined sender cases */
  const senderUrl = sender.url ?? sender.tab.url ?? undefined;
  return (Object.keys(PROVIDER_HOSTS) as AiProvider[]).some((provider) => canTrustProviderHost(provider, senderUrl));
}

export function untrustedResponse(): RuntimeResponse {
  return { ok: false, error: "신뢰할 수 없는 요청입니다." };
}

export function requireVaultSender(sender: chrome.runtime.MessageSender): RuntimeResponse | null {
  if (!isVaultPageSender(sender)) {
    return untrustedResponse();
  }
  return null;
}

export function requireVaultOrSetupSender(sender: chrome.runtime.MessageSender): RuntimeResponse | null {
  if (!isVaultOrSetupPageSender(sender)) {
    return untrustedResponse();
  }
  return null;
}
