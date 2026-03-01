import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: new URL(".", import.meta.url).pathname,
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
    },
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@contracts": new URL("../contracts/src/index.ts", import.meta.url).pathname,
    },
  },
});
