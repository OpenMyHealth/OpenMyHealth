import type { AiProvider } from "../../../packages/contracts/src/index";
import type { OverlayEvent } from "../messages";
import type { PendingApproval } from "./state";
import { INTEGRATION_WARNING_MESSAGE } from "./state";
import { getSettings, updateSettings } from "./settings";
import { findProviderTab } from "./tab-manager";

export async function sendOverlay(
  provider: AiProvider,
  event: OverlayEvent,
  targetTabId?: number | null,
): Promise<{ sent: boolean; tabId: number | null }> {
  const tab = await findProviderTab(provider, targetTabId);
  if (!tab?.id) {
    return { sent: false, tabId: null };
  }

  try {
    await browser.tabs.sendMessage(tab.id, event);
    return { sent: true, tabId: tab.id };
  } catch {
    return { sent: false, tabId: tab.id };
  }
}

export async function markIntegrationWarning(): Promise<void> {
  const settings = await getSettings();
  if (settings.integrationWarning === INTEGRATION_WARNING_MESSAGE) {
    return;
  }
  await updateSettings((s) => {
    s.integrationWarning = INTEGRATION_WARNING_MESSAGE;
  });
}

export async function isOverlayResponsiveForRequest(pending: PendingApproval): Promise<boolean> {
  if (!pending.sourceTabId) {
    return false;
  }
  const sent = await sendOverlay(
    pending.request.provider,
    { type: "overlay:ping" },
    pending.sourceTabId,
  );
  return sent.sent;
}
