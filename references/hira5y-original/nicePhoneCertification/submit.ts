import getAxiosSession from "@persly/scraping/utils/getAxiosSession";
import {
  baseURL,
  decoder,
  NicePhoneCertificationSubmitRequest,
  NicePhoneCertificationSubmitResponse,
} from "./common";

export default async function nicePhoneCertificationSubmit({
  session,
  code,
}: NicePhoneCertificationSubmitRequest): Promise<NicePhoneCertificationSubmitResponse> {
  const client = getAxiosSession(baseURL, session.cookie, {
    responseEncoding: "binary",
    responseType: "arraybuffer",
  });
  const { data } = await client.post(
    "/cert/mobileCert/sms/confirm/proc",
    { certCode: code },
    {
      responseEncoding: "utf-8",
      responseType: "json",
      headers: { "X-Service-Info": session.smsServiceInfo },
    },
  );
  if (data.code !== "SUCCESS") {
    throw new Error(data.message);
  }
  const { data: html } = await client.post("/cert/result/send");
  const parsedHtml = decoder.decode(html);
  const encodeData = parsedHtml
    .split('const queryString = "EncodeData=')[1]
    .split('";')[0];

  return { encodeData };
}
