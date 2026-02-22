import getAxiosSession from "@persly/scraping/utils/getAxiosSession";
import {
  Hira5yCreateKakaoSessionResponse,
  Hira5yCreateSessionRequest,
  hireAuthBaseURL,
  hireBaseURL,
} from "./common";
import { RSAKey } from "@persly/scraping/utils/rsa";

export default async function hira5yCreateKakaoSession({
  name: _name,
  ssnFront,
  ssnBack,
  phone: _phone,
}: Hira5yCreateSessionRequest): Promise<Hira5yCreateKakaoSessionResponse> {
  const hiraClient = getAxiosSession(hireBaseURL, null);
  const hiraAuthClient = getAxiosSession(hireAuthBaseURL, null);
  const [{ config: hiraConfig }, { data: html }] = await Promise.all([
    hiraClient.get("/dummy.do?pgmid=HIRAA030009200000"),
    hiraAuthClient.get(
      "mainCert.do?pageType=certByJ&domain=https://www.hira.or.kr&uri=JTJGcmIlMkZjbW1uJTJGcmJDZXJ0UmV0dXJuLmRvJTNGc3RyUGFnZVR5cGUlM0RESUFH",
    ),
  ]);

  const {
    data: { token: token1, txId },
  } = await hiraAuthClient.post("/esign/issue_token.jsp", {
    token: "",
  });

  const name = Buffer.from(_name).toString("base64");
  const phone = Buffer.from(_phone).toString("base64");
  const phone1 = Buffer.from(_phone.slice(0, 3)).toString("base64");
  const phone2 = Buffer.from(_phone.slice(3)).toString("base64");
  const ssn1 = Buffer.from(ssnFront).toString("base64");
  const ssn2 = Buffer.from(ssnBack).toString("base64");

  const {
    data: { token: token2, cxId, resultCode, ...rest },
    config: hiraAuthConfig,
  } = await hiraAuthClient.post(
    "/oacx/api/v1.0/authen/request",
    {
      id: "",
      provider: "kakao_v1.5",
      token: token1,
      txId,
      appInfo: { code: "", path: "", type: "" },
      userInfo: {
        isMember: false,
        name,
        phone,
        phone1,
        phone2,
        ssn1,
        ssn2,
        birthday: "",
        privacy: 1,
        policy3: 0,
        policy4: 1,
        terms: 1,
        telcoTycd: null,
        access_token: "",
        token_type: "",
        state: "",
        mtranskeySsn2: null,
        privacyCheck: "",
      },
      deviceInfo: { code: "PC", browser: "WB", os: "", universalLink: false },
      contentInfo: {
        signTarget: "",
        signTargetTycd: "nonce",
        signType: "GOV_SIMPLE_AUTH",
        requestTitle: "",
        requestContents: "",
      },
      providerOptionInfo: {
        callbackUrl: "",
        reqCSPhoneNo: "1",
        upmuGb: "",
        isUseTss: "Y",
        isNotification: "Y",
        isPASSVerify: "Y",
        isUserAgreement: "Y",
      },
      compareCI: true,
    },
    {
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
      },
    },
  );

  if (resultCode !== "200") {
    throw new Error(`카카오 인증 실패`, {
      cause: rest,
    });
  }

  const rsaModule = html.split('"rsaModule":"')[1].split('"')[0];
  const rsaExponent = html.split('"rsaExponent":"')[1].split('"')[0];
  // 주민번호 암호화

  // @ts-expect-error
  const rsa = new RSAKey();
  rsa.setPublic(rsaModule, rsaExponent);
  const jno1 = rsa.encrypt(ssnFront);
  const jno2 = rsa.encrypt(ssnBack);

  return {
    hiraSession: { cookie: await hiraConfig!.jar!.getCookies(hireBaseURL) },
    hiraAuthSession: {
      cookie: await hiraAuthConfig!.jar!.getCookies(hireAuthBaseURL),
    },
    kakaoCertificationSession: {
      jno1,
      jno2,
      token: token2,
      cxId,
      txId,
      name,
      phone,
      phone1,
      phone2,
      ssn1,
      ssn2,
      ssnFront,
      ssnBack,
    },
  };
}
