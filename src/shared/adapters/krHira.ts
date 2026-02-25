import { SOURCE_IDS } from "../constants";
import type { NormalizedRecord, RawSourceRecord, SourceAdapter } from "../types";
import { normalizeDate } from "../utils/date";

function stripMedicalPrefix(name: string): string {
  return String(name || "")
    .replace(/^\([^)]*\)\s*/g, "")
    .trim();
}

function normalizeDiagnosisCode(rawCode: string): string {
  const code = String(rawCode || "").trim().toUpperCase();
  if (!code) return "";

  if (/^[A-Z]\d{2}(?:\.\d+)?$/.test(code)) {
    return code;
  }

  // HIRA style: AJ209 -> J20.9, AK0531 -> K05.31
  if (/^A[A-Z]\d{3,4}$/.test(code)) {
    const core = code.slice(1);
    return `${core.slice(0, 3)}.${core.slice(3)}`;
  }

  return code;
}

function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function stableRecordId(sourceId: string, payload: Record<string, unknown>, fallbackIndex: number): string {
  const fields = [
    sourceId,
    String(payload.date || ""),
    String(payload.code || ""),
    String(payload.disease_name || payload.name || payload.medicine_name || ""),
    String(payload.hospital || ""),
    String(fallbackIndex),
  ].join("|");

  return `rec_${hashString(fields)}`;
}

function toConditionRecord(payload: Record<string, unknown>, idx: number): NormalizedRecord {
  const diseaseName = stripMedicalPrefix(String(payload.disease_name || payload.name || "질환 기록"));
  const diagnosisCode = normalizeDiagnosisCode(String(payload.code || ""));
  const date = normalizeDate(String(payload.date || ""));

  return {
    id: stableRecordId(SOURCE_IDS.KR_HIRA, payload, idx),
    sourceId: SOURCE_IDS.KR_HIRA,
    sourceName: "HIRA 진료기록",
    type: "condition",
    date,
    title: diseaseName || "질환 기록",
    summary: [
      payload.part ? `진료과: ${String(payload.part)}` : "",
      payload.hospital ? `의료기관: ${String(payload.hospital)}` : "",
      payload.type ? `유형: ${String(payload.type)}` : "",
      payload.total_fee !== undefined ? `총진료비: ${String(payload.total_fee)}원` : "",
    ]
      .filter(Boolean)
      .join(" | "),
    tags: [
      diseaseName,
      String(payload.part || ""),
      String(payload.hospital || ""),
      diagnosisCode,
    ].filter(Boolean),
    fhir: {
      resourceType: "Condition",
      code: {
        coding: diagnosisCode
          ? [
              {
                system: "http://hl7.org/fhir/sid/icd-10",
                code: diagnosisCode,
                display: diseaseName,
              },
            ]
          : [],
        text: diseaseName,
      },
      onsetDateTime: date,
      note: [
        {
          text: payload.part ? `진료과: ${String(payload.part)}` : "",
        },
      ],
    },
    raw: payload,
  };
}

function toMedicationRecord(payload: Record<string, unknown>, idx: number): NormalizedRecord {
  const date = normalizeDate(String(payload.date || ""));
  const medication = String(payload.medicine_name || payload.ingredient || payload.name || "처방 기록");

  return {
    id: stableRecordId(SOURCE_IDS.KR_HIRA, payload, idx),
    sourceId: SOURCE_IDS.KR_HIRA,
    sourceName: "HIRA 진료기록",
    type: "medication",
    date,
    title: medication,
    summary: [
      payload.ingredient ? `성분: ${String(payload.ingredient)}` : "",
      payload.days !== undefined ? `투약일수: ${String(payload.days)}일` : "",
      payload.frequency !== undefined ? `복용빈도: ${String(payload.frequency)}` : "",
      payload.amount !== undefined ? `수량: ${String(payload.amount)}` : "",
    ]
      .filter(Boolean)
      .join(" | "),
    tags: [
      medication,
      String(payload.ingredient || ""),
    ].filter(Boolean),
    fhir: {
      resourceType: "MedicationStatement",
      status: "completed",
      effectiveDateTime: date,
      medicationCodeableConcept: {
        text: medication,
      },
    },
    raw: payload,
  };
}

function toProcedureRecord(payload: Record<string, unknown>, idx: number): NormalizedRecord {
  const date = normalizeDate(String(payload.date || ""));
  const name = String(payload.name || payload.category || "진료 상세 기록");

  return {
    id: stableRecordId(SOURCE_IDS.KR_HIRA, payload, idx),
    sourceId: SOURCE_IDS.KR_HIRA,
    sourceName: "HIRA 진료기록",
    type: "procedure",
    date,
    title: name,
    summary: [
      payload.category ? `분류: ${String(payload.category)}` : "",
      payload.days !== undefined ? `일수: ${String(payload.days)}` : "",
      payload.frequency !== undefined ? `빈도: ${String(payload.frequency)}` : "",
      payload.amount !== undefined ? `수량: ${String(payload.amount)}` : "",
    ]
      .filter(Boolean)
      .join(" | "),
    tags: [name, String(payload.category || "")].filter(Boolean),
    fhir: {
      resourceType: "Procedure",
      status: "completed",
      performedDateTime: date,
      code: {
        text: name,
      },
    },
    raw: payload,
  };
}

function parseFromEmbeddedJson(document: Document): RawSourceRecord[] {
  const script = document.querySelector("#omh-hira-data");
  if (!script?.textContent) {
    return [];
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(script.textContent);
  } catch {
    return [];
  }

  const rows: RawSourceRecord[] = [];
  const summary = Array.isArray(parsed.treatmentsSummary) ? parsed.treatmentsSummary : [];
  const detail = Array.isArray(parsed.treatmentsDetail) ? parsed.treatmentsDetail : [];
  const prescriptions = Array.isArray(parsed.prescriptions) ? parsed.prescriptions : [];

  for (const item of summary) {
    if (item && typeof item === "object") {
      rows.push({ sourcePath: "treatmentsSummary", payload: item as Record<string, unknown> });
    }
  }

  for (const item of detail) {
    if (item && typeof item === "object") {
      rows.push({ sourcePath: "treatmentsDetail", payload: item as Record<string, unknown> });
    }
  }

  for (const item of prescriptions) {
    if (item && typeof item === "object") {
      rows.push({ sourcePath: "prescriptions", payload: item as Record<string, unknown> });
    }
  }

  return rows;
}

function parseGenericTableRows(document: Document): RawSourceRecord[] {
  const tables = Array.from(document.querySelectorAll("table"));
  const rows: RawSourceRecord[] = [];

  for (const table of tables) {
    const headerCells = Array.from(table.querySelectorAll("thead th, tr:first-child th, tr:first-child td"));
    const headers = headerCells.map((cell) => cell.textContent?.trim() || "");
    if (!headers.length) continue;

    const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
    for (const tr of bodyRows) {
      const cells = Array.from(tr.querySelectorAll("td"));
      if (!cells.length) continue;

      const payload: Record<string, unknown> = {};
      for (let i = 0; i < cells.length; i += 1) {
        const key = headers[i] || `col_${i + 1}`;
        payload[key] = cells[i].textContent?.trim() || "";
      }

      rows.push({
        sourcePath: "generic-table",
        payload,
      });
    }
  }

  return rows;
}

function pickRecordType(sourcePath: string, payload: Record<string, unknown>): "condition" | "medication" | "procedure" {
  if (sourcePath.includes("prescription") || "medicine_name" in payload || "ingredient" in payload) {
    return "medication";
  }
  if (sourcePath.includes("detail") || "category" in payload) {
    return "procedure";
  }
  return "condition";
}

export const krHiraAdapter: SourceAdapter = {
  id: SOURCE_IDS.KR_HIRA,
  country: "KR",
  name: "HIRA 진료기록",
  description: "건강보험심사평가원 진료내역/처방 데이터를 로컬 금고로 가져옵니다.",
  entryUrl: "https://www.hira.or.kr",
  match: [/^https:\/\/(?:www\.|ptl\.)?hira\.or\.kr\//i],
  guideSteps: [
    {
      id: "auth",
      title: "본인인증",
      description: "HIRA 사이트에서 본인인증을 완료하세요. 인증정보는 OpenMyHealth가 저장하지 않습니다.",
      selector: "form[action*='login'], .login, #login",
    },
    {
      id: "view-records",
      title: "진료기록 조회",
      description: "진료기록/처방 내역이 보이는 화면으로 이동하세요.",
      selector: "table",
    },
    {
      id: "capture",
      title: "금고에 저장",
      description: "OpenMyHealth Side Panel에서 [이 페이지 데이터 가져오기]를 누르세요.",
      optional: true,
    },
  ],
  detectStepState(document) {
    const hasAuthCompleted =
      Boolean(document.querySelector("a[href*='logout']")) ||
      Boolean(document.querySelector("button.logout")) ||
      Boolean(document.querySelector(".btn-logout"));
    const hasAnyTable = Boolean(document.querySelector("table"));
    const hasRows = document.querySelectorAll("table tbody tr").length > 0;

    return {
      auth: hasAuthCompleted,
      "view-records": hasAnyTable && hasRows,
      capture: false,
    };
  },
  parseRawRecords(document) {
    const fromJson = parseFromEmbeddedJson(document);
    if (fromJson.length > 0) {
      return fromJson;
    }
    return parseGenericTableRows(document);
  },
  normalize(records) {
    const out: NormalizedRecord[] = [];
    records.forEach((record, idx) => {
      const type = pickRecordType(record.sourcePath, record.payload);
      if (type === "condition") {
        out.push(toConditionRecord(record.payload, idx));
      } else if (type === "medication") {
        out.push(toMedicationRecord(record.payload, idx));
      } else {
        out.push(toProcedureRecord(record.payload, idx));
      }
    });

    return out;
  },
};

export const __testOnly = {
  normalizeDiagnosisCode,
  stripMedicalPrefix,
};
