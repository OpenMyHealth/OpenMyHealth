export type Locale = "ko" | "en";

const messages = {
  ko: {
    title: "openChart",
    description: "HIRA JSON 기반으로 AI chatbot 입력 초안을 생성합니다.",
    provider: "Provider",
    question: "질문",
    questionPlaceholder: "예: 최근 복약 변화와 주의할 점을 정리해줘",
    encodeData: "encodeData (수동 인증 결과)",
    fetchFromEncodeData: "encodeData로 HIRA 조회",
    hiraPayload: "HIRA JSON Payload",
    telemetryOptIn: "익명 텔레메트리 수집 동의(기본 비활성)",
    hiraPlaceholder:
      '{"treatmentsSummary":[],"treatmentsDetail":[],"prescriptions":[]}',
    buildDraft: "초안 만들기",
    insertDraft: "활성 탭 입력창에 삽입",
    copyDraft: "클립보드 복사",
    draft: "초안",
    draftPlaceholder: "생성된 초안이 여기에 표시됩니다.",
    providerDetectFailed: "활성 탭 provider를 자동 감지하지 못했습니다.",
  },
  en: {
    title: "openChart",
    description: "Generate AI chatbot drafts from your HIRA JSON payload.",
    provider: "Provider",
    question: "Question",
    questionPlaceholder: "e.g., summarize medication changes and key cautions",
    encodeData: "encodeData (manual auth output)",
    fetchFromEncodeData: "Fetch HIRA via encodeData",
    hiraPayload: "HIRA JSON Payload",
    telemetryOptIn: "Enable anonymous telemetry (disabled by default)",
    hiraPlaceholder:
      '{"treatmentsSummary":[],"treatmentsDetail":[],"prescriptions":[]}',
    buildDraft: "Build Draft",
    insertDraft: "Insert into Active Tab",
    copyDraft: "Copy to Clipboard",
    draft: "Draft",
    draftPlaceholder: "Generated draft appears here.",
    providerDetectFailed: "Failed to auto-detect provider from active tab.",
  },
} as const;

type MessageKey = keyof (typeof messages)["ko"];

export function detectLocale(language: string | undefined): Locale {
  if (!language) return "ko";
  return language.toLowerCase().startsWith("en") ? "en" : "ko";
}

export function t(locale: Locale, key: MessageKey): string {
  return messages[locale][key];
}
