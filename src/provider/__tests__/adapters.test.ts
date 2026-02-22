import {
  detectProvider,
  findProviderInput,
  insertDraftIntoProvider,
} from "../adapters";

describe("provider adapters", () => {
  it("URL로 provider를 감지한다", () => {
    expect(detectProvider("https://chatgpt.com/")).toBe("chatgpt");
    expect(detectProvider("https://gemini.google.com/app")).toBe("gemini");
    expect(detectProvider("https://claude.ai/new")).toBe("claude");
    expect(detectProvider("https://example.com")).toBeNull();
  });

  it("textarea에 draft를 삽입한다", () => {
    document.body.innerHTML = "<textarea data-testid='prompt-textarea'></textarea>";
    const input = findProviderInput("chatgpt", document);
    expect(input).not.toBeNull();

    const result = insertDraftIntoProvider("chatgpt", document, "안녕");
    expect(result.ok).toBe(true);
    expect((input as HTMLTextAreaElement).value).toBe("안녕");
  });

  it("입력창이 없으면 실패를 반환한다", () => {
    document.body.innerHTML = "<div></div>";
    const result = insertDraftIntoProvider("claude", document, "테스트");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("input-not-found");
  });
});
