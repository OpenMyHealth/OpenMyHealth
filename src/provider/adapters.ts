import { Provider } from "../context/types";

const PROVIDER_SELECTORS: Record<Provider, string[]> = {
  chatgpt: [
    "textarea[data-testid='prompt-textarea']",
    "#prompt-textarea",
    "textarea[placeholder*='Message']",
  ],
  gemini: [
    "rich-textarea [contenteditable='true']",
    "div[contenteditable='true'][aria-label*='prompt']",
    "textarea",
  ],
  claude: [
    "div[contenteditable='true'][data-testid='chat-input']",
    "div[contenteditable='true'][role='textbox']",
    "textarea",
  ],
};

export function detectProvider(url: string): Provider | null {
  if (url.includes("chatgpt.com") || url.includes("chat.openai.com")) {
    return "chatgpt";
  }
  if (url.includes("gemini.google.com")) {
    return "gemini";
  }
  if (url.includes("claude.ai")) {
    return "claude";
  }
  return null;
}

export function findProviderInput(
  provider: Provider,
  doc: Document,
): HTMLElement | null {
  for (const selector of PROVIDER_SELECTORS[provider]) {
    const found = doc.querySelector<HTMLElement>(selector);
    if (found) return found;
  }
  return null;
}

function setInputValue(input: HTMLElement, draft: string) {
  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
    input.focus();
    input.value = draft;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }

  input.focus();
  input.textContent = draft;
  input.dispatchEvent(new InputEvent("input", { bubbles: true, data: draft }));
}

export function insertDraftIntoProvider(
  provider: Provider,
  doc: Document,
  draft: string,
): { ok: boolean; reason?: string } {
  const input = findProviderInput(provider, doc);
  if (!input) {
    return { ok: false, reason: "input-not-found" };
  }

  setInputValue(input, draft);
  return { ok: true };
}
