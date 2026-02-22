import { normalizeHira5yPayload } from "../normalize";
import { Hira5ySubmitResponse } from "../types";

describe("normalizeHira5yPayload", () => {
  it("summary/detail/prescription을 동일 키로 합친다", () => {
    const payload: Hira5ySubmitResponse = {
      treatmentsSummary: [
        {
          date: "2025-01-02",
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
          date: "2025-01-02",
          hospital: "서울병원",
          category: "처치",
          name: "혈액검사",
          amount: 1,
          frequency: 1,
          days: 1,
        },
      ],
      prescriptions: [
        {
          date: "2025-01-02",
          hospital: "서울병원",
          medicine_name: "암로디핀",
          ingredient: "amlodipine",
          amount: 1,
          frequency: 1,
          days: 30,
        },
      ],
    };

    const records = normalizeHira5yPayload(payload, "2026-02-22T00:00:00.000Z");

    expect(records).toHaveLength(1);
    expect(records[0].id).toBe("20250102-서울병원-A123");
    expect(records[0].details[0].name).toBe("혈액검사");
    expect(records[0].prescriptions[0].name).toBe("암로디핀");
    expect(records[0].source.fetchedAt).toBe("2026-02-22T00:00:00.000Z");
  });
});
