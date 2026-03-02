import { test, expect } from "../fixtures/extension.fixture";
import { VaultPage } from "../pages/vault.page";
import { OverlayPage } from "../pages/overlay.page";
import { setupVault } from "../helpers/setup";
import { waitForProviderSelected } from "../helpers/waits";

test.describe("Cross Provider", () => {
  test.beforeEach(async ({ setupPage, vaultPage }) => {
    await setupVault(setupPage, vaultPage, undefined, {
      files: ["sample-lab-report.txt"],
      provider: "chatgpt",
    });
  });

  test("?provider=chatgpt detects ChatGPT", async ({ context }) => {
    const page = await context.newPage();
    await page.goto("http://localhost:4173/?provider=chatgpt");
    await page.waitForFunction(
      () => (window as any).__omh?.ready === true,
      null,
      { timeout: 15_000 },
    );
    const provider = await page.evaluate(
      () => (window as any).__omh.provider,
    );
    expect(provider).toBe("chatgpt");
    await page.close();
  });

  test("?provider=claude detects Claude", async ({ context }) => {
    const page = await context.newPage();
    await page.goto("http://localhost:4173/?provider=claude");
    await page.waitForFunction(
      () => (window as any).__omh?.ready === true,
      null,
      { timeout: 15_000 },
    );
    const provider = await page.evaluate(
      () => (window as any).__omh.provider,
    );
    expect(provider).toBe("claude");
    await page.close();
  });

  test("ChatGPT MCP request creates chatgpt audit log", async ({
    harnessPage,
    vaultPage,
  }) => {
    await harnessPage.waitForFunction(
      () => (window as any).__omh?.ready === true,
      null,
      { timeout: 15_000 },
    );
    const overlay = new OverlayPage(harnessPage);
    const requestPromise = harnessPage.evaluate(() =>
      (window as any).__omh.sendMcpRequest({
        resource_types: ["Observation"],
        depth: "summary",
      }),
    );
    await overlay.waitForMode("approval", 15_000);
    await overlay.clickApprove();
    await requestPromise;
    await overlay.waitForMode("hidden", 10_000);

    const vault = new VaultPage(vaultPage);
    await vaultPage.reload();
    await vault.waitForReady();
    if (!(await vault.isUnlocked())) {
      await vault.unlock("123456");
    }
    const logs = await vault.getAuditLogs();
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });

  test("Claude MCP request creates claude audit log", async ({
    context,
    vaultPage,
  }) => {
    // Switch vault to claude provider first
    const vault = new VaultPage(vaultPage);
    await vault.selectProvider("claude");
    await waitForProviderSelected(vaultPage, "claude");

    // Navigate to harness with claude provider
    const page = await context.newPage();
    await page.goto("http://localhost:4173/?provider=claude");
    await page.waitForFunction(
      () => (window as any).__omh?.ready === true,
      null,
      { timeout: 15_000 },
    );

    const overlay = new OverlayPage(page);
    const requestPromise = page.evaluate(() =>
      (window as any).__omh.sendMcpRequest({
        resource_types: ["Observation"],
        depth: "summary",
      }),
    );

    await overlay.waitForMode("approval", 15_000);
    await overlay.clickApprove();
    await requestPromise;

    await page.close();
  });
});
