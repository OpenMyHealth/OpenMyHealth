import { AxiosInstance } from "axios";
import * as cheerio from "cheerio";
import dayjs from "dayjs";

export default async function hira5yParser({
  hiraClient,
  tknSno,
}: {
  hiraClient: AxiosInstance;
  tknSno: string;
}) {
  await hiraClient.get(
    `/rb/cmmn/rbCertReturn.do?strPageType=DIAG&tknId=${tknSno}`,
  );
  await hiraClient.get(
    "/rb/diag/selectMyDiagInfmList.do?pgmid=HIRAA070001000600",
  );
  const now = dayjs();
  const fiveYearsAgo = now.subtract(5, "year").add(3, "day");
  const params = {
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
  const { data: treatmentsSummaryHTML } = await hiraClient.post(
    `/rb/diag/selectBseDiagInfmList.do?pgmid=HIRAA070001000600`,
    params,
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  const { data: htmlTreatmentsDetail } = await hiraClient.post(
    `/rb/diag/selectBhvMdfeeInfmList.do?pgmid=HIRAA070001000600`,
    params,
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  const { data: htmlPrescription } = await hiraClient.post(
    `/rb/diag/selectPrscCpmdInfmList.do?pgmid=HIRAA070001000600`,
    params,
  );
  const treatmentsDetail = getTreatmentsDetailFromHTML(htmlTreatmentsDetail);
  const prescriptions = getPrescriptionsFromHTML(htmlPrescription);
  const treatmentsSummary = getTreatmentsSummaryFromHTML(treatmentsSummaryHTML);

  return { treatmentsSummary, treatmentsDetail, prescriptions };
}

function getTreatmentsSummaryFromHTML(html: string) {
  const $ = cheerio.load(html);
  const histories: {
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
  }[] = [];

  // tbody 내의 각 tr을 순회
  $("#dynamicTbody tr").each((_, tr) => {
    // 각 td의 span.phide 다음에 오는 span의 텍스트를 추출
    const tds = $(tr).find("td");

    const history = {
      date: $(tds[0]).find("span:not(.phide)").text().trim(),
      hospital: $(tds[1]).find("span:not(.phide)").text().trim(),
      part: $(tds[2]).find("span:not(.phide)").text().trim(),
      type: $(tds[3]).find("span:not(.phide)").text().trim(),
      code: $(tds[4]).find("span:not(.phide)").text().trim(),
      disease_name: $(tds[5]).find("span:not(.phide)").text().trim(),
      days: parseInt(
        $(tds[6]).find("span:not(.phide)").text().trim().replace(/,/g, ""),
      ),
      total_fee: parseInt(
        $(tds[7]).find("span:not(.phide)").text().trim().replace(/,/g, ""),
      ),
      insurance_fee: parseInt(
        $(tds[8]).find("span:not(.phide)").text().trim().replace(/,/g, ""),
      ),
      my_fee: parseInt(
        $(tds[9]).find("span:not(.phide)").text().trim().replace(/,/g, ""),
      ),
    };

    histories.push(history);
  });

  return histories.filter(({ hospital }) => !hospital.includes("약국"));
}

function getTreatmentsDetailFromHTML(html: string) {
  const $ = cheerio.load(html);
  const treatments: {
    date: string;
    hospital: string;
    category: string;
    name: string;
    amount: number;
    frequency: number;
    days: number;
  }[] = [];

  // tbody 내의 각 tr을 순회
  $(".tbl_data tbody tr").each((_, tr) => {
    const tds = $(tr).find("td");

    const treatment = {
      date: $(tds[0]).find("span:not(.phide)").text().trim(),
      hospital: $(tds[1]).find("span:not(.phide)").text().trim(),
      category: $(tds[2]).find("span:not(.phide)").text().trim(),
      name: $(tds[3]).find("span:not(.phide)").text().trim(),
      amount: parseInt($(tds[4]).find("span:not(.phide)").text().trim()) || 0,
      frequency:
        parseInt($(tds[5]).find("span:not(.phide)").text().trim()) || 0,
      days: parseInt($(tds[6]).find("span:not(.phide)").text().trim()) || 0,
    };

    treatments.push(treatment);
  });

  return treatments;
}

function getPrescriptionsFromHTML(html: string) {
  const $ = cheerio.load(html);
  const prescriptions: {
    date: string;
    hospital: string;
    medicine_name: string;
    ingredient: string;
    amount: number;
    frequency: number;
    days: number;
  }[] = [];
  // tbody 내의 각 tr을 순회
  $(".tbl_data tbody tr").each((_, tr) => {
    const tds = $(tr).find("td");

    const prescription = {
      date: $(tds[0]).find("span:not(.phide)").text().trim(),
      hospital: $(tds[1]).find("span:not(.phide)").text().trim(),
      medicine_name: $(tds[3]).find("span:not(.phide)").text().trim(),
      ingredient: $(tds[4]).find("span:not(.phide)").text().trim(),
      amount: parseInt($(tds[5]).find("span:not(.phide)").text().trim()) || 0,
      frequency:
        parseInt($(tds[6]).find("span:not(.phide)").text().trim()) || 0,
      days: parseInt($(tds[7]).find("span:not(.phide)").text().trim()) || 0,
    };

    prescriptions.push(prescription);
  });

  return prescriptions;
}
