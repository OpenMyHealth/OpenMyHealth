import { build } from "esbuild";

const entries = {
  "background/index": "src/background/index.ts",
  "content/chatgpt": "src/content/chatgpt.ts",
  "content/gemini": "src/content/gemini.ts",
  "content/claude": "src/content/claude.ts",
  "content/source-pages": "src/content/source-pages.ts",
  "sidepanel/index": "src/sidepanel/index.ts"
};

await build({
  entryPoints: entries,
  outdir: "dist",
  bundle: true,
  format: "esm",
  target: ["chrome114"],
  sourcemap: false,
  minify: false,
  logLevel: "info"
});
