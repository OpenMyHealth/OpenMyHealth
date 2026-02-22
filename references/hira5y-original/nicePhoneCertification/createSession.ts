import captchaSolver from "@persly/scraping/utils/captchaSolver";
import * as cheerio from "cheerio";

import { createWorker } from "tesseract.js";
import getAxiosSession from "@persly/scraping/utils/getAxiosSession";
import {
  baseURL,
  decoder,
  NicePhoneCertificationCreateSessionRequest,
  NicePhoneCertificationCreateSessionResponse,
} from "./common";

export default async function nicePhoneCertificationCreateSession({
  encodeData,
  name,
  ssnFront,
  ssnBack,
  phone,
  tel,
}: NicePhoneCertificationCreateSessionRequest): Promise<NicePhoneCertificationCreateSessionResponse> {
  const client = getAxiosSession(baseURL, null, {
    responseEncoding: "binary",
    responseType: "arraybuffer",
  });
  await client.post("/CheckPlusSafeModel/service.cb", {
    m: "checkplusSerivce",
    EncodeData: encodeData,
  }); // 초기화

  await client.post("/cert/main/tracer"); // 유량제어

  await client.post("/cert/main/menu"); // 통신사 선택

  const { data: html1 } = await client.post("/cert/mobileCert/method", {
    selectMobileCo: tel,
  });
  const certInfoHash = cheerio
    .load(decoder.decode(html1))("input[name='certInfoHash']")
    .val();
  // await client.get("/cert/mobileCert/appCheck"); // ?

  const { data: html2, config } = await client.post(
    "/cert/mobileCert/sms/certification",
    { certInfoHash, mobileCertAgree: "Y" },
  );
  const parsedHtml = decoder.decode(html2);
  const $ = cheerio.load(parsedHtml);
  const captchaPath = $("img#simpleCaptchaImg").attr("src");
  if (!captchaPath) throw new Error("Captcha path not found");
  const captchaServiceInfo = parsedHtml
    .split('const SERVICE_INFO = "')[1]
    .split('";')[0];

  let attempts = 0;
  let success = false;
  let worker = null;
  while (!success && attempts < 10) {
    // 테서렉트 재활용을 위해 이상하게 씁니다.
    let png = null;
    if (!worker) {
      const result = await Promise.all([
        createWorker("eng"),
        client.get(captchaPath),
      ]);
      worker = result[0];
      png = result[1].data;
    } else {
      const { data } = await client.get(captchaPath);
      png = data;
    }
    // ----------
    const base64 = Buffer.from(png);
    const captchaCode = await captchaSolver(base64, worker);
    const { data } = await client.post(
      "/cert/mobileCert/sms/certification/proc",
      {
        userNameEncoding: encodeURI(name),
        userName: name,
        myNum1: ssnFront,
        myNum2: ssnBack[0],
        mobileNo: phone,
        captchaAnswer: captchaCode,
      },
      {
        responseEncoding: "utf-8",
        responseType: "json",
        headers: { "X-Service-Info": captchaServiceInfo },
      },
    );
    if (data.code === "SUCCESS") {
      success = true;
    } else if (data.message === "보안문자가 일치하지 않습니다.") {
      console.log(`Attempt ${attempts + 1} failed: Captcha mismatch`);
      attempts++;
    } else {
      throw new Error(data.message);
    }
  }

  if (worker) await worker.terminate();
  if (!success) {
    throw new Error(`다시 시도해주세요. (CODE : 20234 ${attempts}회)`);
  }

  const { data: html } = await client.post("/cert/mobileCert/sms/confirm");
  const parsedSmsHtml = decoder.decode(html);
  const smsServiceInfo = parsedSmsHtml
    .split('const SERVICE_INFO = "')[1]
    .split('";')[0];

  return {
    session: {
      cookie: await config!.jar!.getCookies(baseURL),
      smsServiceInfo,
    },
  };
}
