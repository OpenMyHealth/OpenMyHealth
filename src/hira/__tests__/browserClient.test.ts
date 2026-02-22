import dayjs from "dayjs";
import { buildHiraSearchParams } from "../browserClient";

describe("buildHiraSearchParams", () => {
  it("기준일 기준 5년+3일 조회 윈도우를 생성한다", () => {
    const now = dayjs("2026-02-22");
    const params = buildHiraSearchParams(now);

    expect(params.srchToDd).toBe("20260222");
    expect(params.srchFrDd).toBe("20210225");
    expect(params.recordCountPerPage).toBe(10000);
    expect(params.srchAllYn).toBe("Y");
  });
});
