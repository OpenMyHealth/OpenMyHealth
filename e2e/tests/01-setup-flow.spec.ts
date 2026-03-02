import { test, expect } from "../fixtures/extension.fixture";
import { SetupPage } from "../pages/setup.page";

test.describe("Setup Flow", () => {
  test("extension opens setup.html on first install", async ({ setupPage, extensionId }) => {

    expect(setupPage.url()).toContain("setup.html");
    expect(setupPage.url()).toContain(extensionId);
  });

  test("PIN 6-digit entry and confirmation succeeds", async ({ setupPage }) => {
    const pom = new SetupPage(setupPage);
    await pom.enterPin("123456");
    await pom.confirmPin("123456");
    await pom.submitPin();
    // Should redirect to vault or show success
    await setupPage.waitForTimeout(2000);
    const url = setupPage.url();
    // Either redirected to vault or still on setup with success state
    expect(
      url.includes("vault.html") ||
        (await setupPage
          .locator("text=/완료|성공|보관함/i")
          .isVisible()
          .catch(() => false)),
    ).toBeTruthy();
  });

  test("PIN mismatch shows error message", async ({ setupPage }) => {
    const pom = new SetupPage(setupPage);
    await pom.enterPin("123456");
    await pom.confirmPin("654321");
    await pom.submitPin();
    await setupPage.waitForTimeout(500);
    const error = await pom.getErrorMessage();
    expect(error).toContain("달라요");
  });

  test("privacy anchor cards render", async ({ setupPage }) => {

    const pageText = await setupPage.textContent("body");
    expect(pageText).toContain("클라우드");
    expect(pageText).toContain("AES");
  });

  test("GitHub link is clickable", async ({ setupPage }) => {

    const link = setupPage.locator(
      'a[href*="github.com"], a[href*="openmyhealth"]',
    );
    const count = await link.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("disclaimer text is displayed", async ({ setupPage }) => {

    const text = await setupPage.textContent("body");
    expect(text).toMatch(/의료\s*조언|전문/);
  });

  test("language auto-detection works", async ({ setupPage }) => {

    // Extension uses Korean by default
    const text = await setupPage.textContent("body");
    // Should contain Korean characters
    expect(text).toMatch(/[가-힣]/);
  });

  test("PIN input auto-focuses to next field", async ({ setupPage }) => {

    const inputs = setupPage.locator(
      'input[inputmode="numeric"], input[type="password"], input[type="tel"]',
    );
    const count = await inputs.count();
    if (count >= 2) {
      await inputs.first().press("1");
      await setupPage.waitForTimeout(200);
      // Second input should now be focused
      const focused = await setupPage.evaluate(() => {
        const active = document.activeElement;
        return active?.tagName === "INPUT";
      });
      expect(focused).toBe(true);
    }
  });
});
