import { expect, test } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

test("sidepanel visual regression", async ({ page }) => {
  const sidepanelPath = join(process.cwd(), "static", "sidepanel.html");
  await page.goto(pathToFileURL(sidepanelPath).toString());

  // Hide status timestamp drift and keep screenshot stable.
  await page.evaluate(() => {
    const status = document.getElementById("status");
    if (status) {
      status.textContent = "";
    }
  });

  await expect(page).toHaveScreenshot("sidepanel-initial.png", {
    fullPage: true,
  });
});
