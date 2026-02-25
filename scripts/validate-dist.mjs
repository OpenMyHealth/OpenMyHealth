import { access } from "node:fs/promises";

const required = [
  "dist/manifest.json",
  "dist/background/index.js",
  "dist/content/chatgpt.js",
  "dist/content/gemini.js",
  "dist/content/claude.js",
  "dist/content/source-pages.js",
  "dist/sidepanel/index.js",
  "dist/sidepanel.html",
  "dist/release-metadata.json",
  "dist/file-manifest.json"
];

for (const path of required) {
  try {
    await access(path);
  } catch {
    throw new Error(`Missing required dist file: ${path}`);
  }
}

console.log("dist validation passed");
