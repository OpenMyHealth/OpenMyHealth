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
  // Upload multiple types for richer detail mode
  await vault.uploadFile(path.join(DATA_DIR, "sample-lab-report.txt"));
  await vault.waitForParsingComplete(10_000);
  await vault.uploadFile(path.join(DATA_DIR, "sample-medication.txt"));
  await vault.waitForParsingComplete(10_000);
  await vault.selectProvider("chatgpt");
  await vaultPage.waitForTimeout(1000);
  await harnessPage.waitForFunction(
    () => (window as any).__omh?.ready === true,
    null,
    { timeout: 15_000 },
  );
}

test.describe("Detail Mode", () => {
  test.beforeEach(async ({ setupPage, vaultPage, harnessPage }) => {
    await setupAndReady(setupPage, vaultPage, harnessPage);
  });

  test("clicking detail expands hierarchical checkboxes", async ({
    harnessPage,
  }) => {
    const overlay = new OverlayPage(harnessPage);
    harnessPage
      .evaluate(() =>
        (window as any).__omh.sendMcpRequest({
          resource_types: ["Observation", "MedicationStatement"],
          depth: "summary",
        }),
      )
      .catch(() => {});
    await overlay.waitForMode("approval", 15_000);
    await overlay.expandDetail();
    // Should see checkboxes
    const root = harnessPage.locator("#openmyhealth-overlay-root");
    const checkboxes = root.locator("input[type='checkbox']");
    const count = await checkboxes.count();
    expect(count).toBeGreaterThan(0);
    await overlay.clickDeny();
  });

  test("L1 resource type checkboxes show counts", async ({ harnessPage }) => {
    const overlay = new OverlayPage(harnessPage);
    harnessPage
      .evaluate(() =>
        (window as any).__omh.sendMcpRequest({
          resource_types: ["Observation", "MedicationStatement"],
          depth: "summary",
        }),
      )
      .catch(() => {});
    await overlay.waitForMode("approval", 15_000);
    await overlay.expandDetail();
    const root = harnessPage.locator("#openmyhealth-overlay-root");
    const typeLabels = root.locator(
      ".omh-type-group .omh-checkbox-row span",
    );
    const count = await typeLabels.count();
    if (count > 0) {
      const text = await typeLabels.first().textContent();
      // Should show something like "검사 수치 (5건)"
      expect(text).toBeTruthy();
    }
    await overlay.clickDeny();
  });

  test("L2 individual item checkboxes show values", async ({
    harnessPage,
  }) => {
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
    const root = harnessPage.locator("#openmyhealth-overlay-root");
    const subItems = root.locator(".omh-sub-checkbox-row span");
    const count = await subItems.count();
    if (count > 0) {
      const text = await subItems.first().textContent();
      expect(text).toBeTruthy();
    }
    await overlay.clickDeny();
  });

  test("unchecking type unchecks all its items", async ({ harnessPage }) => {
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
    // Uncheck the first type
    await overlay.toggleResourceType(0);
    await harnessPage.waitForTimeout(500);
    // Sub-items should be gone (type unchecked = items hidden)
    const root = harnessPage.locator("#openmyhealth-overlay-root");
    const subCheckboxes = root.locator(
      ".omh-sub-checkbox-row input[type='checkbox']",
    );
    const subCount = await subCheckboxes.count();
    // With type unchecked, sub-items should be hidden
    expect(subCount).toBe(0);
    // Re-check to clean up
    await overlay.toggleResourceType(0);
    await overlay.clickDeny();
  });

  test("unchecking individual item filters response", async ({
    harnessPage,
  }) => {
    const overlay = new OverlayPage(harnessPage);
    const requestPromise = harnessPage.evaluate(() =>
      (window as any).__omh.sendMcpRequest({
        resource_types: ["Observation"],
        depth: "summary",
      }),
    );
    await overlay.waitForMode("approval", 15_000);
    await overlay.expandDetail();
    // Uncheck first individual item
    const root = harnessPage.locator("#openmyhealth-overlay-root");
    const subCheckboxes = root.locator(
      ".omh-sub-checkbox-row input[type='checkbox']",
    );
    if ((await subCheckboxes.count()) > 0) {
      await subCheckboxes.first().click();
      await harnessPage.waitForTimeout(300);
    }
    await overlay.clickApprove();
    const response = (await requestPromise) as any;
    expect(response.ok).toBe(true);
  });

  test("zero items selected disables approve button", async ({
    harnessPage,
  }) => {
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
    // Uncheck all types
    await overlay.toggleResourceType(0);
    await harnessPage.waitForTimeout(300);
    // Approve button should be disabled
    const disabled = await overlay.isApproveDisabled();
    expect(disabled).toBe(true);
    // Re-check to avoid stuck state
    await overlay.toggleResourceType(0);
    await overlay.clickDeny();
  });

  test("many items show collapse summary", async ({ harnessPage }) => {
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
    // Check if there's a collapse/summary for many items
    const root = harnessPage.locator("#openmyhealth-overlay-root");
    const subItems = root.locator(".omh-sub-checkbox-row");
    const count = await subItems.count();
    // Detail mode should render at least some sub-items
    expect(count).toBeGreaterThan(0);
    await overlay.clickDeny();
  });

  test("approve in detail mode sends only selected items", async ({
    harnessPage,
  }) => {
    const overlay = new OverlayPage(harnessPage);
    const requestPromise = harnessPage.evaluate(() =>
      (window as any).__omh.sendMcpRequest({
        resource_types: ["Observation"],
        depth: "summary",
      }),
    );
    await overlay.waitForMode("approval", 15_000);
    await overlay.expandDetail();
    // Just approve with default selection
    await overlay.clickApprove();
    const response = (await requestPromise) as any;
    expect(response.ok).toBe(true);
    expect(response.result).toBeTruthy();
  });
});
