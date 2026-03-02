import { type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

export class VaultPage {
  constructor(private readonly page: Page) {}

  /** Wait for the vault page to be fully rendered (past bootstrap + React loading) */
  async waitForReady(): Promise<void> {
    await this.page.waitForFunction(
      () => {
        const boot = (window as any).__OMH_VAULT_BOOT_STATE__;
        if (!boot?.appMounted) return false;
        if (document.getElementById("vault-bootstrap-shell")) return false;
        const root = document.getElementById("root");
        if (!root) return false;
        return root.querySelectorAll('[class*="animate-pulse"]').length === 0;
      },
      { timeout: 15_000 },
    );
  }

  /** Fill unlock PIN and submit */
  async unlock(pin: string): Promise<void> {
    await this.page.locator("#vault-pin-unlock").fill(pin);
    await this.page.getByRole("button", { name: /잠금 해제|확인 중/ }).click();
  }

  /** Get unlock error message */
  async getUnlockError(): Promise<string> {
    const el = this.page.locator("#vault-pin-unlock-error");
    if (await el.isVisible().catch(() => false)) {
      return (await el.textContent()) ?? "";
    }
    return "";
  }

  /** Upload a file using the hidden file input (buffer mode for extension pages) */
  async uploadFile(filePath: string): Promise<void> {
    const buffer = await fs.readFile(filePath);
    const name = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".txt": "text/plain",
      ".text": "text/plain",
      ".pdf": "application/pdf",
      ".json": "application/json",
      ".xml": "application/xml",
      ".csv": "text/csv",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".heic": "image/heic",
    };
    const fileInput = this.page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name,
      mimeType: mimeMap[ext] ?? "application/octet-stream",
      buffer,
    });
  }

  /** Wait for parsing to complete (all file cards show "완료" or "오류") */
  async waitForParsingComplete(timeout = 30_000): Promise<void> {
    await this.page.waitForFunction(
      () => {
        const container = document.querySelector('[aria-live="polite"]');
        if (!container) return false;
        const cards = container.querySelectorAll(":scope > div");
        if (cards.length === 0) return false;
        return Array.from(cards).every((card) => {
          const text = card.textContent ?? "";
          return text.includes("완료") || text.includes("오류");
        });
      },
      null,
      { timeout },
    );
  }

  /** Get file card texts */
  async getFileCards(): Promise<string[]> {
    const cards = this.page.locator('[aria-live="polite"] > div');
    return cards.allTextContents();
  }

  /** Get number of file cards */
  async getFileCardCount(): Promise<number> {
    return this.page.locator('[aria-live="polite"] > div').count();
  }

  /** Download file by index */
  async downloadFile(index: number): Promise<void> {
    const cards = this.page.locator('[aria-live="polite"] > div');
    const card = cards.nth(index);
    await card.getByRole("button", { name: /다운로드/ }).click();
  }

  /** Delete file by index */
  async deleteFile(index: number): Promise<void> {
    const cards = this.page.locator('[aria-live="polite"] > div');
    const card = cards.nth(index);
    await card.getByRole("button", { name: /삭제/ }).click();
  }

  /** Select AI provider by name */
  async selectProvider(name: "chatgpt" | "claude"): Promise<void> {
    const label = this.page.locator(`label[for="provider-${name}"]`);
    await label.click();
  }

  /** Get the currently selected provider */
  async getSelectedProvider(): Promise<string | null> {
    for (const name of ["chatgpt", "claude", "gemini"]) {
      const radio = this.page.locator(`input#provider-${name}`);
      if (await radio.isChecked()) {
        return name;
      }
    }
    return null;
  }

  /** Get data summary section content */
  async getDataSummary(): Promise<string> {
    const section = this.page.locator('section:has-text("건강 기록")').first();
    return (await section.textContent()) ?? "";
  }

  /** Get audit log entries */
  async getAuditLogs(): Promise<string[]> {
    const section = this.page.locator('h2:has-text("공유 이력")').locator("..");
    const logs = section.locator(":scope > div > div");
    const count = await logs.count();
    if (count === 0) return [];
    return logs.allTextContents();
  }

  /** Get permission entries */
  async getPermissions(): Promise<string[]> {
    const section = this.page.locator('h2:has-text("자동 공유 관리")').locator("..");
    const perms = section.locator(":scope > div > div");
    const count = await perms.count();
    if (count === 0) return [];
    return perms.allTextContents();
  }

  /** Revoke permission by index */
  async revokePermission(index: number): Promise<void> {
    const section = this.page.locator('h2:has-text("자동 공유 관리")').locator("..");
    const perms = section.locator(":scope > div > div");
    const perm = perms.nth(index);
    await perm.getByRole("button", { name: /해제/ }).click();
  }

  /** Lock the session */
  async lockSession(): Promise<void> {
    const lockBtn = this.page.getByRole("button", { name: /잠그기|잠금|lock/i });
    if (await lockBtn.isVisible().catch(() => false)) {
      await lockBtn.click();
    }
  }

  /** Check if vault is unlocked (content sections visible) */
  async isUnlocked(): Promise<boolean> {
    const uploadSection = this.page.locator('h2:has-text("건강 기록 업로드")');
    return uploadSection.isVisible().catch(() => false);
  }
}
