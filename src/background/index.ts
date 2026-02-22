import { buildContextPacket, buildProviderDraft } from "../context/build";
import { normalizeHira5yPayload } from "../context/normalize";
import { finalizeSmsAuthAndFetchPayload } from "../hira";
import { RuntimeMessage, RuntimeResponse, isHiraPayload } from "./messages";

function respond(sendResponse: (response: RuntimeResponse) => void, response: RuntimeResponse) {
  sendResponse(response);
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
    // Ignore unsupported environments.
  });
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  (async () => {
    if (message.type === "BUILD_CONTEXT_PACKET") {
      if (!isHiraPayload(message.payload.hiraPayload)) {
        respond(sendResponse, { ok: false, error: "invalid-hira-payload" });
        return;
      }

      const records = normalizeHira5yPayload(message.payload.hiraPayload);
      const packet = buildContextPacket(message.payload.userQuestion, records);
      const draft = buildProviderDraft(packet);

      respond(sendResponse, {
        ok: true,
        data: {
          packet,
          draft,
        },
      });
      return;
    }

    if (message.type === "INSERT_DRAFT_TO_ACTIVE_TAB") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        respond(sendResponse, { ok: false, error: "active-tab-not-found" });
        return;
      }

      try {
        const result = await chrome.tabs.sendMessage(tab.id, {
          type: "INSERT_DRAFT",
          payload: message.payload,
        });
        respond(sendResponse, {
          ok: true,
          data: { delivered: Boolean(result?.ok) },
        });
      } catch {
        respond(sendResponse, { ok: false, error: "content-script-not-ready" });
      }
      return;
    }

    if (message.type === "FETCH_HIRA_PAYLOAD_WITH_ENCODE_DATA") {
      if (!message.payload.encodeData) {
        respond(sendResponse, { ok: false, error: "encodeData-required" });
        return;
      }

      try {
        const hiraPayload = await finalizeSmsAuthAndFetchPayload({
          encodeData: message.payload.encodeData,
        });
        respond(sendResponse, {
          ok: true,
          data: { hiraPayload },
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "hira-fetch-failed";
        respond(sendResponse, {
          ok: false,
          error: message,
        });
      }
      return;
    }

    respond(sendResponse, { ok: false, error: "unsupported-message" });
  })();

  return true;
});
