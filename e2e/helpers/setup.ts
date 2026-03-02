import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { SetupPage } from "../pages/setup.page";
import { VaultPage } from "../pages/vault.page";
import { waitForLockScreen, waitForProviderSelected } from "./waits";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const DATA_DIR = path.resolve(__dirname, "../data");

export interface SetupVaultOptions {
  pin?: string;
  files?: string[];
  provider?: "chatgpt" | "claude";
  waitForBridge?: boolean;
  lockVault?: boolean;
}

export async function setupVault(
  setupPage: Page,
  vaultPage: Page,
  harnessPage?: Page,
  options: SetupVaultOptions = {},
): Promise<VaultPage> {
  const {
    pin = "123456",
    files = [],
    provider,
    waitForBridge = false,
    lockVault = false,
  } = options;

  const setup = new SetupPage(setupPage);
  await setup.setupFullPin(pin);
  await setup.waitForVaultRedirect();
  await vaultPage.reload();

  const vault = new VaultPage(vaultPage);
  await vault.waitForReady();

  if (lockVault) {
    if (await vault.isUnlocked()) {
      await vault.lockSession();
      await waitForLockScreen(vaultPage);
    }
    return vault;
  }

  if (!(await vault.isUnlocked())) {
    await vault.unlock(pin);
  }

  for (const file of files) {
    await vault.uploadFile(path.join(DATA_DIR, file));
    await vault.waitForParsingComplete(10_000);
  }

  if (provider) {
    await vault.selectProvider(provider);
    await waitForProviderSelected(vaultPage, provider);
  }

  if (waitForBridge && harnessPage) {
    await harnessPage.waitForFunction(
      () => (window as any).__omh?.ready === true,
      null,
      { timeout: 15_000 },
    );
  }

  return vault;
}
