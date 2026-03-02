import { expect, type Page, type Locator } from "@playwright/test";

type OverlayMode = "hidden" | "approval" | "unlock" | "timeout" | "resolved" | "connected";

export class OverlayPage {
  readonly page: Page;
  private readonly root: Locator;

  constructor(page: Page) {
    this.page = page;
    // E2E builds use open shadow DOM, so we can pierce into it
    this.root = page.locator("#openmyhealth-overlay-root");
  }

  private shell(): Locator {
    return this.root.locator("div.omh-shell").first();
  }

  async waitForMode(mode: OverlayMode, timeoutMs: number = 15_000): Promise<void> {
    if (mode === "hidden") {
      await this.shell().waitFor({ state: "hidden", timeout: timeoutMs }).catch(() => {
        // Shell might not exist at all when hidden
      });
      return;
    }
    await this.shell().waitFor({ state: "visible", timeout: timeoutMs });
  }

  async isVisible(): Promise<boolean> {
    try {
      return await this.shell().isVisible();
    } catch {
      return false;
    }
  }

  async clickApprove(): Promise<void> {
    const btn = this.root.locator("button.omh-primary").first();
    await btn.click();
  }

  async clickDeny(): Promise<void> {
    const btn = this.root.locator("button.omh-secondary, button:has-text('거절')").first();
    await expect(btn).toBeEnabled({ timeout: 10_000 });
    await btn.click();
  }

  async clickClose(): Promise<void> {
    const btn = this.root.locator("button.omh-close").first();
    await btn.click();
  }

  async getTitle(): Promise<string> {
    const title = this.root.locator("#omh-title, .omh-title").first();
    return (await title.textContent()) ?? "";
  }

  async getSummary(): Promise<string> {
    const summary = this.root.locator(".omh-summary").first();
    return (await summary.textContent()) ?? "";
  }

  async getPrivacyMessage(): Promise<string> {
    const desc = this.root.locator("#omh-desc, .omh-desc").first();
    return (await desc.textContent()) ?? "";
  }

  async getRemainingSeconds(): Promise<number> {
    const timer = this.root.locator(".omh-timer-ring").first();
    const text = (await timer.textContent()) ?? "0";
    const num = parseInt(text.replace(/\D/g, ""), 10);
    return isNaN(num) ? 0 : num;
  }

  async getTimerColor(): Promise<"blue" | "amber" | "red"> {
    const shell = this.shell();
    const className = (await shell.getAttribute("class")) ?? "";
    if (className.includes("red")) return "red";
    if (className.includes("amber")) return "amber";
    return "blue";
  }

  async expandDetail(): Promise<void> {
    const btn = this.root.locator("button.omh-link:has-text('상세')").first();
    await btn.click();
  }

  async toggleResourceType(index: number): Promise<void> {
    const checkboxes = this.root.locator(".omh-type-group > label.omh-checkbox-row input[type='checkbox']");
    await checkboxes.nth(index).click();
  }

  async toggleItem(typeIndex: number, itemIndex: number): Promise<void> {
    const typeGroups = this.root.locator(".omh-type-group");
    const group = typeGroups.nth(typeIndex);
    const subCheckboxes = group.locator("label.omh-sub-checkbox-row input[type='checkbox']");
    await subCheckboxes.nth(itemIndex).click();
  }

  async toggleAlwaysAllow(): Promise<void> {
    const checkbox = this.root.locator("label.omh-checkbox-row:has-text('자동 허용') input[type='checkbox']");
    await checkbox.click();
  }

  async confirmAlwaysAllow(): Promise<void> {
    const btn = this.root.locator("button.omh-confirm-yes").first();
    await btn.click();
  }

  async cancelAlwaysAllow(): Promise<void> {
    const btn = this.root.locator("button.omh-confirm-no").first();
    await btn.click();
  }

  async getQueueLength(): Promise<number> {
    const queue = this.root.locator(".omh-queue");
    if (!(await queue.isVisible().catch(() => false))) {
      return 0;
    }
    const text = (await queue.textContent()) ?? "";
    const match = text.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  async getStageGuide(): Promise<string> {
    const meta = this.root.locator(".omh-meta").first();
    return (await meta.textContent()) ?? "";
  }

  async getActionError(): Promise<string> {
    const error = this.root.locator(".omh-error").first();
    if (!(await error.isVisible().catch(() => false))) {
      return "";
    }
    return (await error.textContent()) ?? "";
  }

  async getEyebrow(): Promise<string> {
    const eyebrow = this.root.locator(".omh-eyebrow").first();
    return (await eyebrow.textContent()) ?? "";
  }

  async getConnectedText(): Promise<string> {
    const content = this.root.locator(".omh-content p").first();
    return (await content.textContent()) ?? "";
  }

  async isApproveDisabled(): Promise<boolean> {
    const btn = this.root.locator("button.omh-primary").first();
    return await btn.isDisabled();
  }
}
