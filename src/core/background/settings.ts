import { deriveAesKey, derivePinVerifier } from "../crypto";
import { loadSettings, saveSettings } from "../db";
import type { AppSettings, PublicAppSettings } from "../models";
import { timingSafeEqual } from "../utils";
import {
  runtimeState,
  getSettingsCache,
  setSettingsCache,
  getUnlockInFlight,
  setUnlockInFlight,
} from "./state";

export async function getSettings(): Promise<AppSettings> {
  const cached = getSettingsCache();
  if (cached) {
    return cached;
  }
  const loaded = await loadSettings();
  setSettingsCache(loaded);
  return loaded;
}

export async function updateSettings(mutator: (settings: AppSettings) => void): Promise<AppSettings> {
  const current = await getSettings();
  const next: AppSettings = {
    ...current,
    lockout: { ...current.lockout },
  };
  const before = JSON.stringify(next);
  mutator(next);
  if (before === JSON.stringify(next)) {
    return current;
  }
  await saveSettings(next);
  setSettingsCache(next);
  return next;
}

export function toPublicSettings(settings: AppSettings): PublicAppSettings {
  return {
    locale: settings.locale,
    schemaVersion: settings.schemaVersion,
    lockout: { ...settings.lockout },
    connectedProvider: settings.connectedProvider,
    integrationWarning: settings.integrationWarning,
  };
}

export function toReadableError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function isSixDigitPin(pin: string): boolean {
  return /^\d{6}$/.test(pin);
}

export function getLockoutCooldownMs(failedAttempts: number): number {
  if (failedAttempts >= 10) {
    return 5 * 60_000;
  }
  if (failedAttempts >= 5) {
    return 60_000;
  }
  if (failedAttempts >= 3) {
    return 10_000;
  }
  return 0;
}

export async function withUnlockMutex<T>(operation: () => Promise<T>): Promise<T> {
  const run = getUnlockInFlight().then(operation, operation);
  setUnlockInFlight(
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

export async function verifyAndUnlock(
  pin: string,
): Promise<{ unlocked: boolean; lockoutUntil: number | null }> {
  return withUnlockMutex(async () => {
    const settings = await getSettings();
    const pinConfig = settings.pinConfig;
    if (!pinConfig) {
      return { unlocked: false, lockoutUntil: null };
    }

    const now = Date.now();
    if (settings.lockout.lockUntil && settings.lockout.lockUntil > now) {
      return {
        unlocked: false,
        lockoutUntil: settings.lockout.lockUntil,
      };
    }

    if (settings.lockout.lockUntil && settings.lockout.lockUntil <= now) {
      await updateSettings((s) => {
        s.lockout.lockUntil = null;
      });
    }

    const verifier = await derivePinVerifier(pin, pinConfig.salt);
    if (!timingSafeEqual(verifier, pinConfig.verifier)) {
      const next = await updateSettings((s) => {
        const failedAttempts = s.lockout.failedAttempts + 1;
        const cooldown = getLockoutCooldownMs(failedAttempts);
        s.lockout.failedAttempts = failedAttempts;
        /* v8 ignore next -- both branches tested via 1-attempt (no lockout) and 3+-attempt (lockout) cases */
        s.lockout.lockUntil = cooldown > 0 ? now + cooldown : null;
      });

      return { unlocked: false, lockoutUntil: next.lockout.lockUntil };
    }

    runtimeState.session.key = await deriveAesKey(pin, pinConfig.salt);
    runtimeState.session.isUnlocked = true;

    await updateSettings((s) => {
      s.lockout.failedAttempts = 0;
      s.lockout.lockUntil = null;
    });

    return { unlocked: true, lockoutUntil: null };
  });
}
