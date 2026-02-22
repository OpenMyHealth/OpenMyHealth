import { parseHiraPayloadFromText } from "../validate";

describe("parseHiraPayloadFromText", () => {
  it("올바른 payload를 통과시킨다", () => {
    const payload = {
      treatmentsSummary: [
        {
          date: "2025-01-01",
          hospital: "서울병원",
          part: "내과",
          type: "외래",
          code: "A123",
          disease_name: "고혈압",
          days: 3,
          total_fee: 30000,
          insurance_fee: 20000,
          my_fee: 10000,
        },
      ],
      treatmentsDetail: [
        {
          date: "2025-01-01",
          hospital: "서울병원",
          category: "검사",
          name: "혈액검사",
          amount: 1,
          frequency: 1,
          days: 1,
        },
      ],
      prescriptions: [
        {
          date: "2025-01-01",
          hospital: "서울병원",
          medicine_name: "암로디핀",
          ingredient: "amlodipine",
          amount: 1,
          frequency: 1,
          days: 30,
        },
      ],
    };

    const parsed = parseHiraPayloadFromText(JSON.stringify(payload));
    expect(parsed.treatmentsSummary[0].hospital).toBe("서울병원");
  });

  it("잘못된 타입이면 사용자 친화적 에러를 반환한다", () => {
    const payload = {
      treatmentsSummary: [],
      treatmentsDetail: [],
      prescriptions: [{ date: "2025-01-01" }],
    };

    expect(() => parseHiraPayloadFromText(JSON.stringify(payload))).toThrow(
      "필드 검증 실패",
    );
  });

  it("JSON 형식이 아니면 파싱 에러를 반환한다", () => {
    expect(() => parseHiraPayloadFromText("{oops")).toThrow(
      "JSON 파싱에 실패했습니다",
    );
  });
});
