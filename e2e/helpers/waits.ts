import type { Page } from "@playwright/test";

/**
 * Wait for provider radio to be checked after selectProvider().
 * Replaces: waitForTimeout(1000) after selectProvider()
 */
export async function waitForProviderSelected(
  vaultPage: Page,
  provider: string,
): Promise<void> {
  await vaultPage.waitForFunction(
    (p: string) => {
      const radio = document.querySelector(
        `input#provider-${p}`,
      ) as HTMLInputElement | null;
      return radio?.checked === true;
    },
    provider,
    { timeout: 5000 },
  );
}

/**
 * Wait for lock screen to appear (upload section hidden).
 * Replaces: waitForTimeout(1000) after lockSession()
 */
export async function waitForLockScreen(vaultPage: Page): Promise<void> {
  await vaultPage.waitForFunction(
    () => {
      const uploadSection = Array.from(document.querySelectorAll("h2")).find(
        (el) => el.textContent?.includes("건강 기록 업로드"),
      );
      return !uploadSection || !(uploadSection as HTMLElement).checkVisibility();
    },
    { timeout: 5000 },
  );
}

/**
 * Wait for vault to be unlocked (upload section visible).
 * Replaces: waitForTimeout(1000) after unlock()
 */
export async function waitForUnlocked(vaultPage: Page): Promise<void> {
  await vaultPage.waitForFunction(
    () => {
      const uploadSection = Array.from(document.querySelectorAll("h2")).find(
        (el) => el.textContent?.includes("건강 기록 업로드"),
      );
      return (
        uploadSection != null &&
        (uploadSection as HTMLElement).checkVisibility() !== false
      );
    },
    { timeout: 5000 },
  );
}

/**
 * Wait for PIN error message to appear.
 * Replaces: waitForTimeout(500-1000) after wrong PIN
 */
export async function waitForPinError(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const el = document.getElementById("vault-pin-unlock-error");
      return (
        el !== null &&
        el.textContent !== "" &&
        (el as HTMLElement).checkVisibility() !== false
      );
    },
    { timeout: 5000 },
  );
}
