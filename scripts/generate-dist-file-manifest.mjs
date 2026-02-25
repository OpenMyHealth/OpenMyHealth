import { readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

async function listFiles(dir) {
  const out = [];
  const items = await readdir(dir);
  for (const item of items) {
    const full = join(dir, item);
    const info = await stat(full);
    if (info.isDirectory()) {
      out.push(...(await listFiles(full)));
    } else {
      out.push({ path: full.replace(/^dist\//, ""), size: info.size });
    }
  }
  return out;
}

const files = await listFiles("dist");
files.sort((a, b) => a.path.localeCompare(b.path));

await writeFile("dist/file-manifest.json", JSON.stringify({ files }, null, 2));
