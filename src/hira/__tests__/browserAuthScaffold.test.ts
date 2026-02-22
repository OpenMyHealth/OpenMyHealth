import {
  extractHiddenInputValue,
  extractRsaPublicKeyFromHtml,
} from "../browserAuthScaffold";

describe("browserAuthScaffold", () => {
  it("HTML에서 RSA 공개키를 추출한다", () => {
    const html = '{"rsaModule":"abc123","rsaExponent":"010001"}';
    const key = extractRsaPublicKeyFromHtml(html);

    expect(key.rsaModule).toBe("abc123");
    expect(key.rsaExponent).toBe("010001");
  });

  it("hidden input 값을 추출한다", () => {
    const html = "<form><input type='hidden' name='EncodeData' value='token-value' /></form>";
    expect(extractHiddenInputValue(html, "EncodeData")).toBe("token-value");
  });
});
