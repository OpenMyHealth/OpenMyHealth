import { test, expect } from "../fixtures/extension.fixture";
import { OverlayPage } from "../pages/overlay.page";
import { setupVault } from "../helpers/setup";

test.describe("Queue Management", () => {
  test.beforeEach(async ({ setupPage, vaultPage, harnessPage }) => {
    await setupVault(setupPage, vaultPage, harnessPage, {
      files: ["sample-lab-report.txt"],
      provider: "chatgpt",
      waitForBridge: true,
    });
  });

  test("second request during approval shows queue count", async ({
    harnessPage,
  }) => {
    test.setTimeout(120_000);
    const overlay = new OverlayPage(harnessPage);
    // Send first request
    harnessPage
      .evaluate(() =>
        (window as any).__omh.sendMcpRequest({
          resource_types: ["Observation"],
          depth: "summary",
        }),
      )
      .catch(() => {});
    await overlay.waitForMode("approval", 15_000);

    // Send second request
    harnessPage
      .evaluate(() =>
        (window as any).__omh.sendMcpRequest({
          resource_types: ["Observation"],
          depth: "codes",
        }),
      )
      .catch(() => {});
    // Use Playwright locator (pierces shadow DOM) instead of document.querySelector
    const queueEl = harnessPage.locator("#openmyhealth-overlay-root .omh-queue");
    await queueEl.waitFor({ state: "visible", timeout: 15_000 });

    const queueLen = await overlay.getQueueLength();
    expect(queueLen).toBeGreaterThanOrEqual(1);

    await overlay.clickDeny();
    // Wait for the queued second request to appear in approval mode
    await overlay.waitForMode("approval", 10_000);
    await overlay.clickDeny();
  });

  test("approving first shows second request", async ({ harnessPage }) => {
    test.setTimeout(120_000);
    const overlay = new OverlayPage(harnessPage);
    // Send two requests
    harnessPage
      .evaluate(() =>
        (window as any).__omh.sendMcpRequest({
          resource_types: ["Observation"],
          depth: "summary",
        }),
      )
      .catch(() => {});
    await overlay.waitForMode("approval", 15_000);

    harnessPage
      .evaluate(() =>
        (window as any).__omh.sendMcpRequest({
          resource_types: ["Observation"],
          depth: "codes",
        }),
      )
      .catch(() => {});
    const queueEl = harnessPage.locator("#openmyhealth-overlay-root .omh-queue");
    await queueEl.waitFor({ state: "visible", timeout: 15_000 });

    // Approve first
    await overlay.clickApprove();
    // Wait for the queued second request to appear in approval mode
    await overlay.waitForMode("approval", 10_000);
    await overlay.clickDeny();
  });

  test("denying first shows second request", async ({ harnessPage }) => {
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

    harnessPage
      .evaluate(() =>
        (window as any).__omh.sendMcpRequest({
          resource_types: ["Observation"],
          depth: "codes",
        }),
      )
      .catch(() => {});
    const queueEl = harnessPage.locator("#openmyhealth-overlay-root .omh-queue");
    await queueEl.waitFor({ state: "visible", timeout: 15_000 });

    // Deny first
    await overlay.clickDeny();
    // Wait for the queued second request to appear in approval mode
    await overlay.waitForMode("approval", 10_000);
    await overlay.clickDeny();
  });

  test("three concurrent requests process sequentially", async ({
    harnessPage,
  }) => {
    test.setTimeout(120_000);
    const overlay = new OverlayPage(harnessPage);
    // Send 3 requests
    harnessPage
      .evaluate(() =>
        (window as any).__omh.sendMcpRequest({
          resource_types: ["Observation"],
          depth: "summary",
        }),
      )
      .catch(() => {});
    await overlay.waitForMode("approval", 15_000);

    harnessPage
      .evaluate(() =>
        (window as any).__omh.sendMcpRequest({
          resource_types: ["Observation"],
          depth: "codes",
        }),
      )
      .catch(() => {});
    harnessPage
      .evaluate(() =>
        (window as any).__omh.sendMcpRequest({
          resource_types: ["Observation"],
          depth: "detail",
        }),
      )
      .catch(() => {});
    const queueEl = harnessPage.locator("#openmyhealth-overlay-root .omh-queue");
    await expect(queueEl).toContainText(/\d+/, { timeout: 15_000 });

    const queueLen = await overlay.getQueueLength();
    expect(queueLen).toBeGreaterThanOrEqual(2);

    // Process all three
    for (let i = 0; i < 3; i++) {
      await overlay.waitForMode("approval", 10_000);
      await overlay.clickDeny();
    }
  });

  test("each queued request has independent timer", async ({
    harnessPage,
  }) => {
    test.setTimeout(120_000);
    const overlay = new OverlayPage(harnessPage);
    // Send first request
    harnessPage
      .evaluate(() =>
        (window as any).__omh.sendMcpRequest({
          resource_types: ["Observation"],
          depth: "summary",
        }),
      )
      .catch(() => {});
    await overlay.waitForMode("approval", 15_000);

    const firstTimer = await overlay.getRemainingSeconds();
    expect(firstTimer).toBeGreaterThan(5);

    // INTENTIONAL: timer observation window (5s delay before second request)
    await harnessPage.waitForTimeout(5000);
    harnessPage
      .evaluate(() =>
        (window as any).__omh.sendMcpRequest({
          resource_types: ["Observation"],
          depth: "codes",
        }),
      )
      .catch(() => {});

    // First timer should have decreased
    const firstTimerAfter = await overlay.getRemainingSeconds();
    expect(firstTimerAfter).toBeLessThan(firstTimer);

    // Deny first, second should have its own fresh timer
    await overlay.clickDeny();
    await overlay.waitForMode("approval", 10_000);

    const secondTimer = await overlay.getRemainingSeconds();
    // Second timer should be closer to 60 (its own deadline)
    expect(secondTimer).toBeGreaterThan(0);
    await overlay.clickDeny();
  });

  test("always-allowed requests skip queue", async ({ harnessPage }) => {
    test.setTimeout(120_000);
    const overlay = new OverlayPage(harnessPage);
    // First: enable always-allow
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
    // Wait for the "resolved" overlay to auto-hide (3s + buffer)
    await overlay.waitForMode("hidden", 10_000);

    // Second: should auto-approve without overlay
    const secondResponse = await harnessPage.evaluate(() =>
      (window as any).__omh.sendMcpRequest({
        resource_types: ["Observation"],
        depth: "summary",
      }),
    );
    expect((secondResponse as any).ok).toBe(true);
    // Should not have shown overlay (auto-approved in background)
    await overlay.waitForMode("hidden", 5_000);
    const visible = await overlay.isVisible();
    expect(visible).toBe(false);
  });
});
