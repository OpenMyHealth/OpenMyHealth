export const baseURL = "https://nice.checkplus.co.kr";
export const decoder = new TextDecoder("euc-kr");
export type Tel = "SK" | "KT" | "LG" | "SM" | "KM" | "LM";

export interface NicePhoneCertificationSession {
  cookie: { key: string; value: string }[];
  smsServiceInfo: string;
}

export interface NicePhoneCertificationCreateSessionRequest {
  encodeData: string;
  name: string;
  ssnFront: string;
  ssnBack: string;
  phone: string;
  tel: Tel;
}

export interface NicePhoneCertificationCreateSessionResponse {
  session: NicePhoneCertificationSession;
}

export interface NicePhoneCertificationSubmitRequest extends NicePhoneCertificationCreateSessionResponse {
  code: string;
}

export interface NicePhoneCertificationSubmitResponse {
  encodeData: string;
}
