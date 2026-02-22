import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const staticDir = resolve(root, "static");

await rm(resolve(dist, "manifest.json"), { force: true });
await rm(resolve(dist, "sidepanel.html"), { force: true });
await mkdir(dist, { recursive: true });
await cp(resolve(staticDir, "manifest.json"), resolve(dist, "manifest.json"));
await cp(resolve(staticDir, "sidepanel.html"), resolve(dist, "sidepanel.html"));

console.log("copied static assets to dist/");
