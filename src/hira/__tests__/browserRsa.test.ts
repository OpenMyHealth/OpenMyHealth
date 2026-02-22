import { BrowserRSAKey } from "../browserRsa";

describe("BrowserRSAKey", () => {
  it("RSA 공개키로 PKCS#1 v1.5 암호문 hex를 생성한다", () => {
    const rsa = new BrowserRSAKey();
    rsa.setPublic(
      "becbd4bc13175d0419a188af828e2159807571c7814d407b00262ce5b9775db4ca4c4adb5416bfbcbfad15c03d977e50705ab9e9c54f9108af9267106e2180d6ad49a1f5239ee58876ffb0066692a94f38f499230278d6998d14e99234ccf0a494233c0599ad57d35f3fdd91bd26a6569b69cbc01eabd23ad280ad72b36daf33",
      "010001",
    );

    const encrypted = rsa.encrypt("900101");
    expect(encrypted.length).toBeGreaterThan(100);
    expect(encrypted).toMatch(/^[0-9a-f]+$/);
  });

  it("공개키 없이 encrypt 호출 시 예외를 던진다", () => {
    const rsa = new BrowserRSAKey();
    expect(() => rsa.encrypt("hello")).toThrow("public-key-not-set");
  });
});
