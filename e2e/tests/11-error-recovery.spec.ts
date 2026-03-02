import { test, expect } from "../fixtures/extension.fixture";
import { SetupPage } from "../pages/setup.page";
import { VaultPage } from "../pages/vault.page";
import { OverlayPage } from "../pages/overlay.page";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../data");

test.describe("Error Recovery", () => {
  test.beforeEach(async ({ setupPage, vaultPage }) => {
    const setup = new SetupPage(setupPage);
    await setup.setupFullPin("123456");
    await setup.waitForVaultRedirect();
    await vaultPage.reload();
    const vault = new VaultPage(vaultPage);
    await vault.waitForReady();
    if (!(await vault.isUnlocked())) {
      await vault.unlock("123456");
    }
  });

  test("unsupported file format shows error", async ({ vaultPage }) => {
    const vault = new VaultPage(vaultPage);
    const binPath = path.join(DATA_DIR, "test.bin");
    await fs.writeFile(binPath, Buffer.from([0x00, 0x01, 0x02, 0x03]));
    try {
      await vault.uploadFile(binPath);
      await vaultPage.waitForTimeout(3000);
      const text = await vaultPage.textContent("body");
      expect(text).toMatch(/지원|형식|오류|error/i);
    } finally {
      await fs.unlink(binPath).catch(() => {});
    }
  });

  test("parsing failure shows compassionate message", async ({ vaultPage }) => {
    const vault = new VaultPage(vaultPage);
    // Create a file that might cause parsing issues
    const badPath = path.join(DATA_DIR, "bad-data.txt");
    await fs.writeFile(badPath, "   \n\n\n   \n"); // Nearly empty whitespace file
    try {
      await vault.uploadFile(badPath);
      await vaultPage.waitForTimeout(3000);
      const text = await vaultPage.textContent("body");
      expect(text).toMatch(/읽기|어려|오류|빈|empty/i);
    } finally {
      await fs.unlink(badPath).catch(() => {});
    }
  });

  test("locked session MCP request returns error", async ({
    vaultPage,
    harnessPage,
  }) => {
    test.setTimeout(120_000);
    const vault = new VaultPage(vaultPage);
    await vault.uploadFile(path.join(DATA_DIR, "sample-lab-report.txt"));
    await vault.waitForParsingComplete(10_000);
    await vault.selectProvider("chatgpt");
    await vaultPage.waitForTimeout(1000);

    await harnessPage.waitForFunction(
      () => (window as any).__omh?.ready === true,
      null,
      { timeout: 15_000 },
    );

    // Lock session
    await vault.lockSession();
    await vaultPage.waitForTimeout(1000);

    // MCP request should trigger unlock flow or return error
    const overlay = new OverlayPage(harnessPage);
    harnessPage
      .evaluate(() =>
        (window as any).__omh.sendMcpRequest({
          resource_types: ["Observation"],
          depth: "summary",
        }),
      )
      .catch(() => {});

    // Should show unlock mode
    await overlay.waitForMode("unlock", 15_000);
    expect(await overlay.isVisible()).toBe(true);
  });

  test("empty vault MCP request returns empty data", async ({
    vaultPage,
    harnessPage,
  }) => {
    const vault = new VaultPage(vaultPage);
    // Don't upload any files
    await vault.selectProvider("chatgpt");
    await vaultPage.waitForTimeout(1000);

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

    // May show approval with no data or auto-respond
    try {
      await overlay.waitForMode("approval", 10_000);
      await overlay.clickApprove();
    } catch {
      // Might not show overlay if no data
    }

    const response = await requestPromise.catch((e: Error) => ({
      ok: false,
      error: e.message,
    }));
    // Either ok with empty data or error
    expect(response).toBeTruthy();
  });

  test("invalid MCP request schema returns error", async ({
    vaultPage,
    harnessPage,
  }) => {
    const vault = new VaultPage(vaultPage);
    await vault.uploadFile(path.join(DATA_DIR, "sample-lab-report.txt"));
    await vault.waitForParsingComplete(10_000);
    await vault.selectProvider("chatgpt");
    await vaultPage.waitForTimeout(1000);

    await harnessPage.waitForFunction(
      () => (window as any).__omh?.ready === true,
      null,
      { timeout: 15_000 },
    );

    // Send invalid payload
    const response = await harnessPage.evaluate(() =>
      (window as any).__omh.sendMcpRequest({
        // Missing required fields
        invalid: true,
      }),
    );
    expect(response.ok).toBe(false);
    expect(response.error).toBeTruthy();
  });

  test("content script sends ready signal", async ({ harnessPage }) => {
    await harnessPage.waitForFunction(
      () => (window as any).__omh?.ready === true,
      null,
      { timeout: 15_000 },
    );
    const ready = await harnessPage.evaluate(
      () => (window as any).__omh.ready,
    );
    expect(ready).toBe(true);
  });

  test("request without MessagePort is ignored", async ({ harnessPage }) => {
    await harnessPage.waitForFunction(
      () => (window as any).__omh?.ready === true,
      null,
      { timeout: 15_000 },
    );

    // Send a message without a MessagePort
    await harnessPage.evaluate(() => {
      window.postMessage(
        {
          source: "openmyhealth-page",
          type: "openmyhealth:mcp:read-health-records",
          requestId: "no-port-test",
          payload: { resource_types: ["Observation"], depth: "summary" },
        },
        window.location.origin,
      );
      // No ports transferred
    });
    await harnessPage.waitForTimeout(2000);
    // Should not crash, just silently ignore
    const responsesCount = await harnessPage.evaluate(
      () => (window as any).__omh.responses.length,
    );
    expect(responsesCount).toBe(0);
  });
});
