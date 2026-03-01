import type { AiProvider, ResourceType } from "../../packages/contracts/src/index";

const RESOURCE_LABELS: Record<ResourceType, string> = {
  Observation: "🔬 검사 수치",
  MedicationStatement: "💊 처방약",
  Condition: "🩺 진단명",
  DiagnosticReport: "🧾 영상·병리 보고서",
  DocumentReference: "📁 진료기록",
};

export function resourceLabel(type: ResourceType): string {
  return RESOURCE_LABELS[type];
}

const PROVIDER_LABELS: Record<AiProvider, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
};

export function providerLabel(provider: AiProvider): string {
  return PROVIDER_LABELS[provider];
}

export function secondsUntil(lockoutUntil: number | null): number {
  if (!lockoutUntil) {
    return 0;
  }
  return Math.max(0, Math.ceil((lockoutUntil - Date.now()) / 1000));
}

export function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let result = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    /* v8 ignore next -- || 0 guards NaN from charCodeAt beyond string length; both branches tested via length-mismatch cases */
    result |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return result === 0;
}

export function fileStatusLabel(status: "processing" | "done" | "error"): string {
  const labels: Record<typeof status, string> = {
    processing: "처리 중",
    done: "완료",
    error: "오류",
  };
  return labels[status];
}
