import dayjs from "dayjs";
import { Hira5ySubmitResponse } from "../context/types";
import {
  parsePrescriptions,
  parseTreatmentsDetail,
  parseTreatmentsSummary,
} from "./browserParser";

export const HIRA_BASE_URL = "https://www.hira.or.kr";

export interface HiraSearchParams {
  isActivity: string;
  pageIndex: number;
  recordCountPerPage: number;
  srchInsuType: string;
  srchDiagInfo: string;
  srchAllYn: string;
  srchSickYn: string;
  srchFrDd: string;
  srchToDd: string;
  snstSickShwYn: string;
  insuType: string;
  srchSick: string;
  snstSickShw: string;
  srchYkiho: string;
  srchYadmNm: string;
  srchYkihoAll: string;
  srchFrDate: string;
  srchToDate: string;
}

export function buildHiraSearchParams(now = dayjs()): HiraSearchParams {
  const fiveYearsAgo = now.subtract(5, "year").add(3, "day");
  return {
    isActivity: "Y",
    pageIndex: 1,
    recordCountPerPage: 10000,
    srchInsuType: "etc",
    srchDiagInfo: "",
    srchAllYn: "Y",
    srchSickYn: "Y",
    srchFrDd: fiveYearsAgo.format("YYYYMMDD"),
    srchToDd: now.format("YYYYMMDD"),
    snstSickShwYn: "Y",
    insuType: "etc",
    srchSick: "on",
    snstSickShw: "on",
    srchYkiho: "",
    srchYadmNm: "",
    srchYkihoAll: "on",
    srchFrDate: fiveYearsAgo.format("YYYY-MM-DD"),
    srchToDate: now.format("YYYY-MM-DD"),
  };
}

async function postForm(
  path: string,
  params: HiraSearchParams,
  fetcher: typeof fetch,
) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    body.set(key, String(value));
  }

  const response = await fetcher(`${HIRA_BASE_URL}${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`HIRA request failed: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function get(path: string, fetcher: typeof fetch) {
  const response = await fetcher(`${HIRA_BASE_URL}${path}`, {
    method: "GET",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`HIRA request failed: ${response.status} ${response.statusText}`);
  }
}

export async function fetchHira5yPayloadFromAuthenticatedSession({
  tknSno,
  fetcher = fetch,
}: {
  tknSno: string;
  fetcher?: typeof fetch;
}): Promise<Hira5ySubmitResponse> {
  await get(`/rb/cmmn/rbCertReturn.do?strPageType=DIAG&tknId=${tknSno}`, fetcher);
  await get("/rb/diag/selectMyDiagInfmList.do?pgmid=HIRAA070001000600", fetcher);

  const params = buildHiraSearchParams();

  const [summaryHtml, detailHtml, prescriptionHtml] = await Promise.all([
    postForm("/rb/diag/selectBseDiagInfmList.do?pgmid=HIRAA070001000600", params, fetcher),
    postForm("/rb/diag/selectBhvMdfeeInfmList.do?pgmid=HIRAA070001000600", params, fetcher),
    postForm("/rb/diag/selectPrscCpmdInfmList.do?pgmid=HIRAA070001000600", params, fetcher),
  ]);

  return {
    treatmentsSummary: parseTreatmentsSummary(summaryHtml),
    treatmentsDetail: parseTreatmentsDetail(detailHtml),
    prescriptions: parsePrescriptions(prescriptionHtml),
  };
}
