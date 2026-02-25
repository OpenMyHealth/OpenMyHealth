import { __testOnly, krHiraAdapter } from "../krHira";

describe("krHiraAdapter", () => {
  it("normalizes HIRA diagnosis code to ICD-10 shape", () => {
    expect(__testOnly.normalizeDiagnosisCode("AJ042")).toBe("J04.2");
    expect(__testOnly.normalizeDiagnosisCode("AK0531")).toBe("K05.31");
  });

  it("strips medical prefixes from disease names", () => {
    expect(__testOnly.stripMedicalPrefix("(양방)상세불명의 급성 기관지염")).toBe("상세불명의 급성 기관지염");
  });

  it("creates condition record with ICD coding", () => {
    const records = krHiraAdapter.normalize([
      {
        sourcePath: "treatmentsSummary",
        payload: {
          code: "AJ042",
          date: "20240211",
          disease_name: "(양방)급성 후두염",
          part: "이비인후과",
          hospital: "테스트병원",
        },
      },
    ]);

    expect(records).toHaveLength(1);
    expect(records[0].type).toBe("condition");
    expect(records[0].fhir.code?.coding?.[0]).toMatchObject({
      system: "http://hl7.org/fhir/sid/icd-10",
      code: "J04.2",
    });
  });
});
