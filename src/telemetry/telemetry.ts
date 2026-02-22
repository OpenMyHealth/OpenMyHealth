export interface TelemetryEvent {
  type: string;
  at: string;
  properties?: Record<string, unknown>;
}

interface TelemetryState {
  enabled: boolean;
  queue: TelemetryEvent[];
}

export interface TelemetryStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(value: Record<string, unknown>): Promise<void>;
}

const STATE_KEY = "openchartTelemetryState";
const MAX_QUEUE_SIZE = 200;
const SENSITIVE_KEY_PATTERN = /(name|phone|ssn|birth|resident|jumin|email|address)/i;

function sanitizeProperties(properties: Record<string, unknown> = {}) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      out[key] = "[REDACTED]";
      continue;
    }

    if (typeof value === "string" && value.length > 120) {
      out[key] = `${value.slice(0, 117)}...`;
      continue;
    }

    out[key] = value;
  }
  return out;
}

async function getState(storage: TelemetryStorage): Promise<TelemetryState> {
  const result = await storage.get(STATE_KEY);
  const state = result[STATE_KEY] as TelemetryState | undefined;

  return (
    state ?? {
      enabled: false,
      queue: [],
    }
  );
}

export async function isTelemetryEnabled(storage: TelemetryStorage): Promise<boolean> {
  const state = await getState(storage);
  return state.enabled;
}

export async function setTelemetryEnabled(enabled: boolean, storage: TelemetryStorage) {
  const state = await getState(storage);
  await storage.set({
    [STATE_KEY]: {
      ...state,
      enabled,
    },
  });
}

export async function trackEvent(
  type: string,
  properties: Record<string, unknown>,
  storage: TelemetryStorage,
) {
  const state = await getState(storage);
  if (!state.enabled) {
    return;
  }

  const nextEvent: TelemetryEvent = {
    type,
    at: new Date().toISOString(),
    properties: sanitizeProperties(properties),
  };

  const queue = [...state.queue, nextEvent].slice(-MAX_QUEUE_SIZE);
  await storage.set({
    [STATE_KEY]: {
      enabled: true,
      queue,
    },
  });
}

export async function getTelemetryQueue(storage: TelemetryStorage): Promise<TelemetryEvent[]> {
  const state = await getState(storage);
  return state.queue;
}
