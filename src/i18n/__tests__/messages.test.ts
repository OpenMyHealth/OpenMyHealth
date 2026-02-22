import { detectLocale, t } from "../messages";

describe("i18n messages", () => {
  it("en locale을 감지한다", () => {
    expect(detectLocale("en-US")).toBe("en");
    expect(t("en", "buildDraft")).toBe("Build Draft");
  });

  it("그 외 locale은 ko로 fallback한다", () => {
    expect(detectLocale("ko-KR")).toBe("ko");
    expect(detectLocale("ja-JP")).toBe("ko");
    expect(t("ko", "buildDraft")).toBe("초안 만들기");
  });
});
