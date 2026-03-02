import { test, expect } from "../fixtures/extension.fixture";
import { SetupPage } from "../pages/setup.page";
import { VaultPage } from "../pages/vault.page";
import { OverlayPage } from "../pages/overlay.page";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../data");

test.describe("Timer Escalation", () => {
  test.beforeEach(async ({ setupPage, vaultPage, harnessPage }) => {
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
    await vault.selectProvider("chatgpt");
    await vaultPage.waitForTimeout(1000);
    await harnessPage.waitForFunction(
      () => (window as any).__omh?.ready === true,
      null,
      { timeout: 15_000 },
    );
  });

  test("initial timer shows blue stage (>15s)", async ({ harnessPage }) => {
    const overlay = new OverlayPage(harnessPage);
    harnessPage
      .evaluate(() =>
        (window as any).__omh.sendMcpRequest({
          resource_types: ["Observation"],
          depth: "summary",
        }),
      )
      .catch(() => {});
    await overlay.waitForMode("approval", 15_000);
    const color = await overlay.getTimerColor();
    expect(color).toBe("blue");
    await overlay.clickDeny();
  });

  test("timer transitions to amber at 15s", async ({ harnessPage }) => {
    test.setTimeout(120_000);
    const overlay = new OverlayPage(harnessPage);
    harnessPage
      .evaluate(() =>
        (window as any).__omh.sendMcpRequest({
          resource_types: ["Observation"],
          depth: "summary",
        }),
      )
      .catch(() => {});
    await overlay.waitForMode("approval", 15_000);
    // Wait until ~45 seconds pass (15s remaining)
    await harnessPage.waitForTimeout(46_000);
    const color = await overlay.getTimerColor();
    expect(["amber", "red"]).toContain(color);
    await overlay.clickDeny();
  });

  test("timer transitions to red at 5s", async ({ harnessPage }) => {
    test.setTimeout(120_000);
    const overlay = new OverlayPage(harnessPage);
    harnessPage
      .evaluate(() =>
        (window as any).__omh.sendMcpRequest({
          resource_types: ["Observation"],
          depth: "summary",
        }),
      )
      .catch(() => {});
    await overlay.waitForMode("approval", 15_000);
    // Wait until ~56 seconds pass (4s remaining)
    await harnessPage.waitForTimeout(56_000);
    const color = await overlay.getTimerColor();
    expect(color).toBe("red");
    await overlay.clickDeny();
  });

  test("timeout auto-denies after 60s", async ({ harnessPage }) => {
    test.setTimeout(120_000);
    const overlay = new OverlayPage(harnessPage);
    const requestPromise = harnessPage.evaluate(() =>
      (window as any).__omh.sendMcpRequest({
        resource_types: ["Observation"],
        depth: "summary",
      }),
    );
    await overlay.waitForMode("approval", 15_000);
    // Wait for full timeout
    const response = (await requestPromise) as any;
    // Bridge returns ok:true for successful communication; check result.status for timeout
    expect(response.result.status).toBe("timeout");
  });

  test("timeout card shows then auto-closes", async ({ harnessPage }) => {
    test.setTimeout(120_000);
    const overlay = new OverlayPage(harnessPage);
    harnessPage
      .evaluate(() =>
        (window as any).__omh.sendMcpRequest({
          resource_types: ["Observation"],
          depth: "summary",
        }),
      )
      .catch(() => {});
    await overlay.waitForMode("approval", 15_000);
    // Wait for timeout
    await harnessPage.waitForTimeout(62_000);
    // Timeout card should have appeared and then hidden after 3s
    await harnessPage.waitForTimeout(4000);
    const visible = await overlay.isVisible();
    expect(visible).toBe(false);
  });

  test("countdown decrements each second", async ({ harnessPage }) => {
    const overlay = new OverlayPage(harnessPage);
    harnessPage
      .evaluate(() =>
        (window as any).__omh.sendMcpRequest({
          resource_types: ["Observation"],
          depth: "summary",
        }),
      )
      .catch(() => {});
    await overlay.waitForMode("approval", 15_000);
    const first = await overlay.getRemainingSeconds();
    await harnessPage.waitForTimeout(3000);
    const second = await overlay.getRemainingSeconds();
    expect(second).toBeLessThan(first);
    await overlay.clickDeny();
  });
});
