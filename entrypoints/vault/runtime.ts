import { sendRuntimeMessage, type RuntimeOkEnvelope } from "../../src/core/runtime-client";
import type { VaultFileSummary } from "../../src/core/models";

const MESSAGE_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 120_000;

type OkEnvelope = RuntimeOkEnvelope & { error?: string };
type RuntimePingResponse = RuntimeOkEnvelope & {
  service: "background";
  mode: "dev" | "prod";
  version: string;
};

export function readableError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function sendMessage<T extends OkEnvelope>(message: Record<string, unknown>): Promise<T> {
  return sendRuntimeMessage<T>(message, {
    timeoutMs: MESSAGE_TIMEOUT_MS,
    timeoutMessage: "확장 프로그램 응답 시간이 초과되었습니다.",
    invalidResponseMessage: "확장 프로그램 응답이 비어 있거나 형식이 맞지 않습니다.",
    transportErrorMessage: "확장 프로그램과 통신하지 못했습니다. 확장을 새로고침해 주세요.",
  });
}

export async function sendUploadMessage<T extends OkEnvelope>(message: Record<string, unknown>): Promise<T> {
  return sendRuntimeMessage<T>(message, {
    timeoutMs: UPLOAD_TIMEOUT_MS,
    timeoutMessage: "업로드 처리 시간이 초과되었습니다.",
    invalidResponseMessage: "확장 프로그램 응답 형식이 올바르지 않습니다.",
    transportErrorMessage: "업로드 중 확장 프로그램과 통신하지 못했습니다.",
  });
}

export async function sendVaultMessage<T extends OkEnvelope>(message: Record<string, unknown>): Promise<T> {
  return sendMessage<T>(message);
}

export function summarizeUploadErrors(errors: string[]): string {
  const sample = errors.slice(0, 2).join(" / ");
  if (errors.length <= 2) {
    return sample;
  }
  return `${sample} 외 ${errors.length - 2}건`;
}

export function lockoutGuide(lockoutSeconds: number): string {
  if (lockoutSeconds >= 300) {
    return `입력이 여러 번 맞지 않았어요. ${lockoutSeconds}초 후 다시 시도할 수 있어요. PIN을 잊으셨다면 기존 데이터 복구가 불가능합니다.`;
  }
  if (lockoutSeconds >= 60) {
    return `입력이 여러 번 맞지 않았어요. ${lockoutSeconds}초 후 다시 시도해 주세요. PIN을 잊으셨나요?`;
  }
  return `천천히 다시 시도해 주세요. ${lockoutSeconds}초 후 다시 입력할 수 있어요.`;
}

export function humanizeUploadError(error: unknown): string {
  const raw = readableError(error);
  if (raw.includes("empty_extracted_text")) {
    return "이 기록은 읽기 어려웠어요. 다른 형식으로 다시 올려주시겠어요?";
  }
  if (raw.includes("unsupported_upload_format")) {
    return "지원하지 않는 파일 형식이에요. 현재는 PDF/TXT/CSV/JSON/XML/JPEG/PNG/HEIC만 지원합니다.";
  }
  if (raw.includes("업로드 처리 시간이 초과되었습니다")) {
    return "파일 처리 시간이 길어지고 있어요. 잠시 후 다시 시도해 주세요.";
  }
  return raw;
}

export async function withConnectionHint(error: unknown): Promise<string> {
  const base = readableError(error);
  const lower = base.toLowerCase();
  if (
    lower.includes("ws://localhost:3000")
    || lower.includes("receiving end does not exist")
    || base.includes("확장 프로그램 응답이 없습니다")
  ) {
    if (import.meta.env.DEV) {
      return "확장 프로그램 연결이 끊겼습니다. chrome://extensions에서 OpenMyHealth를 새로고침해 주세요. 개발 모드라면 `pnpm dev` 실행 상태를 확인해 주세요.";
    }
    return "잠시 연결이 불안정해요. chrome://extensions에서 OpenMyHealth를 새로고침한 뒤 다시 시도해 주세요.";
  }
  const genericHint = `${base} 확장 프로그램을 새로고침한 뒤 다시 시도해 주세요.`;

  try {
    const ping = await sendMessage<RuntimePingResponse>({ type: "runtime:ping" });
    if (!ping.ok) {
      return genericHint;
    }
    if (import.meta.env.DEV && ping.mode === "dev") {
      return `${base} (개발 모드 응답은 확인되었습니다. \`pnpm dev\` 실행 상태를 확인해 주세요.)`;
    }
    return `${base} 확장 프로그램 응답(버전 ${ping.version})은 확인되었습니다. chrome://extensions에서 새로고침 후 다시 시도해 주세요.`;
  } catch {
    return genericHint;
  }
}

export function statusTone(status: VaultFileSummary["status"]): string {
  if (status === "done") {
    return "bg-success/15 text-success";
  }
  if (status === "error") {
    return "bg-destructive/15 text-destructive";
  }
  return "bg-warning/15 text-warning";
}
