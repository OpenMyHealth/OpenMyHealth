import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    files: ["src/**/*.ts", "entrypoints/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        sourceType: "module",
      },
      globals: {
        chrome: "readonly",
        document: "readonly",
        window: "readonly",
        navigator: "readonly",
        HTMLTextAreaElement: "readonly",
        HTMLInputElement: "readonly",
        HTMLElement: "readonly",
        Event: "readonly",
        InputEvent: "readonly",
        DOMParser: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tseslint.configs.recommended.rules,
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_"
        }
      ]
    },
  },
  {
    ignores: ["dist/**", "node_modules/**"]
  }
];
