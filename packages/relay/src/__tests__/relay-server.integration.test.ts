import http from "node:http";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { loadConfig } from "../config.js";
import { createRouter } from "../handlers.js";
import { issueAccessToken } from "../auth.js";

const TEST_ENV: NodeJS.ProcessEnv = {
  RELAY_PORT: "0",
  RELAY_HOST: "127.0.0.1",
  RELAY_JWT_SECRET: "test-secret-that-is-at-least-32-chars-long!!",
  RELAY_PUBLIC_ORIGIN: "http://127.0.0.1:0",
  RELAY_CLIENT_REDIRECTS: "test-client=https://example.com/callback",
};

function request(
  server: http.Server,
  method: string,
  path: string,
  options?: {
    headers?: Record<string, string>;
    body?: string;
  },
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      reject(new Error("Server not listening"));
      return;
    }

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: addr.port,
        path,
        method,
        headers: options?.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf-8"),
          });
        });
      },
    );

    req.on("error", reject);

    if (options?.body) {
      req.write(options.body);
    }
    req.end();
  });
}

describe("relay server integration", () => {
  let server: http.Server;
  let config: ReturnType<typeof loadConfig>["config"];
  let stores: ReturnType<typeof loadConfig>["stores"];

  beforeAll(async () => {
    const loaded = loadConfig(TEST_ENV);
    config = loaded.config;
    stores = loaded.stores;
    const router = createRouter(config, stores);

    server = http.createServer(async (req, res) => {
      await router(req, res);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    // Update config with actual port
    const addr = server.address();
    if (addr && typeof addr !== "string") {
      config.PORT = addr.port;
      config.PUBLIC_ORIGIN = `http://127.0.0.1:${addr.port}`;
    }
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("GET /health returns 200 with service info", async () => {
    const res = await request(server, "GET", "/health");

    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.ok).toBe(true);
    expect(json.service).toBe("openmyhealth-relay");
    expect(json.version).toBe("0.1.0");
    expect(json.issuer).toBe("openmyhealth-relay");
  });

  it("GET /authorize with valid params returns 200 HTML consent page", async () => {
    const params = new URLSearchParams({
      client_id: "test-client",
      redirect_uri: "https://example.com/callback",
      response_type: "code",
      state: "test-state-123",
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      code_challenge_method: "S256",
    });

    const res = await request(server, "GET", `/authorize?${params.toString()}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("test-client");
    expect(res.body).toContain("승인");
  });

  it("GET /authorize with invalid params returns 400", async () => {
    const res = await request(server, "GET", "/authorize?client_id=invalid");

    expect(res.status).toBe(400);
    const json = JSON.parse(res.body);
    expect(json.error).toBe("invalid_request");
  });

  it("POST /token without code returns 400 error", async () => {
    const res = await request(server, "POST", "/token", {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=authorization_code&client_id=test-client",
    });

    expect(res.status).toBe(400);
    const json = JSON.parse(res.body);
    expect(json.error).toBe("invalid_grant");
  });

  it("POST /mcp without auth returns 401 via JSON-RPC error", async () => {
    const res = await request(server, "POST", "/mcp", {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
    });

    expect(res.status).toBe(401);
    const json = JSON.parse(res.body);
    expect(json.error).toBeTruthy();
    expect(json.error.code).toBe(-32001);
  });

  it("POST /mcp with valid auth returns tools list", async () => {
    const token = issueAccessToken(config, "test-user", "test-client");

    const res = await request(server, "POST", "/mcp", {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
    });

    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.result).toBeTruthy();
    expect(json.result.tools).toBeInstanceOf(Array);
    expect(json.result.tools[0].name).toBe("read_health_records");
  });

  it("GET /nonexistent returns 404", async () => {
    const res = await request(server, "GET", "/nonexistent");

    expect(res.status).toBe(404);
  });
});
