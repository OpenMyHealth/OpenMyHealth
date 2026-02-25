import { buildApprovalPreview } from "../contextBuilder";
import type { NormalizedRecord } from "../../types";

function record(partial: Partial<NormalizedRecord>): NormalizedRecord {
  return {
    id: partial.id ?? "r1",
    sourceId: partial.sourceId ?? "kr-hira",
    sourceName: partial.sourceName ?? "HIRA 진료기록",
    type: partial.type ?? "condition",
    date: partial.date ?? "2024-11-20",
    title: partial.title ?? "상세불명의 급성 기관지염",
    summary: partial.summary ?? "연락처 010-1234-5678 / 주민번호 900101-1234567",
    tags: partial.tags ?? ["기관지염"],
    fhir: partial.fhir ?? { resourceType: "Condition" },
    raw: partial.raw ?? {},
    embedding: partial.embedding,
  };
}

describe("buildApprovalPreview", () => {
  it("builds approved context and redacts sensitive values", () => {
    const preview = buildApprovalPreview("내 호흡기 기록 보여줘", [record({ id: "x1" })]);

    expect(preview.ids).toEqual(["x1"]);
    expect(preview.contextText).toContain("OpenMyHealth Approved Context");
    expect(preview.contextText).toContain("[PHONE_REDACTED]");
    expect(preview.contextText).toContain("[RRN_REDACTED]");
    expect(preview.redactionCount).toBeGreaterThanOrEqual(2);
  });
});
