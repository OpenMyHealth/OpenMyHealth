import { z } from "zod";
import { Hira5ySubmitResponse } from "./types";

const treatmentSummarySchema = z.object({
  date: z.string(),
  hospital: z.string(),
  part: z.string(),
  type: z.string(),
  code: z.string(),
  disease_name: z.string(),
  days: z.number(),
  total_fee: z.number(),
  insurance_fee: z.number(),
  my_fee: z.number(),
});

const treatmentDetailSchema = z.object({
  date: z.string(),
  hospital: z.string(),
  category: z.string(),
  name: z.string(),
  amount: z.number(),
  frequency: z.number(),
  days: z.number(),
});

const prescriptionSchema = z.object({
  date: z.string(),
  hospital: z.string(),
  medicine_name: z.string(),
  ingredient: z.string(),
  amount: z.number(),
  frequency: z.number(),
  days: z.number(),
});

const hiraPayloadSchema = z.object({
  treatmentsSummary: z.array(treatmentSummarySchema),
  treatmentsDetail: z.array(treatmentDetailSchema),
  prescriptions: z.array(prescriptionSchema),
});

export function parseHiraPayload(input: unknown): Hira5ySubmitResponse {
  return hiraPayloadSchema.parse(input);
}

export function parseHiraPayloadFromText(input: string): Hira5ySubmitResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error("JSON 파싱에 실패했습니다. 올바른 JSON 형식인지 확인하세요.");
  }

  try {
    return parseHiraPayload(parsed);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const first = error.issues[0];
      const path = first?.path.join(".") || "payload";
      throw new Error(`필드 검증 실패: ${path} (${first.message})`);
    }

    throw error;
  }
}
