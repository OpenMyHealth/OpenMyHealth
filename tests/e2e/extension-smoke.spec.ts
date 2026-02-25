import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("extension vault flow inserts approved context into chat input", async () => {
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
    const extensionId = serviceWorker.url().split("/")[2];

    const chatPage = await context.newPage();
    await chatPage.route("https://chatgpt.com/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `
          <!doctype html>
          <html><body>
            <textarea id="chat-input"></textarea>
          </body></html>
        `,
      });
    });

    await chatPage.goto("https://chatgpt.com/");
    await chatPage.waitForTimeout(300);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    await panel.fill("#passphraseInput", "supersecure123");
    await panel.fill("#passphraseConfirmInput", "supersecure123");
    await panel.click("#authActionButton");

    await panel.fill("#manualTitleInput", "소화불량 진단");
    await panel.fill("#manualSummaryInput", "2024-11 내과 진료에서 소화불량 진단");
    await panel.fill("#manualDateInput", "2024-11-20");
    await panel.click("#manualSaveButton");

    await panel.fill("#queryInput", "내 소화기 기록 보여줘");
    await panel.click("#searchButton");

    await expect(panel.locator(".candidate-item").first()).toBeVisible({ timeout: 10000 });
    await panel.locator(".candidate-item input[type='checkbox']").first().check();
    await panel.click("#buildPreviewButton");
    await expect(panel.locator("#previewTextarea")).toHaveValue(/OpenMyHealth Approved Context/);

    await panel.click("#insertButton");

    await expect(chatPage.locator("#chat-input")).toHaveValue(/OpenMyHealth Approved Context/);
    await expect(chatPage.locator("#chat-input")).toHaveValue(/내 소화기 기록 보여줘/);
  } finally {
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});
