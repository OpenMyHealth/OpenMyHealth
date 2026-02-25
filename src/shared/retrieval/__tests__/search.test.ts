import type { NormalizedRecord } from "../../types";
import { searchRecords } from "../search";

const baseRecord = (partial: Partial<NormalizedRecord>): NormalizedRecord => ({
  id: partial.id ?? "id",
  sourceId: partial.sourceId ?? "manual",
  sourceName: partial.sourceName ?? "수동 입력",
  type: partial.type ?? "document",
  date: partial.date ?? "2024-01-01",
  title: partial.title ?? "",
  summary: partial.summary ?? "",
  tags: partial.tags ?? [],
  fhir: partial.fhir ?? { resourceType: "DocumentReference" },
  raw: partial.raw ?? {},
  embedding: partial.embedding,
});

describe("searchRecords", () => {
  it("ranks relevant records higher", () => {
    const records: NormalizedRecord[] = [
      baseRecord({
        id: "a",
        title: "소화불량 진단",
        summary: "위장 기능 저하로 내과 진료",
        tags: ["소화", "위장"],
        date: "2024-11-01",
      }),
      baseRecord({
        id: "b",
        title: "치과 스케일링",
        summary: "치은염 치료",
        tags: ["치과"],
        date: "2024-10-01",
      }),
    ];

    const results = searchRecords("소화 관련 기록", records, 2);
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("a");
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });
});
