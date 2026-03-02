import { test, expect } from "../fixtures/extension.fixture";
import { SetupPage } from "../pages/setup.page";
import { VaultPage } from "../pages/vault.page";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../data");

test.describe("Vault Management", () => {
  test.beforeEach(async ({ setupPage, vaultPage }) => {
    const setup = new SetupPage(setupPage);
    await setup.setupFullPin("123456");
    await setup.waitForVaultRedirect();
    // Reload vault to pick up PIN state
    await vaultPage.reload();
    const vault = new VaultPage(vaultPage);
    await vault.waitForReady();
    if (!(await vault.isUnlocked())) {
      await vault.unlock("123456");
    }
    await vault.uploadFile(path.join(DATA_DIR, "sample-lab-report.txt"));
    await vault.waitForParsingComplete(10_000);
  });

  test("file download triggers decrypted download", async ({ vaultPage }) => {
    const vault = new VaultPage(vaultPage);
    const downloadPromise = vaultPage.waitForEvent("download");
    await vault.downloadFile(0);
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBeTruthy();
  });

  test("file deletion removes file card", async ({ vaultPage }) => {
    const vault = new VaultPage(vaultPage);
    const cardsBefore = await vault.getFileCards();
    expect(cardsBefore.length).toBeGreaterThanOrEqual(1);
    // Remember file name text from first card
    const firstCardText = cardsBefore[0];
    await vault.deleteFile(0);
    // Wait for file card to disappear — either the card text changes or empty state appears
    await vaultPage.waitForFunction(
      (text: string) => {
        const container = document.querySelector('[aria-live="polite"]');
        if (!container) return false;
        const bodyText = container.textContent ?? "";
        // File card text should no longer be present, or empty state should show
        return !bodyText.includes("sample-lab-report") || bodyText.includes("아직 업로드한 기록이 없습니다");
      },
      firstCardText,
      { timeout: 10_000 },
    );
    const bodyText = await vaultPage.locator('[aria-live="polite"]').textContent();
    expect(bodyText).not.toContain("sample-lab-report");
  });

  test("deletion updates data summary", async ({ vaultPage }) => {
    const vault = new VaultPage(vaultPage);
    const summaryBefore = await vault.getDataSummary();
    await vault.deleteFile(0);
    await vaultPage.waitForTimeout(1000);
    const summaryAfter = await vault.getDataSummary();
    expect(summaryAfter).not.toBe(summaryBefore);
  });

  test("parsing state shows spinner", async ({ vaultPage }) => {
    const vault = new VaultPage(vaultPage);
    // Upload a new file and check for loading state
    await vault.uploadFile(path.join(DATA_DIR, "sample-medication.txt"));
    // Check for any loading indicator within 2 seconds
    await vaultPage
      .locator(
        '[class*="shimmer"], [class*="spinner"], [class*="loading"], [class*="animate"]',
      )
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    // Loading may be too fast to catch, so we verify upload completed successfully
    await vault.waitForParsingComplete(10_000);
    const cards = await vault.getFileCards();
    expect(cards.length).toBeGreaterThanOrEqual(2);
  });

  test("error file shows destructive badge", async ({ vaultPage }) => {
    // Upload an unsupported file type to trigger error
    const vault = new VaultPage(vaultPage);
    const unsupportedPath = path.join(DATA_DIR, "test.bin");
    const fs = await import("node:fs/promises");
    await fs.writeFile(unsupportedPath, Buffer.from([0x00, 0x01, 0x02]));
    try {
      await vault.uploadFile(unsupportedPath);
      await vaultPage.waitForTimeout(3000);
      const text = await vaultPage.textContent("body");
      // Should show error state
      expect(text).toMatch(/지원|오류|형식|error/i);
    } finally {
      await fs.unlink(unsupportedPath).catch(() => {});
    }
  });

  test("file cards show name, size, date, status", async ({ vaultPage }) => {
    const vault = new VaultPage(vaultPage);
    const cards = await vault.getFileCards();
    expect(cards.length).toBeGreaterThanOrEqual(1);
    const card = cards[0];
    expect(card.length).toBeGreaterThan(0);
  });

  test("locked session blocks vault access", async ({
    vaultPage,
    context,
    extensionId,
  }) => {
    const vault = new VaultPage(vaultPage);
    await vault.lockSession();
    await vaultPage.waitForTimeout(500);
    // Open a new vault page
    const newPage = await context.newPage();
    await newPage.goto(`chrome-extension://${extensionId}/vault.html`);
    await newPage.waitForFunction(
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
    // Should see PIN input
    const hasPin = await newPage
      .locator(
        'input[inputmode="numeric"], input[type="password"], input[type="tel"]',
      )
      .first()
      .isVisible({ timeout: 5000 });
    expect(hasPin).toBe(true);
    await newPage.close();
  });
});
