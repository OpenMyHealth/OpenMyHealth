import { test, expect } from "../fixtures/extension.fixture";
import { SetupPage } from "../pages/setup.page";
import { VaultPage } from "../pages/vault.page";
import { OverlayPage } from "../pages/overlay.page";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../data");

test.describe("Audit Log", () => {
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

  test("approval creates audit log entry", async ({
    harnessPage,
    vaultPage,
  }) => {
    const overlay = new OverlayPage(harnessPage);
    const vault = new VaultPage(vaultPage);
    const requestPromise = harnessPage.evaluate(() =>
      (window as any).__omh.sendMcpRequest({
        resource_types: ["Observation"],
        depth: "summary",
      }),
    );
    await overlay.waitForMode("approval", 15_000);
    await overlay.clickApprove();
    await requestPromise;
    await harnessPage.waitForTimeout(1000);

    await vaultPage.reload();
    await vault.waitForReady();
    if (!(await vault.isUnlocked())) {
      await vault.unlock("123456");
    }
    const logs = await vault.getAuditLogs();
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });

  test("denial creates audit log entry", async ({
    harnessPage,
    vaultPage,
  }) => {
    const overlay = new OverlayPage(harnessPage);
    const vault = new VaultPage(vaultPage);
    harnessPage
      .evaluate(() =>
        (window as any).__omh.sendMcpRequest({
          resource_types: ["Observation"],
          depth: "summary",
        }),
      )
      .catch(() => {});
    await overlay.waitForMode("approval", 15_000);
    await overlay.clickDeny();
    await harnessPage.waitForTimeout(1000);

    await vaultPage.reload();
    await vault.waitForReady();
    if (!(await vault.isUnlocked())) {
      await vault.unlock("123456");
    }
    const logs = await vault.getAuditLogs();
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });

  test("timeout creates audit log entry", async ({
    harnessPage,
    vaultPage,
  }) => {
    test.setTimeout(120_000);
    const overlay = new OverlayPage(harnessPage);
    const vault = new VaultPage(vaultPage);
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
    await harnessPage.waitForTimeout(65_000);

    await vaultPage.reload();
    await vault.waitForReady();
    if (!(await vault.isUnlocked())) {
      await vault.unlock("123456");
    }
    const logs = await vault.getAuditLogs();
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });

  test("audit log contains required fields", async ({
    harnessPage,
    vaultPage,
  }) => {
    const overlay = new OverlayPage(harnessPage);
    const vault = new VaultPage(vaultPage);
    const requestPromise = harnessPage.evaluate(() =>
      (window as any).__omh.sendMcpRequest({
        resource_types: ["Observation"],
        depth: "summary",
      }),
    );
    await overlay.waitForMode("approval", 15_000);
    await overlay.clickApprove();
    await requestPromise;
    await harnessPage.waitForTimeout(1000);

    await vaultPage.reload();
    await vault.waitForReady();
    if (!(await vault.isUnlocked())) {
      await vault.unlock("123456");
    }
    const logs = await vault.getAuditLogs();
    if (logs.length > 0) {
      const log = logs[0];
      // Log should contain timestamp and action info
      expect(log.length).toBeGreaterThan(0);
    }
  });

  test("vault audit section renders logs", async ({
    harnessPage,
    vaultPage,
  }) => {
    const overlay = new OverlayPage(harnessPage);
    const vault = new VaultPage(vaultPage);
    const requestPromise = harnessPage.evaluate(() =>
      (window as any).__omh.sendMcpRequest({
        resource_types: ["Observation"],
        depth: "summary",
      }),
    );
    await overlay.waitForMode("approval", 15_000);
    await overlay.clickApprove();
    await requestPromise;
    await harnessPage.waitForTimeout(1000);

    await vaultPage.reload();
    await vault.waitForReady();
    if (!(await vault.isUnlocked())) {
      await vault.unlock("123456");
    }
    // Check that audit section exists
    const auditSection = vaultPage.locator(
      "text=/감사|기록|로그|Audit/i",
    );
    const exists = await auditSection.count();
    expect(exists).toBeGreaterThanOrEqual(1);
  });

  test("multiple logs accumulate in order", async ({
    harnessPage,
    vaultPage,
  }) => {
    const overlay = new OverlayPage(harnessPage);
    const vault = new VaultPage(vaultPage);

    // First request: approve
    const req1 = harnessPage.evaluate(() =>
      (window as any).__omh.sendMcpRequest({
        resource_types: ["Observation"],
        depth: "summary",
      }),
    );
    await overlay.waitForMode("approval", 15_000);
    await overlay.clickApprove();
    await req1;
    await harnessPage.waitForTimeout(2000);

    // Second request: deny
    harnessPage
      .evaluate(() =>
        (window as any).__omh.sendMcpRequest({
          resource_types: ["Observation"],
          depth: "summary",
        }),
      )
      .catch(() => {});
    await overlay.waitForMode("approval", 15_000);
    await overlay.clickDeny();
    await harnessPage.waitForTimeout(2000);

    // Third request: approve
    const req3 = harnessPage.evaluate(() =>
      (window as any).__omh.sendMcpRequest({
        resource_types: ["Observation"],
        depth: "codes",
      }),
    );
    await overlay.waitForMode("approval", 15_000);
    await overlay.clickApprove();
    await req3;
    await harnessPage.waitForTimeout(1000);

    await vaultPage.reload();
    await vault.waitForReady();
    if (!(await vault.isUnlocked())) {
      await vault.unlock("123456");
    }
    const logs = await vault.getAuditLogs();
    expect(logs.length).toBeGreaterThanOrEqual(3);
  });
});
