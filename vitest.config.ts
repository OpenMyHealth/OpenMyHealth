import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing";

export default defineConfig({
  plugins: [await WxtVitest()],
  test: {
    globals: true,
    environment: "node",
    include: [
      "src/**/*.test.{ts,tsx}",
      "entrypoints/**/*.test.{ts,tsx}",
      "packages/contracts/**/*.test.ts",
    ],
    exclude: ["src/**/*.integration.test.ts"],
    setupFiles: ["./src/test-setup.ts"],
    coverage: {
      provider: "v8",
      include: [
        "src/core/**/*.ts",
        "src/content/**/*.ts",
        "src/components/**/*.{ts,tsx}",
        "src/hooks/**/*.ts",
        "entrypoints/background.ts",
        "entrypoints/content.tsx",
        "entrypoints/vault/**/*.{ts,tsx}",
        "packages/contracts/src/**/*.ts",
      ],
      exclude: [
        "src/core/models.ts",
        "src/core/messages.ts",
        "src/content/style.ts",
        "src/components/ui/**",
        "entrypoints/background.ts",
        "entrypoints/content.tsx",
        "entrypoints/vault/bootstrap.ts",
        "entrypoints/vault/main.tsx",
        "src/**/*.test.{ts,tsx}",
        "entrypoints/**/*.test.{ts,tsx}",
        "packages/**/*.test.ts",
      ],
      thresholds: { lines: 95, functions: 95, branches: 90, statements: 95 },
    },
    isolate: true,
    testTimeout: 30_000,
  },
});
