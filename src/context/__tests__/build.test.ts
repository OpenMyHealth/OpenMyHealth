import { buildContextPacket, buildProviderDraft } from "../build";
import { OpenChartRecord } from "../types";

const SAMPLE_RECORD: OpenChartRecord = {
  id: "20250102-서울병원-A123",
  date: "2025-01-02T00:00:00.000Z",
  hospital: "서울병원",
  department: "내과",
  diagnosisCode: "A123",
  diagnosisName: "고혈압",
  treatmentType: "외래",
  days: 3,
  fees: { total: 30000, covered: 20000, self: 10000 },
  details: [
    {
      category: "검사",
      name: "혈액검사",
      amount: 1,
      frequency: 1,
      days: 1,
    },
  ],
  prescriptions: [
    {
      name: "암로디핀",
      ingredient: "amlodipine",
      amount: 1,
      frequency: 1,
      days: 30,
    },
  ],
  source: {
    provider: "HIRA",
    fetchedAt: "2026-02-22T00:00:00.000Z",
    window: "5y",
  },
};

describe("buildContextPacket", () => {
  it("질문과 레코드로 context packet을 만든다", () => {
    const packet = buildContextPacket("내 약 조합 안전해?", [SAMPLE_RECORD]);
    expect(packet.userQuestion).toBe("내 약 조합 안전해?");
    expect(packet.timeline).toHaveLength(1);
    expect(packet.medications).toContain("암로디핀");
    expect(packet.confidenceLabel).toBe("low");
  });

  it("provider 전달용 draft 문자열을 생성한다", () => {
    const packet = buildContextPacket("최근 진료 흐름 알려줘", [SAMPLE_RECORD]);
    const draft = buildProviderDraft(packet);

    expect(draft).toContain("질문: 최근 진료 흐름 알려줘");
    expect(draft).toContain("[타임라인]");
    expect(draft).toContain("[근거]");
  });
});
