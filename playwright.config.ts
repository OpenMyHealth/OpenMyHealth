import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/visual",
  snapshotPathTemplate: "{testDir}/__snapshots__/{testFilePath}/{arg}{ext}",
  use: {
    viewport: { width: 420, height: 900 },
    colorScheme: "light",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
