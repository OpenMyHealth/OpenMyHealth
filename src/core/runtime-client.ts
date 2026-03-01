export type RuntimeOkEnvelope = { ok: boolean };

export interface RuntimeSendOptions {
  timeoutMs: number;
  timeoutMessage: string;
  invalidResponseMessage: string;
  transportErrorMessage: string;
}

function isOkEnvelope(value: unknown): value is RuntimeOkEnvelope {
  return Boolean(
    value
      && typeof value === "object"
      && "ok" in value
      && typeof (value as { ok?: unknown }).ok === "boolean",
  );
}

function readableError(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  return String(value);
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    promise
      .then((value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        globalThis.clearTimeout(timer);
        reject(error);
      });
  });
}

export async function sendRuntimeMessage<T extends RuntimeOkEnvelope>(
  message: Record<string, unknown>,
  options: RuntimeSendOptions,
): Promise<T> {
  let response: unknown;
  try {
    response = await withTimeout(browser.runtime.sendMessage(message), options.timeoutMs, options.timeoutMessage);
  } catch (error) {
    const detail = readableError(error);
    if (detail === options.timeoutMessage) {
      throw error;
    }
    throw new Error(`${options.transportErrorMessage} (${detail})`);
  }

  if (!isOkEnvelope(response)) {
    throw new Error(options.invalidResponseMessage);
  }

  return response as T;
}
