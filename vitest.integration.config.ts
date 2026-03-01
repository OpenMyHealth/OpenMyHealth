import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing";

export default defineConfig({
  plugins: [await WxtVitest()],
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    setupFiles: ["./src/test-setup.ts"],
    isolate: true,
    testTimeout: 60_000,
  },
});
