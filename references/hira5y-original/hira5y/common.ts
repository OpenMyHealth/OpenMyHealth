import {
  NicePhoneCertificationSession,
  Tel,
} from "@persly/scraping/scrapers/nicePhoneCertification/common";

export const hireBaseURL = "https://www.hira.or.kr";
export const hireAuthBaseURL = "https://ptl.hira.or.kr";

export interface Hira5yCreateSessionRequest {
  name: string;
  ssnFront: string;
  ssnBack: string;
  phone: string;
}

export interface Hira5yCreateSmsSessionRequest extends Hira5yCreateSessionRequest {
  tel: Tel;
}

export interface Hira5yBaseSession {
  hiraSession: { cookie: { key: string; value: string }[] };
  hiraAuthSession: { cookie: { key: string; value: string }[] };
}

export interface Hira5yCreateSmsSessionResponse extends Hira5yBaseSession {
  nicePhoneCertificationSession: NicePhoneCertificationSession;
}

export interface Hira5yCreateKakaoSessionResponse extends Hira5yBaseSession {
  kakaoCertificationSession: {
    jno1: string;
    jno2: string;
    token: string;
    cxId: string;
    txId: string;
    name: string;
    phone: string;
    phone1: string;
    phone2: string;
    ssn1: string;
    ssn2: string;
    ssnFront: string;
    ssnBack: string;
  };
}

export interface Hira5ySubmitSmsRequest extends Hira5yCreateSmsSessionResponse {
  code: string;
}

export interface Hira5ySubmitKakaoRequest extends Hira5yCreateKakaoSessionResponse {}

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
