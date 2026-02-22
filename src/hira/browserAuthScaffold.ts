import { HIRA_BASE_URL } from "./browserClient";

export const HIRA_AUTH_BASE_URL = "https://ptl.hira.or.kr";

export interface HiraSmsBootstrap {
  rsaModule: string;
  rsaExponent: string;
  encodeData: string;
}

export function extractRsaPublicKeyFromHtml(
  html: string,
): { rsaModule: string; rsaExponent: string } {
  const rsaModule = html.split('"rsaModule":"')[1]?.split('"')[0];
  const rsaExponent = html.split('"rsaExponent":"')[1]?.split('"')[0];

  if (!rsaModule || !rsaExponent) {
    throw new Error("HIRA auth page does not contain RSA public key");
  }

  return { rsaModule, rsaExponent };
}

export function extractHiddenInputValue(html: string, name: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const value = doc.querySelector<HTMLInputElement>(`input[name='${name}']`)?.value;

  if (!value) {
    throw new Error(`Missing hidden input: ${name}`);
  }

  return value;
}

export async function bootstrapHiraSmsAuth(
  fetcher: typeof fetch = fetch,
): Promise<HiraSmsBootstrap> {
  const [hiraLanding, hiraAuthMain] = await Promise.all([
    fetcher(`${HIRA_BASE_URL}/dummy.do?pgmid=HIRAA030009200000`, {
      credentials: "include",
    }),
    fetcher(
      `${HIRA_AUTH_BASE_URL}/main2.do?pageType=certByJ&domain=https://www.hira.or.kr&uri=JTJGcmIlMkZjbW1uJTJGcmJDZXJ0UmV0dXJuLmRvJTNGc3RyUGFnZVR5cGUlM0RESUFH`,
      {
        credentials: "include",
      },
    ),
  ]);

  if (!hiraLanding.ok) {
    throw new Error(`Failed to initialize HIRA session: ${hiraLanding.status}`);
  }

  if (!hiraAuthMain.ok) {
    throw new Error(`Failed to initialize HIRA auth session: ${hiraAuthMain.status}`);
  }

  const authHtml = await hiraAuthMain.text();
  const { rsaModule, rsaExponent } = extractRsaPublicKeyFromHtml(authHtml);

  return {
    rsaModule,
    rsaExponent,
    // `EncodeData` is later obtained from /co/checkplus/create.do response.
    encodeData: "",
  };
}
