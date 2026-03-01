import { ensureBackgroundReady } from "../src/core/background/approval-engine";
import { onInstalled, onActionClicked, onTabUpdated, onTabRemoved, onStartup, onMessage } from "../src/core/background/lifecycle";

export default defineBackground(() => {
  void ensureBackgroundReady();

  browser.runtime.onInstalled.addListener((details) => void onInstalled(details));
  browser.action.onClicked.addListener((tab) => void onActionClicked(tab));
  browser.tabs.onUpdated.addListener(onTabUpdated);
  browser.tabs.onRemoved.addListener(onTabRemoved);
  browser.runtime.onStartup.addListener(() => void onStartup());
  browser.runtime.onMessage.addListener(onMessage);
});
