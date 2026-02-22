import {
  Hira5ySubmitResponse,
  Hira5ySubmitSmsRequest,
  hireAuthBaseURL,
  hireBaseURL,
} from "@persly/scraping/scrapers/hira5y/common";
import getAxiosSession from "@persly/scraping/utils/getAxiosSession";
import nicePhoneCertificationSubmit from "@persly/scraping/scrapers/nicePhoneCertification/submit";
import hira5yParser from "@persly/scraping/scrapers/hira5y/parser";

export default async function hira5ySubmitSms({
  nicePhoneCertificationSession,
  hiraAuthSession,
  hiraSession,
  code,
}: Hira5ySubmitSmsRequest): Promise<Hira5ySubmitResponse> {
  const { encodeData } = await nicePhoneCertificationSubmit({
    session: nicePhoneCertificationSession,
    code,
  });
  const hiraClient = getAxiosSession(hireBaseURL, hiraSession.cookie);
  const hiraAuthClient = getAxiosSession(
    hireAuthBaseURL,
    hiraAuthSession.cookie,
  );

  await hiraAuthClient.get(`/co/checkplus/success.do?EncodeData=${encodeData}`);
  const { data } = await hiraAuthClient.post(
    "/pl/login/certByJumin.do",
    "%40d1%23usr_nm=&%40d1%23jumin_no=&%40d1%23jumin_no1=&%40d1%23jumin_no2=&%40d1%23domain=https%3A%2F%2Fwww.hira.or.kr&%40d1%23uri=JTJGcmIlMkZjbW1uJTJGcmJDZXJ0UmV0dXJuLmRvJTNGc3RyUGFnZVR5cGUlM0RESUFH&%40d1%23resParam=&%40d1%23resToken=&%40d1%23resultCode=&%40d1%23encJno1=&%40d1%23encJno2=&%40d1%23contStr=%EB%82%B4%20%EC%A7%84%EB%A3%8C%EC%A0%95%EB%B3%B4%20%EC%97%B4%EB%9E%8C%20&%40d1%23contStrView=%EB%82%B4%20%EC%A7%84%EB%A3%8C%EC%A0%95%EB%B3%B4%20%EC%97%B4%EB%9E%8C%20%EB%B3%B8%EC%9D%B8%EC%9D%B8%EC%A6%9D&%40d%23=%40d1%23&%40d1%23=dmParam&%40d1%23tp=dm&",
  );

  const { tknSno } = data.dmResult;
  const { treatmentsSummary, treatmentsDetail, prescriptions } =
    await hira5yParser({
      hiraClient,
      tknSno,
    });

  return { treatmentsSummary, treatmentsDetail, prescriptions };
}
