import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  readableError,
  summarizeUploadErrors,
  lockoutGuide,
  humanizeUploadError,
  statusTone,
  withConnectionHint,
  sendVaultMessage,
  sendUploadMessage,
} from "./runtime";

// Mock the runtime-client module that sendVaultMessage/sendUploadMessage depend on
vi.mock("../../src/core/runtime-client", () => ({
  sendRuntimeMessage: vi.fn(),
}));

import { sendRuntimeMessage } from "../../src/core/runtime-client";
const mockSendRuntimeMessage = vi.mocked(sendRuntimeMessage);

beforeEach(() => {
  mockSendRuntimeMessage.mockReset();
});

describe("readableError", () => {
  it("returns message from Error instance", () => {
    expect(readableError(new Error("test error"))).toBe("test error");
  });

  it("returns string representation for non-Error", () => {
    expect(readableError("plain string")).toBe("plain string");
  });

  it("returns string representation for number", () => {
    expect(readableError(42)).toBe("42");
  });

  it("returns 'null' for null", () => {
    expect(readableError(null)).toBe("null");
  });

  it("returns 'undefined' for undefined", () => {
    expect(readableError(undefined)).toBe("undefined");
  });

  it("returns object string for object", () => {
    expect(readableError({ key: "val" })).toBe("[object Object]");
  });
});

describe("summarizeUploadErrors", () => {
  it("returns single error as-is", () => {
    expect(summarizeUploadErrors(["error A"])).toBe("error A");
  });

  it("joins two errors with /", () => {
    expect(summarizeUploadErrors(["error A", "error B"])).toBe("error A / error B");
  });

  it("shows remainder count for 3 errors", () => {
    expect(summarizeUploadErrors(["a", "b", "c"])).toBe("a / b 외 1건");
  });

  it("shows remainder count for 5 errors", () => {
    expect(summarizeUploadErrors(["a", "b", "c", "d", "e"])).toBe("a / b 외 3건");
  });
});

describe("lockoutGuide", () => {
  it("returns recovery impossible message for >= 300s", () => {
    const result = lockoutGuide(300);
    expect(result).toContain("300초");
    expect(result).toContain("복구가 불가능합니다");
  });

  it("returns recovery impossible message for 600s", () => {
    const result = lockoutGuide(600);
    expect(result).toContain("600초");
    expect(result).toContain("복구가 불가능합니다");
  });

  it("returns PIN lost message for >= 60s", () => {
    const result = lockoutGuide(60);
    expect(result).toContain("60초");
    expect(result).toContain("PIN을 잊으셨나요?");
  });

  it("returns PIN lost message for 120s", () => {
    const result = lockoutGuide(120);
    expect(result).toContain("120초");
    expect(result).toContain("PIN을 잊으셨나요?");
  });

  it("returns retry message for < 60s", () => {
    const result = lockoutGuide(30);
    expect(result).toContain("30초");
    expect(result).toContain("천천히 다시 시도해 주세요");
  });

  it("returns retry message for 1s", () => {
    const result = lockoutGuide(1);
    expect(result).toContain("1초");
  });
});

describe("humanizeUploadError", () => {
  it("returns friendly message for empty_extracted_text", () => {
    const result = humanizeUploadError(new Error("empty_extracted_text"));
    expect(result).toBe("이 기록은 읽기 어려웠어요. 다른 형식으로 다시 올려주시겠어요?");
  });

  it("returns friendly message for unsupported_upload_format", () => {
    const result = humanizeUploadError(new Error("unsupported_upload_format"));
    expect(result).toContain("지원하지 않는 파일 형식이에요");
  });

  it("returns friendly message for upload timeout", () => {
    const result = humanizeUploadError(new Error("업로드 처리 시간이 초과되었습니다"));
    expect(result).toBe("파일 처리 시간이 길어지고 있어요. 잠시 후 다시 시도해 주세요.");
  });

  it("returns raw message for unknown error", () => {
    expect(humanizeUploadError(new Error("random error"))).toBe("random error");
  });

  it("handles non-Error values", () => {
    expect(humanizeUploadError("some string error")).toBe("some string error");
  });
});

describe("statusTone", () => {
  it("returns success tone for 'done'", () => {
    expect(statusTone("done")).toBe("bg-success/15 text-success");
  });

  it("returns destructive tone for 'error'", () => {
    expect(statusTone("error")).toBe("bg-destructive/15 text-destructive");
  });

  it("returns warning tone for 'processing'", () => {
    expect(statusTone("processing")).toBe("bg-warning/15 text-warning");
  });
});

describe("withConnectionHint", () => {
  it("returns dev hint for localhost error in dev mode", async () => {
    // @ts-expect-error -- setting import.meta.env for test
    import.meta.env.DEV = true;
    const result = await withConnectionHint(new Error("ws://localhost:3000 connection refused"));
    expect(result).toContain("chrome://extensions");
    expect(result).toContain("pnpm dev");
    // @ts-expect-error -- restore
    import.meta.env.DEV = false;
  });

  it("returns production hint for localhost error in prod mode", async () => {
    // @ts-expect-error -- setting import.meta.env for test
    import.meta.env.DEV = false;
    const result = await withConnectionHint(new Error("ws://localhost:3000 connection refused"));
    expect(result).toContain("chrome://extensions");
    expect(result).not.toContain("pnpm dev");
  });

  it("returns hint for receiving end does not exist", async () => {
    // @ts-expect-error -- setting import.meta.env for test
    import.meta.env.DEV = false;
    const result = await withConnectionHint(new Error("receiving end does not exist"));
    expect(result).toContain("chrome://extensions");
  });

  it("returns hint for Korean no-response message", async () => {
    // @ts-expect-error -- setting import.meta.env for test
    import.meta.env.DEV = false;
    const result = await withConnectionHint(new Error("확장 프로그램 응답이 없습니다"));
    expect(result).toContain("chrome://extensions");
  });

  it("returns generic hint when ping fails", async () => {
    // @ts-expect-error -- setting import.meta.env for test
    import.meta.env.DEV = false;
    mockSendRuntimeMessage.mockRejectedValueOnce(new Error("no connection"));
    const result = await withConnectionHint(new Error("some other error"));
    expect(result).toContain("some other error");
    expect(result).toContain("새로고침");
  });

  it("returns version hint when ping succeeds in prod", async () => {
    // @ts-expect-error -- setting import.meta.env for test
    import.meta.env.DEV = false;
    mockSendRuntimeMessage.mockResolvedValueOnce({
      ok: true,
      service: "background",
      mode: "prod",
      version: "1.2.3",
    });
    const result = await withConnectionHint(new Error("some other error"));
    expect(result).toContain("버전 1.2.3");
  });

  it("returns generic hint when ping returns ok=false", async () => {
    // @ts-expect-error -- setting import.meta.env for test
    import.meta.env.DEV = false;
    mockSendRuntimeMessage.mockResolvedValueOnce({ ok: false });
    const result = await withConnectionHint(new Error("some issue"));
    expect(result).toContain("새로고침");
  });
});

describe("sendVaultMessage", () => {
  it("calls sendRuntimeMessage with correct timeout", async () => {
    mockSendRuntimeMessage.mockResolvedValueOnce({ ok: true });
    await sendVaultMessage({ type: "vault:list" });
    expect(mockSendRuntimeMessage).toHaveBeenCalledWith(
      { type: "vault:list" },
      expect.objectContaining({ timeoutMs: 20_000 }),
    );
  });

  it("returns the envelope from sendRuntimeMessage", async () => {
    mockSendRuntimeMessage.mockResolvedValueOnce({ ok: true, data: "test" });
    const result = await sendVaultMessage({ type: "test" });
    expect(result).toEqual({ ok: true, data: "test" });
  });
});

describe("sendUploadMessage", () => {
  it("calls sendRuntimeMessage with upload timeout", async () => {
    mockSendRuntimeMessage.mockResolvedValueOnce({ ok: true });
    await sendUploadMessage({ type: "vault:upload" });
    expect(mockSendRuntimeMessage).toHaveBeenCalledWith(
      { type: "vault:upload" },
      expect.objectContaining({ timeoutMs: 120_000 }),
    );
  });

  it("returns the envelope from sendRuntimeMessage", async () => {
    mockSendRuntimeMessage.mockResolvedValueOnce({ ok: true });
    const result = await sendUploadMessage({ type: "upload" });
    expect(result).toEqual({ ok: true });
  });
});
