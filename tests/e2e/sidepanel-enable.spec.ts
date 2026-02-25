import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("side panel options are enabled only on supported domains", async () => {
  const extensionPath = path.resolve(process.cwd(), "dist");
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "omh-ext-"));

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    let serviceWorker = context.serviceWorkers()[0];
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent("serviceworker");
    }

    const chatPage = await context.newPage();
    await chatPage.route("https://chatgpt.com/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><html><body><textarea id="chat-input"></textarea></body></html>`,
      });
    });
    await chatPage.goto("https://chatgpt.com/");
    await chatPage.waitForTimeout(400);

    const chatOption = await serviceWorker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: ["https://chatgpt.com/*", "https://chat.openai.com/*"] });
      const tabId = tabs[0]?.id;
      if (!tabId) return null;
      return chrome.sidePanel.getOptions({ tabId });
    });

    expect(chatOption?.enabled).toBe(true);

    const otherPage = await context.newPage();
    await otherPage.goto("https://example.com/");
    await otherPage.waitForTimeout(400);

    const otherOption = await serviceWorker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: "https://example.com/*" });
      const tabId = tabs[0]?.id;
      if (!tabId) return null;
      return chrome.sidePanel.getOptions({ tabId });
    });

    expect(otherOption?.enabled ?? false).toBe(false);
  } finally {
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});
