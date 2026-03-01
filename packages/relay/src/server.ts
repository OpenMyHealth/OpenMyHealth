import http from "node:http";
import { loadConfig } from "./config.js";
import { cleanupExpiredTokens } from "./auth.js";
import { createRouter } from "./handlers.js";

const { config, stores } = loadConfig();
const router = createRouter(config, stores);

const server = http.createServer(async (req, res) => {
  await router(req, res);
});

const cleanupInterval = setInterval(() => cleanupExpiredTokens(stores), 10 * 60 * 1000);
cleanupInterval.unref();

server.on("close", () => {
  clearInterval(cleanupInterval);
});

server.listen(config.PORT, config.HOST, () => {
  console.log(`[relay] listening on http://${config.HOST}:${config.PORT}`);
});
