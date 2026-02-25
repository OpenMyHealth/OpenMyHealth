import { test, expect } from "@playwright/test";
import path from "node:path";

test("sidepanel UI renders key sections", async ({ page }) => {
  const filePath = `file://${path.resolve(process.cwd(), "static/sidepanel.html")}`;
  await page.goto(filePath);

  await expect(page.getByRole("heading", { name: "OpenMyHealth Safety Layer" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "1) 데이터 소스 연결" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "3) 로컬 검색 + 승인" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "전송 이력 (투명성 로그)" })).toBeVisible();
});
