export interface TreatmentsSummary {
  date: string;
  hospital: string;
  part: string;
  type: string;
  code: string;
  disease_name: string;
  days: number;
  total_fee: number;
  insurance_fee: number;
  my_fee: number;
}

export interface TreatmentsDetail {
  date: string;
  hospital: string;
  category: string;
  name: string;
  amount: number;
  frequency: number;
  days: number;
}

export interface Prescriptions {
  date: string;
  hospital: string;
  medicine_name: string;
  ingredient: string;
  amount: number;
  frequency: number;
  days: number;
}

export interface Hira5ySubmitResponse {
  treatmentsSummary: TreatmentsSummary[];
  treatmentsDetail: TreatmentsDetail[];
  prescriptions: Prescriptions[];
}

export interface OpenChartRecord {
  id: string;
  date: string;
  hospital: string;
  department: string;
  diagnosisCode?: string;
  diagnosisName: string;
  treatmentType?: string;
  days?: number;
  fees?: {
    total?: number;
    covered?: number;
    self?: number;
  };
  details: Array<{
    category: string;
    name: string;
    amount?: number;
    frequency?: number;
    days?: number;
  }>;
  prescriptions: Array<{
    name: string;
    ingredient?: string;
    amount?: number;
    frequency?: number;
    days?: number;
  }>;
  source: {
    provider: "HIRA";
    fetchedAt: string;
    window: "5y";
  };
}

export interface ContextPacketV1 {
  userQuestion: string;
  clinicalSummary: string;
  timeline: Array<{ period: string; keyEvents: string[] }>;
  medications: string[];
  redFlags: string[];
  evidence: Array<{ recordId: string; snippet: string }>;
  safetyNote: string;
  confidenceLabel: "high" | "medium" | "low";
}

export type Provider = "chatgpt" | "gemini" | "claude";

export interface BuildContextRequest {
  provider: Provider;
  userQuestion: string;
  hiraPayload: Hira5ySubmitResponse;
}

export interface BuildContextResult {
  packet: ContextPacketV1;
  draft: string;
}
