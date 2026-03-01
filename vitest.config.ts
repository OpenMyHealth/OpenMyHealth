import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing";

export default defineConfig({
  plugins: [await WxtVitest()],
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./src/test-setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/core/**/*.ts"],
      exclude: [
        "src/core/models.ts",
        "src/core/messages.ts",
        "src/**/*.test.ts",
      ],
      thresholds: { lines: 99, functions: 99, branches: 95, statements: 99 },
    },
    isolate: true,
    testTimeout: 30_000,
  },
});
