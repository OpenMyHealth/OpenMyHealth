import dayjs from "dayjs";
import {
  Hira5ySubmitResponse,
  OpenChartRecord,
  TreatmentsSummary,
} from "./types";

function getSummaryKey(record: { date: string; hospital: string }) {
  return `${dayjs(record.date).format("YYYYMMDD")}-${record.hospital}`;
}

function toRecordId(record: TreatmentsSummary) {
  return `${getSummaryKey(record)}-${record.code || "nocode"}`;
}

export function normalizeHira5yPayload(
  payload: Hira5ySubmitResponse,
  fetchedAt = new Date().toISOString(),
): OpenChartRecord[] {
  const detailMap = new Map<string, Hira5ySubmitResponse["treatmentsDetail"]>();
  const prescriptionMap = new Map<
    string,
    Hira5ySubmitResponse["prescriptions"]
  >();

  for (const detail of payload.treatmentsDetail) {
    const key = getSummaryKey(detail);
    const list = detailMap.get(key) ?? [];
    list.push(detail);
    detailMap.set(key, list);
  }

  for (const prescription of payload.prescriptions) {
    const key = getSummaryKey(prescription);
    const list = prescriptionMap.get(key) ?? [];
    list.push(prescription);
    prescriptionMap.set(key, list);
  }

  return payload.treatmentsSummary
    .map((summary) => {
      const key = getSummaryKey(summary);
      return {
        id: toRecordId(summary),
        date: dayjs(summary.date).toISOString(),
        hospital: summary.hospital,
        department: summary.part,
        diagnosisCode: summary.code,
        diagnosisName: summary.disease_name,
        treatmentType: summary.type,
        days: summary.days,
        fees: {
          total: summary.total_fee,
          covered: summary.insurance_fee,
          self: summary.my_fee,
        },
        details: (detailMap.get(key) ?? []).map((detail) => ({
          category: detail.category,
          name: detail.name,
          amount: detail.amount,
          frequency: detail.frequency,
          days: detail.days,
        })),
        prescriptions: (prescriptionMap.get(key) ?? []).map((prescription) => ({
          name: prescription.medicine_name,
          ingredient: prescription.ingredient,
          amount: prescription.amount,
          frequency: prescription.frequency,
          days: prescription.days,
        })),
        source: {
          provider: "HIRA" as const,
          fetchedAt,
          window: "5y" as const,
        },
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}
