import { test, expect } from "../fixtures/extension.fixture";
import { VaultPage } from "../pages/vault.page";
import { setupVault } from "../helpers/setup";
import { waitForUnlocked, waitForPinError } from "../helpers/waits";

test.describe("PIN Security", () => {
  test.beforeEach(async ({ setupPage, vaultPage }) => {
    await setupVault(setupPage, vaultPage, undefined, { lockVault: true });
  });

  test("correct PIN unlocks vault", async ({ vaultPage }) => {
    const vault = new VaultPage(vaultPage);
    await vault.unlock("123456");
    await waitForUnlocked(vaultPage);
    // Should see vault content, not PIN input
    const hasContent = await vaultPage
      .locator("text=/업로드|파일|건강|보관/i")
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    expect(hasContent).toBe(true);
  });

  test("wrong PIN shows error message", async ({ vaultPage }) => {
    const vault = new VaultPage(vaultPage);
    await vault.unlock("999999");
    await waitForPinError(vaultPage);
    const text = await vaultPage.textContent("body");
    expect(text).toMatch(/다시|틀|오류|잘못/i);
  });

  test("3 failures triggers cooldown timer", async ({ vaultPage }) => {
    const vault = new VaultPage(vaultPage);
    for (let i = 0; i < 3; i++) {
      await vault.unlock("999999");
      await waitForPinError(vaultPage);
    }
    const text = await vaultPage.textContent("body");
    expect(text).toMatch(/잠시|초|대기|쿨다운/i);
  });

  test("5 failures shows forgot PIN hint", async ({ vaultPage }) => {
    test.setTimeout(120_000);
    const vault = new VaultPage(vaultPage);
    for (let i = 0; i < 5; i++) {
      await vault.unlock("999999");
      // INTENTIONAL: cooldown between PIN attempts
      await vaultPage.waitForTimeout(2000);
      // Wait for any cooldown to pass
      const timerText = await vaultPage.textContent("body");
      if (timerText?.match(/\d+초/)) {
        // INTENTIONAL: waiting for 15-second cooldown timer
        await vaultPage.waitForTimeout(15_000);
      }
    }
    const text = await vaultPage.textContent("body");
    expect(text).toMatch(/잊으셨|비밀번호|초기화|forgot/i);
  });

  test("cooldown timer allows retry after expiry", async ({ vaultPage }) => {
    test.setTimeout(120_000);
    const vault = new VaultPage(vaultPage);
    for (let i = 0; i < 3; i++) {
      await vault.unlock("999999");
      await waitForPinError(vaultPage);
    }
    // INTENTIONAL: waiting for 30-second cooldown timer to expire
    await vaultPage.waitForTimeout(35_000);
    // Should be able to try again
    const inputs = vaultPage.locator(
      'input[inputmode="numeric"], input[type="password"], input[type="tel"]',
    );
    const isEnabled = await inputs.first().isEnabled().catch(() => false);
    expect(isEnabled).toBe(true);
  });

  test("success resets failed attempts", async ({ vaultPage }) => {
    const vault = new VaultPage(vaultPage);
    // Fail twice
    for (let i = 0; i < 2; i++) {
      await vault.unlock("999999");
      await waitForPinError(vaultPage);
    }
    // Succeed
    await vault.unlock("123456");
    await waitForUnlocked(vaultPage);
    const hasContent = await vaultPage
      .locator("text=/업로드|파일|건강|보관/i")
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    expect(hasContent).toBe(true);
  });

  test("PIN is masked with dots", async ({ vaultPage }) => {
    const inputs = vaultPage.locator('input[type="password"]');
    const count = await inputs.count();
    if (count > 0) {
      const type = await inputs.first().getAttribute("type");
      expect(type).toBe("password");
    } else {
      // PIN inputs might use inputmode=numeric with masking
      const numericInputs = vaultPage.locator('input[inputmode="numeric"]');
      expect(await numericInputs.count()).toBeGreaterThan(0);
    }
  });

  test("non-numeric input is ignored", async ({ vaultPage }) => {
    const inputs = vaultPage.locator(
      'input[inputmode="numeric"], input[type="password"], input[type="tel"]',
    );
    const firstInput = inputs.first();
    if (await firstInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await firstInput.type("abc");
      const value = await firstInput.inputValue();
      // Should either be empty or contain no letters
      expect(value).not.toMatch(/[a-zA-Z]/);
    }
  });
});
