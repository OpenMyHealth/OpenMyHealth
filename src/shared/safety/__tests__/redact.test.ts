import { redactSensitiveText } from "../redact";

describe("redactSensitiveText", () => {
  it("masks common sensitive tokens", () => {
    const input = "홍길동 900101-1234567 010-1234-5678 user@example.com";
    const result = redactSensitiveText(input);

    expect(result.text).toContain("[RRN_REDACTED]");
    expect(result.text).toContain("[PHONE_REDACTED]");
    expect(result.text).toContain("[EMAIL_REDACTED]");
    expect(result.count).toBeGreaterThanOrEqual(3);
  });

  it("keeps clinical dates but masks labeled birthdate", () => {
    const input = "진료일: 2024-11-20 생년월일: 1990-01-01";
    const result = redactSensitiveText(input);

    expect(result.text).toContain("2024-11-20");
    expect(result.text).toContain("[BIRTHDATE_REDACTED]");
  });
});
