import { extractTknSno } from "../browserSmsFlow";

describe("browserSmsFlow", () => {
  it("로그인 응답에서 tknSno를 추출한다", () => {
    expect(extractTknSno({ dmResult: { tknSno: "token-123" } })).toBe("token-123");
  });

  it("tknSno가 없으면 에러를 던진다", () => {
    expect(() => extractTknSno({ dmResult: {} })).toThrow("tknSno-not-found");
  });
});
