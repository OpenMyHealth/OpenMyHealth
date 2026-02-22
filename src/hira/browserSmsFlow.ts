import { Hira5ySubmitResponse } from "../context/types";
import {
  fetchHira5yPayloadFromAuthenticatedSession,
  HIRA_BASE_URL,
} from "./browserClient";
import { HIRA_AUTH_BASE_URL } from "./browserAuthScaffold";

const CERT_BY_JUMIN_BODY =
  "%40d1%23usr_nm=&%40d1%23jumin_no=&%40d1%23jumin_no1=&%40d1%23jumin_no2=&%40d1%23domain=https%3A%2F%2Fwww.hira.or.kr&%40d1%23uri=JTJGcmIlMkZjbW1uJTJGcmJDZXJ0UmV0dXJuLmRvJTNGc3RyUGFnZVR5cGUlM0RESUFH&%40d1%23resParam=&%40d1%23resToken=&%40d1%23resultCode=&%40d1%23encJno1=&%40d1%23encJno2=&%40d1%23contStr=%EB%82%B4%20%EC%A7%84%EB%A3%8C%EC%A0%95%EB%B3%B4%20%EC%97%B4%EB%9E%8C%20&%40d1%23contStrView=%EB%82%B4%20%EC%A7%84%EB%A3%8C%EC%A0%95%EB%B3%B4%20%EC%97%B4%EB%9E%8C%20%EB%B3%B8%EC%9D%B8%EC%9D%B8%EC%A6%9D&%40d%23=%40d1%23&%40d1%23=dmParam&%40d1%23tp=dm&";

interface LoginResponse {
  dmResult?: {
    tknSno?: string;
  };
}

export function extractTknSno(payload: LoginResponse): string {
  const tknSno = payload?.dmResult?.tknSno;
  if (!tknSno) {
    throw new Error("tknSno-not-found");
  }
  return tknSno;
}

async function parseLoginResponse(response: Response): Promise<LoginResponse> {
  const text = await response.text();
  try {
    return JSON.parse(text) as LoginResponse;
  } catch {
    throw new Error(`invalid-login-response: ${text.slice(0, 160)}`);
  }
}

export async function finalizeSmsAuthAndFetchPayload({
  encodeData,
  fetcher = fetch,
}: {
  encodeData: string;
  fetcher?: typeof fetch;
}): Promise<Hira5ySubmitResponse> {
  if (!encodeData) {
    throw new Error("encodeData-required");
  }

  const success = await fetcher(
    `${HIRA_AUTH_BASE_URL}/co/checkplus/success.do?EncodeData=${encodeData}`,
    {
      method: "GET",
      credentials: "include",
    },
  );

  if (!success.ok) {
    throw new Error(`checkplus-success-failed: ${success.status}`);
  }

  const loginResponse = await fetcher(
    `${HIRA_AUTH_BASE_URL}/pl/login/certByJumin.do`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: CERT_BY_JUMIN_BODY,
    },
  );

  if (!loginResponse.ok) {
    throw new Error(`certByJumin-failed: ${loginResponse.status}`);
  }

  const loginPayload = await parseLoginResponse(loginResponse);
  const tknSno = extractTknSno(loginPayload);

  const payload = await fetchHira5yPayloadFromAuthenticatedSession({
    tknSno,
    fetcher,
  });

  // This request keeps session warm and mirrors original flow where hira domain is touched first.
  await fetcher(`${HIRA_BASE_URL}/rb/diag/selectMyDiagInfmList.do?pgmid=HIRAA070001000600`, {
    method: "GET",
    credentials: "include",
  });

  return payload;
}
