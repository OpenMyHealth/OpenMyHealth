import _axios, { CreateAxiosDefaults } from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import { userAgentIphone6 } from "@persly/scraping/constants/userAgents";

export default function getAxiosSession(
  baseURL: string,
  cookie: { key: string; value: string }[] | null,
  options?: CreateAxiosDefaults,
) {
  const jar = new CookieJar();
  if (cookie) {
    cookie.map(({ value, key }: { value: string; key: string }) =>
      jar.setCookieSync(`${key}=${value}`, baseURL),
    );
  }
  const axios = _axios.create({
    headers: {
      "User-Agent": userAgentIphone6,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    jar,
    baseURL,
    ...options,
  });
  // axios가 호출될때마다 어떤 URL을 호출했는지 로그를 남김
  // axios.interceptors.request.use((config) => {
  //   console.log(config.method, config.url);
  //   if (config.data) console.log(config.data);
  //   return config;
  // });
  const client = wrapper(axios);
  return client;
}
