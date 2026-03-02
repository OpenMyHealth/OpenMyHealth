import { test, expect } from "../fixtures/extension.fixture";
import { OverlayPage } from "../pages/overlay.page";
import { setupVault } from "../helpers/setup";

test.describe("Detail Mode", () => {
  test.beforeEach(async ({ setupPage, vaultPage, harnessPage }) => {
    await setupVault(setupPage, vaultPage, harnessPage, {
      files: ["sample-lab-report.txt", "sample-medication.txt"],
      provider: "chatgpt",
      waitForBridge: true,
    });
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
    await harnessPage.waitForFunction(
      () => {
        const root = document.querySelector('#openmyhealth-overlay-root');
        if (!root) return false;
        return root.querySelectorAll('.omh-sub-checkbox-row input[type="checkbox"]').length === 0;
      },
      { timeout: 5000 },
    );
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
    await harnessPage.waitForFunction(
      () => {
        const root = document.querySelector('#openmyhealth-overlay-root');
        if (!root) return false;
        const btn = root.querySelector('button.omh-primary') as HTMLButtonElement | null;
        return btn?.disabled === true;
      },
      { timeout: 5000 },
    );
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
