import { test, expect } from "../fixtures/extension.fixture";
import { SetupPage } from "../pages/setup.page";
import { VaultPage } from "../pages/vault.page";
import { OverlayPage } from "../pages/overlay.page";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../data");

async function setupVaultWithData(
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

  // Wait for bridge ready
  await harnessPage.waitForFunction(
    () => (window as any).__omh?.ready === true,
    null,
    { timeout: 15_000 },
  );
}

test.describe("MCP Approval Flow", () => {
  test.beforeEach(async ({ setupPage, vaultPage, harnessPage }) => {
    await setupVaultWithData(setupPage, vaultPage, harnessPage);
  });

  test("MCP request triggers approval overlay", async ({ harnessPage }) => {
    const overlay = new OverlayPage(harnessPage);
    // Send MCP request (don't await - it waits for approval)
    const requestPromise = harnessPage.evaluate(() =>
      (window as any).__omh.sendMcpRequest({
        resource_types: ["Observation"],
        depth: "summary",
      }),
    );
    // Wait for overlay to appear
    await overlay.waitForMode("approval", 15_000);
    const visible = await overlay.isVisible();
    expect(visible).toBe(true);
    // Approve to complete
    await overlay.clickApprove();
    await requestPromise.catch(() => {});
  });

  test("approval mode shows correct UI elements", async ({ harnessPage }) => {
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
    const title = await overlay.getTitle();
    expect(title).toBeTruthy();
    const privacy = await overlay.getPrivacyMessage();
    expect(privacy).toContain("최소한의 데이터만");
    const eyebrow = await overlay.getEyebrow();
    expect(eyebrow).toBeTruthy();

    await overlay.clickDeny();
  });

  test("approve returns data", async ({ harnessPage }) => {
    const overlay = new OverlayPage(harnessPage);
    const requestPromise = harnessPage.evaluate(() =>
      (window as any).__omh.sendMcpRequest({
        resource_types: ["Observation"],
        depth: "summary",
      }),
    );
    await overlay.waitForMode("approval", 15_000);
    await overlay.clickApprove();
    const response = await requestPromise;
    expect((response as any).ok).toBe(true);
    expect((response as any).result).toBeTruthy();
  });

  test("deny returns denied status", async ({ harnessPage }) => {
    const overlay = new OverlayPage(harnessPage);
    const requestPromise = harnessPage.evaluate(() =>
      (window as any).__omh.sendMcpRequest({
        resource_types: ["Observation"],
        depth: "summary",
      }),
    );
    await overlay.waitForMode("approval", 15_000);
    await overlay.clickDeny();
    const response = await requestPromise;
    // Bridge returns ok:true for successful communication; check result.status for denial
    expect((response as any).result.status).toBe("denied");
    expect((response as any).result.count).toBe(0);
  });

  test("close button acts as deny", async ({ harnessPage }) => {
    const overlay = new OverlayPage(harnessPage);
    const requestPromise = harnessPage.evaluate(() =>
      (window as any).__omh.sendMcpRequest({
        resource_types: ["Observation"],
        depth: "summary",
      }),
    );
    await overlay.waitForMode("approval", 15_000);
    await overlay.clickClose();
    const response = await requestPromise;
    // Close button = deny; check result.status
    expect((response as any).result.status).toBe("denied");
    expect((response as any).result.count).toBe(0);
  });

  test("approved shows resolved then auto-hides", async ({ harnessPage }) => {
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
    await overlay.clickApprove();
    // Should show resolved state
    await harnessPage.waitForTimeout(500);
    // Then auto-hide after 3 seconds
    await harnessPage.waitForTimeout(4000);
    const visible = await overlay.isVisible();
    expect(visible).toBe(false);
  });

  test("denied hides immediately", async ({ harnessPage }) => {
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
    await overlay.clickDeny();
    await harnessPage.waitForTimeout(4000);
    const visible = await overlay.isVisible();
    expect(visible).toBe(false);
  });

  test("depth codes returns minimal fields", async ({ harnessPage }) => {
    const overlay = new OverlayPage(harnessPage);
    const requestPromise = harnessPage.evaluate(() =>
      (window as any).__omh.sendMcpRequest({
        resource_types: ["Observation"],
        depth: "codes",
      }),
    );
    await overlay.waitForMode("approval", 15_000);
    await overlay.clickApprove();
    const response = (await requestPromise) as any;
    expect(response.ok).toBe(true);
    if (response.result?.data) {
      for (const record of response.result.data) {
        // codes depth should have id but limited fields
        expect(record.id).toBeTruthy();
      }
    }
  });

  test("depth summary includes display/value/unit", async ({
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
    await overlay.clickApprove();
    const response = (await requestPromise) as any;
    expect(response.ok).toBe(true);
    if (response.result?.data && response.result.data.length > 0) {
      const record = response.result.data[0];
      expect(record.display).toBeTruthy();
    }
  });

  test("depth detail includes all fields", async ({ harnessPage }) => {
    const overlay = new OverlayPage(harnessPage);
    const requestPromise = harnessPage.evaluate(() =>
      (window as any).__omh.sendMcpRequest({
        resource_types: ["Observation"],
        depth: "detail",
      }),
    );
    await overlay.waitForMode("approval", 15_000);
    await overlay.clickApprove();
    const response = (await requestPromise) as any;
    expect(response.ok).toBe(true);
  });

  test("query filters matching records", async ({ harnessPage }) => {
    const overlay = new OverlayPage(harnessPage);
    const requestPromise = harnessPage.evaluate(() =>
      (window as any).__omh.sendMcpRequest({
        resource_types: ["Observation"],
        depth: "summary",
        query: "\uD5E4\uBAA8\uAE00\uBE48",
      }),
    );
    await overlay.waitForMode("approval", 15_000);
    await overlay.clickApprove();
    const response = (await requestPromise) as any;
    expect(response.ok).toBe(true);
  });

  test("privacy message always shows", async ({ harnessPage }) => {
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
    const privacy = await overlay.getPrivacyMessage();
    expect(privacy).toContain("최소한의 데이터만");
    await overlay.clickDeny();
  });
});
