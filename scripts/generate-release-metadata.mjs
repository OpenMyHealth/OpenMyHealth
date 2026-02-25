import { readFile, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
let commit = "unknown";
try {
  commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
} catch {
  commit = "unknown";
}

const metadata = {
  name: pkg.name,
  version: pkg.version,
  generatedAt: new Date().toISOString(),
  gitCommit: commit,
};

await writeFile(new URL("../dist/release-metadata.json", import.meta.url), JSON.stringify(metadata, null, 2));
