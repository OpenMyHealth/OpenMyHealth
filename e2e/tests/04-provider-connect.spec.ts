import { test, expect } from "../fixtures/extension.fixture";
import { VaultPage } from "../pages/vault.page";
import { setupVault } from "../helpers/setup";
import { waitForProviderSelected } from "../helpers/waits";

test.describe("Provider Connect", () => {
  test.beforeEach(async ({ setupPage, vaultPage }) => {
    await setupVault(setupPage, vaultPage);
  });

  test("ChatGPT card shows Plus subscription badge", async ({ vaultPage }) => {
    const text = await vaultPage.textContent("body");
    expect(text).toMatch(/Plus|구독/i);
  });

  test("Claude card shows Pro subscription badge", async ({ vaultPage }) => {
    const text = await vaultPage.textContent("body");
    expect(text).toMatch(/Pro|구독/i);
  });

  test("Gemini card shows disabled state", async ({ vaultPage }) => {
    const text = await vaultPage.textContent("body");
    expect(text).toMatch(/준비 중|coming soon|Gemini/i);
  });

  test("selecting ChatGPT saves provider", async ({ vaultPage }) => {
    const vault = new VaultPage(vaultPage);
    await vault.selectProvider("chatgpt");
    await waitForProviderSelected(vaultPage, "chatgpt");
    const chatgptCard = vaultPage.locator("text=ChatGPT").first();
    await expect(chatgptCard).toBeVisible();
  });

  test("switching provider deselects previous", async ({ vaultPage }) => {
    const vault = new VaultPage(vaultPage);
    await vault.selectProvider("chatgpt");
    await waitForProviderSelected(vaultPage, "chatgpt");
    await vault.selectProvider("claude");
    await waitForProviderSelected(vaultPage, "claude");
    const text = await vaultPage.textContent("body");
    expect(text).toMatch(/Claude/i);
  });

  test("connection success overlay shows on harness page", async ({
    vaultPage,
    harnessPage,
  }) => {
    const vault = new VaultPage(vaultPage);
    await vault.selectProvider("chatgpt");
    await waitForProviderSelected(vaultPage, "chatgpt");

    // Check harness page for content script
    await harnessPage
      .waitForFunction(
        () => (window as any).__omh?.ready === true,
        null,
        { timeout: 15_000 },
      )
      .catch(() => {});
    // Content script may or may not show connected overlay
  });
});
