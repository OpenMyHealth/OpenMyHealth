import { insertDraftIntoProvider } from "../provider/adapters";
import { Provider } from "../context/types";

type ContentMessage = {
  type: "INSERT_DRAFT";
  payload: {
    provider: Provider;
    draft: string;
  };
};

export function mountProviderBridge(provider: Provider) {
  chrome.runtime.onMessage.addListener((message: ContentMessage, _sender, sendResponse) => {
    if (message.type !== "INSERT_DRAFT") {
      sendResponse({ ok: false, error: "unsupported-message" });
      return;
    }

    if (message.payload.provider !== provider) {
      sendResponse({ ok: false, error: "provider-mismatch" });
      return;
    }

    const result = insertDraftIntoProvider(provider, document, message.payload.draft);
    sendResponse(result.ok ? { ok: true } : result);
  });
}
