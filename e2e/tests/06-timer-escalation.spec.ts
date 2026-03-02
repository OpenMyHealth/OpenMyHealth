import { test, expect } from "../fixtures/extension.fixture";
import { OverlayPage } from "../pages/overlay.page";
import { setupVault } from "../helpers/setup";

test.describe("Timer Escalation", () => {
  test.beforeEach(async ({ setupPage, vaultPage, harnessPage }) => {
    await setupVault(setupPage, vaultPage, harnessPage, {
      files: ["sample-lab-report.txt"],
      provider: "chatgpt",
      waitForBridge: true,
    });
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
    test.setTimeout(30_000);
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
    // INTENTIONAL: testing amber transition (E2E: 10s timeout, amber at 4s remaining)
    await harnessPage.waitForTimeout(7_000);
    const color = await overlay.getTimerColor();
    expect(["amber", "red"]).toContain(color);
    await overlay.clickDeny();
  });

  test("timer transitions to red at 5s", async ({ harnessPage }) => {
    test.setTimeout(30_000);
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
    // INTENTIONAL: testing red transition (E2E: 10s timeout, red at 2s remaining)
    await harnessPage.waitForTimeout(9_000);
    const color = await overlay.getTimerColor();
    expect(color).toBe("red");
    await overlay.clickDeny();
  });

  test("timeout auto-denies after 60s", async ({ harnessPage }) => {
    test.setTimeout(30_000);
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
    test.setTimeout(30_000);
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
    // INTENTIONAL: testing timeout behavior (E2E: 10s timeout + 2s buffer)
    await harnessPage.waitForTimeout(12_000);
    // INTENTIONAL: wait for timeout card auto-close (3s + buffer)
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
    // INTENTIONAL: testing 3-second countdown decrement
    await harnessPage.waitForTimeout(3000);
    const second = await overlay.getRemainingSeconds();
    expect(second).toBeLessThan(first);
    await overlay.clickDeny();
  });
});
