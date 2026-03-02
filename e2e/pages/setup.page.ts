import { type Page } from "@playwright/test";

export class SetupPage {
  constructor(private readonly page: Page) {}

  /** Wait for the setup page to be fully rendered (past bootstrap + React loading) */
  async waitForReady(): Promise<void> {
    await this.page.waitForFunction(
      () => {
        const boot = (window as any).__OMH_SETUP_BOOT_STATE__;
        if (!boot?.appMounted) return false;
        if (document.getElementById("setup-bootstrap-shell")) return false;
        const root = document.getElementById("root");
        if (!root) return false;
        return root.querySelectorAll('[class*="animate-pulse"]').length === 0;
      },
      { timeout: 15_000 },
    );
  }

  /** Fill the PIN setup input */
  async enterPin(digits: string): Promise<void> {
    await this.page.locator("#vault-pin-setup").fill(digits);
  }

  /** Fill the PIN confirm input */
  async confirmPin(digits: string): Promise<void> {
    await this.page.locator("#vault-pin-confirm").fill(digits);
  }

  /** Click submit button */
  async submitPin(): Promise<void> {
    await this.page.getByRole("button", { name: /PIN 설정 완료|PIN 설정 중/ }).click();
  }

  /** Complete full PIN setup: fill both inputs + submit (single form) */
  async setupFullPin(pin: string = "123456"): Promise<void> {
    await this.enterPin(pin);
    await this.confirmPin(pin);
    await this.submitPin();
  }

  /** Get error message text */
  async getErrorMessage(): Promise<string> {
    const el = this.page.locator("#vault-pin-setup-error");
    if (await el.isVisible().catch(() => false)) {
      return (await el.textContent()) ?? "";
    }
    return "";
  }

  /** Check if privacy anchor cards are visible */
  async isPrivacyAnchorVisible(): Promise<boolean> {
    const cards = this.page.locator("article");
    return (await cards.count()) >= 4;
  }

  /** Get privacy anchor card titles */
  async getPrivacyAnchorTitles(): Promise<string[]> {
    const headings = this.page.locator("article h3");
    return headings.allTextContents();
  }

  /** Check GitHub link */
  async getGitHubLink(): Promise<string | null> {
    const link = this.page.locator('a[href*="github.com"]').first();
    if (await link.isVisible().catch(() => false)) {
      return link.getAttribute("href");
    }
    return null;
  }

  /** Check for disclaimer text */
  async getDisclaimerText(): Promise<string> {
    const el = this.page.locator("text=전문 의료 조언").first();
    if (await el.isVisible().catch(() => false)) {
      return (await el.textContent()) ?? "";
    }
    // Try alternative text
    const el2 = this.page.locator("text=medical advice").first();
    if (await el2.isVisible().catch(() => false)) {
      return (await el2.textContent()) ?? "";
    }
    return "";
  }

  /** Wait for redirect to vault page */
  async waitForVaultRedirect(timeout = 15_000): Promise<void> {
    await this.page.waitForURL(/vault\.html/, { timeout, waitUntil: "domcontentloaded" });
  }

  /** Get language selector value */
  async getLocaleValue(): Promise<string> {
    return this.page.locator("#vault-locale").inputValue();
  }
}
