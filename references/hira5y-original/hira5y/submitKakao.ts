import {
  Hira5ySubmitKakaoRequest,
  Hira5ySubmitResponse,
  hireAuthBaseURL,
  hireBaseURL,
} from "@persly/scraping/scrapers/hira5y/common";
import hira5yParser from "@persly/scraping/scrapers/hira5y/parser";
import getAxiosSession from "@persly/scraping/utils/getAxiosSession";
import { TRPCError } from "@trpc/server";

export default async function hira5ySubmitKakao({
  kakaoCertificationSession,
  hiraAuthSession,
  hiraSession,
}: Hira5ySubmitKakaoRequest): Promise<Hira5ySubmitResponse> {
  const {
    jno1,
    jno2,
    token,
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
  } = kakaoCertificationSession;
  const hiraClient = getAxiosSession(hireBaseURL, hiraSession.cookie);
  const hiraAuthClient = getAxiosSession(
    hireAuthBaseURL,
    hiraAuthSession.cookie,
  );

  const {
    data: { token: token1, ...rest },
  } = await hiraAuthClient.post(
    "/oacx/api/v1.0/authen/result",
    {
      providerId: "kakao",
      providerName: "카카오톡",
      deeplinkUri: "",
      naverAppSchemeUrl: "",
      telcoTxid: "",
      mdlAppHash: "",
      id: "",
      provider: "kakao_v1.5",
      token,
      txId,
      cxId,
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
      useMdlSsn: false,
    },
    {
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
      },
    },
  );
  if (rest.resultCode !== "200") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: rest.clientMessage || "Hira kakao 인증 실패",
      cause: rest,
    });
  }

  const {
    data: { dmResult },
  } = await hiraAuthClient.post(
    "/pl/login/simpleCert.do",
    `%40d1%23usr_nm=&%40d1%23jumin_no=${ssnFront + ssnBack}&%40d1%23jumin_no1=${ssnFront}&%40d1%23jumin_no2=${ssnBack}&%40d1%23domain=https%3A%2F%2Fwww.hira.or.kr&%40d1%23uri=JTJGcmIlMkZjbW1uJTJGcmJDZXJ0UmV0dXJuLmRvJTNGc3RyUGFnZVR5cGUlM0RESUFH&%40d1%23resParam=%5Bobject%20Object%5D&%40d1%23resToken=${token1}&%40d1%23resultCode=200&%40d1%23encJno1=${jno1}&%40d1%23encJno2=${jno2}&%40d1%23contStr=%EB%82%B4%20%EC%A7%84%EB%A3%8C%EC%A0%95%EB%B3%B4%20%EC%97%B4%EB%9E%8C%20&%40d1%23contStrView=%EB%82%B4%20%EC%A7%84%EB%A3%8C%EC%A0%95%EB%B3%B4%20%EC%97%B4%EB%9E%8C%20%EB%B3%B8%EC%9D%B8%EC%9D%B8%EC%A6%9D&%40d%23=%40d1%23&%40d1%23=dmParam&%40d1%23tp=dm&`,
  );
  const { treatmentsSummary, treatmentsDetail, prescriptions } =
    await hira5yParser({
      hiraClient,
      tknSno: dmResult.tknSno,
    });
  return { treatmentsSummary, treatmentsDetail, prescriptions };
}
