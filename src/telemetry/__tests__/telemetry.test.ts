import {
  getTelemetryQueue,
  isTelemetryEnabled,
  setTelemetryEnabled,
  trackEvent,
} from "../telemetry";

describe("telemetry", () => {
  it("옵트인 전에는 이벤트를 저장하지 않는다", async () => {
    let memory: Record<string, unknown> = {};
    const storage = {
      get: async (key: string) => ({ [key]: memory[key] }),
      set: async (value: Record<string, unknown>) => {
        memory = { ...memory, ...value };
      },
    };

    await trackEvent("draft_build", { count: 1 }, storage);
    expect(await getTelemetryQueue(storage)).toEqual([]);
  });

  it("옵트인 후 이벤트를 저장하고 민감 키를 마스킹한다", async () => {
    let memory: Record<string, unknown> = {};
    const storage = {
      get: async (key: string) => ({ [key]: memory[key] }),
      set: async (value: Record<string, unknown>) => {
        memory = { ...memory, ...value };
      },
    };

    await setTelemetryEnabled(true, storage);
    expect(await isTelemetryEnabled(storage)).toBe(true);

    await trackEvent(
      "draft_insert",
      {
        provider: "chatgpt",
        userName: "홍길동",
        userPhone: "01012341234",
      },
      storage,
    );

    const queue = await getTelemetryQueue(storage);
    expect(queue).toHaveLength(1);
    expect(queue[0].properties?.userName).toBe("[REDACTED]");
    expect(queue[0].properties?.userPhone).toBe("[REDACTED]");
    expect(queue[0].properties?.provider).toBe("chatgpt");
  });
});
