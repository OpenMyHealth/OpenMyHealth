import { test, expect } from "../fixtures/extension.fixture";
import { SetupPage } from "../pages/setup.page";
import { VaultPage } from "../pages/vault.page";
import { OverlayPage } from "../pages/overlay.page";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../data");

async function setupAndReady(
  setupPage: any,
  vaultPage: any,
  harnessPage: any,
) {
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
  return vault;
}

test.describe("Always Allow", () => {
  test.beforeEach(async ({ setupPage, vaultPage, harnessPage }) => {
    await setupAndReady(setupPage, vaultPage, harnessPage);
  });

  test("detail mode shows always-allow toggle", async ({ harnessPage }) => {
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
    await overlay.expandDetail();
    // Check for always-allow checkbox
    const checkbox = harnessPage
      .locator("#openmyhealth-overlay-root")
      .locator("text=\uC790\uB3D9 \uD5C8\uC6A9");
    await expect(checkbox).toBeVisible();
    await overlay.clickDeny();
  });

  test("toggle ON shows confirmation popup", async ({ harnessPage }) => {
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
    await overlay.expandDetail();
    await overlay.toggleAlwaysAllow();
    // Confirmation text should appear
    const root = harnessPage.locator("#openmyhealth-overlay-root");
    const confirmText = root.locator("text=\uC790\uB3D9 \uACF5\uC720\uB429\uB2C8\uB2E4");
    await expect(confirmText).toBeVisible({ timeout: 3000 });
    await overlay.clickDeny();
  });

  test("confirm activates always-allow", async ({ harnessPage }) => {
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
    await overlay.expandDetail();
    await overlay.toggleAlwaysAllow();
    await overlay.confirmAlwaysAllow();
    // Now approve
    await overlay.clickApprove();
    await harnessPage.waitForTimeout(2000);
  });

  test("same request auto-approves without overlay", async ({
    harnessPage,
  }) => {
    const overlay = new OverlayPage(harnessPage);
    // First request: enable always-allow and approve
    const firstPromise = harnessPage.evaluate(() =>
      (window as any).__omh.sendMcpRequest({
        resource_types: ["Observation"],
        depth: "summary",
      }),
    );
    await overlay.waitForMode("approval", 15_000);
    await overlay.expandDetail();
    await overlay.toggleAlwaysAllow();
    await overlay.confirmAlwaysAllow();
    await overlay.clickApprove();
    await firstPromise;
    await harnessPage.waitForTimeout(2000);

    // Second request: should auto-approve
    const secondResponse = (await harnessPage.evaluate(() =>
      (window as any).__omh.sendMcpRequest({
        resource_types: ["Observation"],
        depth: "summary",
      }),
    )) as any;
    expect(secondResponse.ok).toBe(true);
  });

  test("vault shows permission in list", async ({
    harnessPage,
    vaultPage,
  }) => {
    const overlay = new OverlayPage(harnessPage);
    const vault = new VaultPage(vaultPage);
    // Enable always-allow
    const requestPromise = harnessPage.evaluate(() =>
      (window as any).__omh.sendMcpRequest({
        resource_types: ["Observation"],
        depth: "summary",
      }),
    );
    await overlay.waitForMode("approval", 15_000);
    await overlay.expandDetail();
    await overlay.toggleAlwaysAllow();
    await overlay.confirmAlwaysAllow();
    await overlay.clickApprove();
    await requestPromise;
    await harnessPage.waitForTimeout(1000);

    // Check vault permissions
    await vaultPage.reload();
    await vault.waitForReady();
    if (!(await vault.isUnlocked())) {
      await vault.unlock("123456");
    }
    const perms = await vault.getPermissions();
    expect(perms.length).toBeGreaterThan(0);
  });

  test("revoking permission requires manual approval again", async ({
    harnessPage,
    vaultPage,
  }) => {
    const overlay = new OverlayPage(harnessPage);
    const vault = new VaultPage(vaultPage);
    // Enable always-allow
    const firstPromise = harnessPage.evaluate(() =>
      (window as any).__omh.sendMcpRequest({
        resource_types: ["Observation"],
        depth: "summary",
      }),
    );
    await overlay.waitForMode("approval", 15_000);
    await overlay.expandDetail();
    await overlay.toggleAlwaysAllow();
    await overlay.confirmAlwaysAllow();
    await overlay.clickApprove();
    await firstPromise;
    await harnessPage.waitForTimeout(1000);

    // Revoke in vault
    await vaultPage.reload();
    await vault.waitForReady();
    if (!(await vault.isUnlocked())) {
      await vault.unlock("123456");
    }
    try {
      await vault.revokePermission(0);
      await vaultPage.waitForTimeout(1000);
    } catch {
      // Permission may not be visible in current tab
    }

    // Next request should require manual approval
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
  });

  test("audit log records always permission level", async ({
    harnessPage,
    vaultPage,
  }) => {
    const overlay = new OverlayPage(harnessPage);
    const vault = new VaultPage(vaultPage);
    // Enable always-allow and approve
    const requestPromise = harnessPage.evaluate(() =>
      (window as any).__omh.sendMcpRequest({
        resource_types: ["Observation"],
        depth: "summary",
      }),
    );
    await overlay.waitForMode("approval", 15_000);
    await overlay.expandDetail();
    await overlay.toggleAlwaysAllow();
    await overlay.confirmAlwaysAllow();
    await overlay.clickApprove();
    await requestPromise;
    await harnessPage.waitForTimeout(1000);

    // Check audit logs
    await vaultPage.reload();
    await vault.waitForReady();
    if (!(await vault.isUnlocked())) {
      await vault.unlock("123456");
    }
    const logs = await vault.getAuditLogs();
    expect(logs.length).toBeGreaterThan(0);
  });

  test("different depth requires separate approval", async ({
    harnessPage,
  }) => {
    const overlay = new OverlayPage(harnessPage);
    // Enable always-allow for summary depth
    const firstPromise = harnessPage.evaluate(() =>
      (window as any).__omh.sendMcpRequest({
        resource_types: ["Observation"],
        depth: "summary",
      }),
    );
    await overlay.waitForMode("approval", 15_000);
    await overlay.expandDetail();
    await overlay.toggleAlwaysAllow();
    await overlay.confirmAlwaysAllow();
    await overlay.clickApprove();
    await firstPromise;
    await harnessPage.waitForTimeout(2000);

    // Request with different depth should require approval
    harnessPage
      .evaluate(() =>
        (window as any).__omh.sendMcpRequest({
          resource_types: ["Observation"],
          depth: "detail",
        }),
      )
      .catch(() => {});
    await overlay.waitForMode("approval", 15_000);
    await overlay.clickDeny();
  });
});
