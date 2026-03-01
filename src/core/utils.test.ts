import {
  asArrayBuffer,
  fileStatusLabel,
  providerLabel,
  resourceLabel,
  secondsUntil,
  timingSafeEqual,
} from "./utils";

describe("resourceLabel", () => {
  it("returns label for Observation", () => {
    expect(resourceLabel("Observation")).toBe("🔬 검사 수치");
  });

  it("returns label for MedicationStatement", () => {
    expect(resourceLabel("MedicationStatement")).toBe("💊 처방약");
  });

  it("returns label for Condition", () => {
    expect(resourceLabel("Condition")).toBe("🩺 진단명");
  });

  it("returns label for DiagnosticReport", () => {
    expect(resourceLabel("DiagnosticReport")).toBe("🧾 영상·병리 보고서");
  });

  it("returns label for DocumentReference", () => {
    expect(resourceLabel("DocumentReference")).toBe("📁 진료기록");
  });
});

describe("providerLabel", () => {
  it("returns ChatGPT for chatgpt", () => {
    expect(providerLabel("chatgpt")).toBe("ChatGPT");
  });

  it("returns Claude for claude", () => {
    expect(providerLabel("claude")).toBe("Claude");
  });

  it("returns Gemini for gemini", () => {
    expect(providerLabel("gemini")).toBe("Gemini");
  });
});

describe("secondsUntil", () => {
  it("returns 0 for null", () => {
    expect(secondsUntil(null)).toBe(0);
  });

  it("returns 0 for 0", () => {
    expect(secondsUntil(0)).toBe(0);
  });

  it("returns positive seconds for future time", () => {
    const futureMs = Date.now() + 5000;
    const result = secondsUntil(futureMs);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(5);
  });

  it("returns 0 for past time", () => {
    const pastMs = Date.now() - 5000;
    expect(secondsUntil(pastMs)).toBe(0);
  });
});

describe("asArrayBuffer", () => {
  it("preserves data through roundtrip", () => {
    const input = new Uint8Array([1, 2, 3, 4, 5]);
    const ab = asArrayBuffer(input);
    const output = new Uint8Array(ab);
    expect(output).toEqual(input);
    expect(ab.byteLength).toBe(5);
  });

  it("handles offset Uint8Array (subarray)", () => {
    const full = new Uint8Array([10, 20, 30, 40, 50]);
    const sub = full.subarray(1, 4);
    expect(sub).toEqual(new Uint8Array([20, 30, 40]));
    const ab = asArrayBuffer(sub);
    const output = new Uint8Array(ab);
    expect(output).toEqual(new Uint8Array([20, 30, 40]));
    expect(ab.byteLength).toBe(3);
  });
});

describe("timingSafeEqual", () => {
  it("returns true for identical strings", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
  });

  it("returns false for strings differing in last char", () => {
    expect(timingSafeEqual("abc", "abd")).toBe(false);
  });

  it("returns false for different lengths", () => {
    expect(timingSafeEqual("abc", "ab")).toBe(false);
  });

  it("returns true for two empty strings", () => {
    expect(timingSafeEqual("", "")).toBe(true);
  });

  it("returns false when one is empty", () => {
    expect(timingSafeEqual("a", "")).toBe(false);
  });

  it("always returns a boolean and does not short-circuit", () => {
    const result = timingSafeEqual("secret", "secreX");
    expect(typeof result).toBe("boolean");
    expect(result).toBe(false);

    const resultTrue = timingSafeEqual("match", "match");
    expect(typeof resultTrue).toBe("boolean");
    expect(resultTrue).toBe(true);
  });
});

describe("fileStatusLabel", () => {
  it("returns '처리 중' for processing", () => {
    expect(fileStatusLabel("processing")).toBe("처리 중");
  });

  it("returns '완료' for done", () => {
    expect(fileStatusLabel("done")).toBe("완료");
  });

  it("returns '오류' for error", () => {
    expect(fileStatusLabel("error")).toBe("오류");
  });
});
