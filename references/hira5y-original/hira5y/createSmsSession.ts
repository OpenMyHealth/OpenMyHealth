import {
  Hira5yCreateSmsSessionRequest,
  Hira5yCreateSmsSessionResponse,
  hireAuthBaseURL,
  hireBaseURL,
} from "@persly/scraping/scrapers/hira5y/common";
import nicePhoneCertificationCreateSession from "@persly/scraping/scrapers/nicePhoneCertification/createSession";
import getAxiosSession from "@persly/scraping/utils/getAxiosSession";
import { RSAKey } from "@persly/scraping/utils/rsa";
import * as cheerio from "cheerio";

export default async function hira5yCreateSmsSession({
  name,
  ssnFront,
  ssnBack,
  phone,
  tel,
}: Hira5yCreateSmsSessionRequest): Promise<Hira5yCreateSmsSessionResponse> {
  const hiraClient = getAxiosSession(hireBaseURL, null);
  const hiraAuthClient = getAxiosSession(hireAuthBaseURL, null);
  const [{ config: hiraConfig }, { data: html1 }] = await Promise.all([
    hiraClient.get("/dummy.do?pgmid=HIRAA030009200000"),
    hiraAuthClient.get(
      "main2.do?pageType=certByJ&domain=https://www.hira.or.kr&uri=JTJGcmIlMkZjbW1uJTJGcmJDZXJ0UmV0dXJuLmRvJTNGc3RyUGFnZVR5cGUlM0RESUFH",
    ),
  ]);

  const rsaModule = html1.split('"rsaModule":"')[1].split('"')[0];
  const rsaExponent = html1.split('"rsaExponent":"')[1].split('"')[0];
  // 주민번호 암호화

  // @ts-ignore
  const rsa = new RSAKey();
  rsa.setPublic(rsaModule, rsaExponent);
  const jno1 = rsa.encrypt(ssnFront);
  const jno2 = rsa.encrypt(ssnBack);

  const { data: html, config: hiraAuthConfig } = await hiraAuthClient.post(
    "/co/checkplus/create.do",
    {
      authType: "M",
      isHttp: "https",
      isAbledBank: "nice",
      domain: "https://ptl.hira.or.kr",
      jno1: jno1,
      jno2: jno2,
    },
  );
  const $ = cheerio.load(html);
  const encodeData = $("input[name='EncodeData']").val();
  if (!encodeData) throw new Error("EncodeData not found");
  if (Array.isArray(encodeData)) throw new Error("EncodeData is array");

  const { session: certSession } = await nicePhoneCertificationCreateSession({
    encodeData,
    name,
    ssnFront,
    ssnBack,
    phone,
    tel,
  });

  return {
    hiraSession: { cookie: await hiraConfig!.jar!.getCookies(hireBaseURL) },
    hiraAuthSession: {
      cookie: await hiraAuthConfig!.jar!.getCookies(hireAuthBaseURL),
    },
    nicePhoneCertificationSession: certSession,
  };
}
