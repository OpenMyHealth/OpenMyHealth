import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4173;

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".txt": "text/plain",
};

const ALLOWED_ROOT = path.resolve(__dirname);
const ALLOWED_DATA = path.resolve(__dirname, "..", "data");

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  let filePath;

  if (url.pathname.startsWith("/data/")) {
    filePath = path.resolve(__dirname, "..", url.pathname.slice(1));
  } else {
    filePath = path.resolve(__dirname, url.pathname === "/" ? "index.html" : url.pathname.slice(1));
  }

  // Prevent path traversal
  if (!filePath.startsWith(ALLOWED_ROOT) && !filePath.startsWith(ALLOWED_DATA)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`[harness] serving on http://localhost:${PORT}`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
