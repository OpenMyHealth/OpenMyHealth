import { test as base, chromium, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXTENSION_PATH = path.resolve(__dirname, "../../.output/chrome-mv3");

export type ExtensionFixtures = {
  context: BrowserContext;
  extensionId: string;
  setupPage: Page;
  vaultPage: Page;
  harnessPage: Page;
};

export const test = base.extend<ExtensionFixtures>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        "--headless=new",
        "--no-first-run",
        "--disable-default-apps",
        "--disable-gpu",
      ],
    });
    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    let swPage: Page;

    // Wait for service worker
    const existingSW = context.serviceWorkers();
    if (existingSW.length > 0) {
      swPage = existingSW[0] as unknown as Page;
    } else {
      swPage = (await context.waitForEvent("serviceworker")) as unknown as Page;
    }

    const url = swPage.url();
    const match = url.match(/chrome-extension:\/\/([^/]+)/);
    if (!match) {
      throw new Error("Could not extract extension ID from service worker URL: " + url);
    }
    await use(match[1]);
  },

  setupPage: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/setup.html`);
    // Wait for bootstrap mount + React internal loading to complete
    await page.waitForFunction(
      () => {
        const boot = (window as any).__OMH_SETUP_BOOT_STATE__;
        if (!boot?.appMounted) return false;
        if (document.getElementById("setup-bootstrap-shell")) return false;
        const root = document.getElementById("root");
        if (!root) return false;
        return root.querySelectorAll('[class*="animate-pulse"]').length === 0;
      },
      { timeout: 15_000 },
    );
    await use(page);
  },

  vaultPage: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/vault.html`);
    // Wait for bootstrap mount + React internal loading to complete
    await page.waitForFunction(
      () => {
        const boot = (window as any).__OMH_VAULT_BOOT_STATE__;
        if (!boot?.appMounted) return false;
        if (document.getElementById("vault-bootstrap-shell")) return false;
        const root = document.getElementById("root");
        if (!root) return false;
        return root.querySelectorAll('[class*="animate-pulse"]').length === 0;
      },
      { timeout: 15_000 },
    );
    await use(page);
  },

  harnessPage: async ({ context }, use) => {
    const page = await context.newPage();
    await page.goto("http://localhost:4173/");
    await use(page);
  },
});

export { expect } from "@playwright/test";
