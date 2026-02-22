import { RuntimeMessage, RuntimeResponse } from "../background/messages";
import { parseHiraPayloadFromText } from "../context/validate";
import { detectProvider } from "../provider/adapters";
import { Provider } from "../context/types";

function byId<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id) as T | null;
  if (!found) {
    throw new Error(`missing element: ${id}`);
  }
  return found;
}

const questionInput = byId<HTMLTextAreaElement>("question");
const hiraInput = byId<HTMLTextAreaElement>("hiraJson");
const buildButton = byId<HTMLButtonElement>("buildDraft");
const insertButton = byId<HTMLButtonElement>("insertDraft");
const copyButton = byId<HTMLButtonElement>("copyDraft");
const providerSelect = byId<HTMLSelectElement>("provider");
const output = byId<HTMLTextAreaElement>("draft");
const status = byId<HTMLDivElement>("status");

function setStatus(message: string, type: "info" | "error" = "info") {
  status.textContent = message;
  status.dataset.type = type;
}

async function inferProviderFromActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? "";
  const provider = detectProvider(url);
  if (provider) {
    providerSelect.value = provider;
  }
}

function getProvider(): Provider {
  const value = providerSelect.value as Provider;
  if (!value || !["chatgpt", "gemini", "claude"].includes(value)) {
    throw new Error("지원하지 않는 provider 입니다.");
  }
  return value;
}

async function buildDraft() {
  let parsed: unknown;
  try {
    parsed = parseHiraPayloadFromText(hiraInput.value);
  } catch (error) {
    const message = error instanceof Error ? error.message : "HIRA JSON 검증에 실패했습니다.";
    setStatus(message, "error");
    return;
  }

  const message: RuntimeMessage = {
    type: "BUILD_CONTEXT_PACKET",
    payload: {
      provider: getProvider(),
      userQuestion: questionInput.value.trim(),
      hiraPayload: parsed as never,
    },
  };

  const response = (await chrome.runtime.sendMessage(message)) as RuntimeResponse;
  if (!response.ok) {
    setStatus(`초안 생성 실패: ${response.error}`, "error");
    return;
  }

  output.value = (response.data as { draft: string }).draft;
  setStatus("초안 생성 완료. 검토 후 삽입하세요.");
}

async function insertDraft() {
  const draft = output.value.trim();
  if (!draft) {
    setStatus("먼저 초안을 생성하세요.", "error");
    return;
  }

  const message: RuntimeMessage = {
    type: "INSERT_DRAFT_TO_ACTIVE_TAB",
    payload: {
      provider: getProvider(),
      draft,
    },
  };

  const response = (await chrome.runtime.sendMessage(message)) as RuntimeResponse;
  if (!response.ok) {
    setStatus(`삽입 실패: ${response.error}`, "error");
    return;
  }

  const delivered = (response.data as { delivered: boolean }).delivered;
  if (!delivered) {
    setStatus("입력창을 찾지 못했습니다. 페이지를 새로고침 후 다시 시도하세요.", "error");
    return;
  }

  setStatus("입력창에 초안을 삽입했습니다. 전송은 직접 확인 후 진행하세요.");
}

buildButton.addEventListener("click", () => {
  buildDraft().catch((error: Error) => {
    setStatus(error.message, "error");
  });
});

insertButton.addEventListener("click", () => {
  insertDraft().catch((error: Error) => {
    setStatus(error.message, "error");
  });
});

copyButton.addEventListener("click", () => {
  navigator.clipboard
    .writeText(output.value)
    .then(() => setStatus("초안을 클립보드에 복사했습니다."))
    .catch(() => setStatus("클립보드 복사에 실패했습니다.", "error"));
});

inferProviderFromActiveTab().catch(() => {
  setStatus("활성 탭 provider를 자동 감지하지 못했습니다.");
});
