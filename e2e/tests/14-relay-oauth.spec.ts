import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let relayProcess: ChildProcess;
let relayPort: number;
let relayBaseUrl: string;

const JWT_SECRET = "test-secret-at-least-32-characters-long!!";

function base64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function generatePKCE() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(
    crypto.createHash("sha256").update(verifier).digest(),
  );
  return { verifier, challenge };
}

/** Extract just name=value pairs from Set-Cookie header */
function extractCookies(setCookie: string): string {
  return setCookie
    .split(",")
    .map((part) => part.trim().split(";")[0])
    .join("; ");
}

async function fetchJSON(url: string, options?: RequestInit) {
  const response = await fetch(url, options);
  return {
    status: response.status,
    headers: response.headers,
    body: response.headers.get("content-type")?.includes("json")
      ? await response.json()
      : await response.text(),
    response,
  };
}

const TEST_UA = "OpenMyHealth-E2E-Test/1.0";

/**
 * POST via http.request — Node.js fetch() forcibly overrides Sec-Fetch-Mode
 * to "cors", but the relay server requires "navigate". Using http.request
 * avoids this browser-spec enforcement.
 */
function httpPost(
  url: string,
  headers: Record<string, string>,
  body: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString()));
        res.on("end", () =>
          resolve({ status: res.statusCode!, headers: res.headers, body: data }),
        );
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/** Complete OAuth authorize + confirm flow, returns auth code */
async function getAuthCode(opts: {
  verifier?: string;
  challenge: string;
  state?: string;
}): Promise<{ code: string; verifier?: string } | null> {
  const params = new URLSearchParams({
    client_id: "test-client",
    redirect_uri: `${relayBaseUrl}/callback`,
    state: opts.state ?? "test-state",
    code_challenge: opts.challenge,
    code_challenge_method: "S256",
    response_type: "code",
  });

  const authResponse = await fetch(`${relayBaseUrl}/authorize?${params}`, {
    headers: { "User-Agent": TEST_UA },
  });
  const html = await authResponse.text();
  const rawCookies = authResponse.headers.get("set-cookie") ?? "";
  const cookies = extractCookies(rawCookies);

  const csrfMatch = html.match(/name="csrf_token"\s+value="([^"]+)"/);
  const requestIdMatch = html.match(/name="request_id"\s+value="([^"]+)"/);

  if (!csrfMatch || !requestIdMatch) return null;

  const confirmBody = new URLSearchParams({
    csrf_token: csrfMatch[1],
    request_id: requestIdMatch[1],
    decision: "approve",
  }).toString();

  const confirmResponse = await httpPost(
    `${relayBaseUrl}/authorize/confirm`,
    {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookies,
      Origin: relayBaseUrl,
      Referer: `${relayBaseUrl}/authorize`,
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Dest": "document",
      "User-Agent": TEST_UA,
    },
    confirmBody,
  );

  if (confirmResponse.status !== 302 && confirmResponse.status !== 303) {
    return null;
  }

  const location = confirmResponse.headers.location;
  if (!location) return null;

  const code = new URL(location).searchParams.get("code")!;
  return { code, verifier: opts.verifier };
}

/** Complete OAuth flow to get tokens */
async function getTokens(state?: string) {
  const { verifier, challenge } = generatePKCE();
  const result = await getAuthCode({ verifier, challenge, state });
  if (!result) return null;

  const tokenResponse = await fetchJSON(`${relayBaseUrl}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: result.code,
      client_id: "test-client",
      redirect_uri: `${relayBaseUrl}/callback`,
      code_verifier: verifier,
    }),
  });

  if (tokenResponse.status !== 200) return null;
  return tokenResponse.body as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
}

test.describe("Relay OAuth", () => {
  test.beforeAll(async () => {
    // Build relay
    const buildResult = spawn(
      "npx",
      ["tsc", "-p", "packages/relay/tsconfig.json"],
      {
        cwd: path.resolve(__dirname, "../.."),
        stdio: "pipe",
      },
    );
    await new Promise<void>((resolve, reject) => {
      buildResult.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`Build failed: ${code}`)),
      );
      buildResult.on("error", reject);
    });

    // Start relay server
    relayPort = 18787 + Math.floor(Math.random() * 1000);
    relayBaseUrl = `http://127.0.0.1:${relayPort}`;

    relayProcess = spawn(
      "node",
      ["packages/relay/dist/relay/src/server.js"],
      {
        cwd: path.resolve(__dirname, "../.."),
        env: {
          ...process.env,
          RELAY_PORT: String(relayPort),
          RELAY_HOST: "127.0.0.1",
          RELAY_JWT_SECRET: JWT_SECRET,
          RELAY_PUBLIC_ORIGIN: relayBaseUrl,
          RELAY_CLIENT_IDS: "test-client",
          RELAY_REDIRECT_ALLOWLIST: `${relayBaseUrl}/callback`,
          RELAY_CLIENT_REDIRECTS: `test-client=${relayBaseUrl}/callback`,
        },
        stdio: "pipe",
      },
    );

    // Wait for server to start
    await new Promise<void>((resolve) => {
      relayProcess.stdout?.on("data", (data: Buffer) => {
        if (data.toString().includes("listening")) resolve();
      });
      setTimeout(resolve, 3000);
    });
  });

  test.afterAll(async () => {
    if (relayProcess) {
      relayProcess.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => relayProcess.on("close", resolve)),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
      if (!relayProcess.killed) relayProcess.kill("SIGKILL");
    }
  });

  test("GET /health returns 200 with service info", async () => {
    const { status, body } = await fetchJSON(`${relayBaseUrl}/health`);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.version).toBeTruthy();
    expect(body.service).toBe("openmyhealth-relay");
  });

  test("GET /authorize returns consent HTML page", async () => {
    const { challenge } = generatePKCE();
    const params = new URLSearchParams({
      client_id: "test-client",
      redirect_uri: `${relayBaseUrl}/callback`,
      state: "test-state",
      code_challenge: challenge,
      code_challenge_method: "S256",
      response_type: "code",
    });

    const response = await fetch(`${relayBaseUrl}/authorize?${params}`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("html");
  });

  test("POST /authorize/confirm redirects with code", async () => {
    const { challenge } = generatePKCE();
    const result = await getAuthCode({ challenge });
    expect(result).toBeTruthy();
    expect(result!.code).toBeTruthy();
  });

  test("POST /token with auth_code returns tokens", async () => {
    const tokens = await getTokens("token-test");
    expect(tokens).toBeTruthy();
    expect(tokens!.access_token).toBeTruthy();
    expect(tokens!.refresh_token).toBeTruthy();
  });

  test("POST /token with refresh returns new tokens", async () => {
    const tokens = await getTokens("refresh-test");
    expect(tokens).toBeTruthy();

    const refreshResponse = await fetchJSON(`${relayBaseUrl}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens!.refresh_token,
        client_id: "test-client",
      }),
    });

    expect(refreshResponse.status).toBe(200);
    expect(refreshResponse.body.access_token).toBeTruthy();
    expect(refreshResponse.body.refresh_token).toBeTruthy();
    expect(refreshResponse.body.refresh_token).not.toBe(tokens!.refresh_token);
  });

  test("refresh token reuse revokes family", async () => {
    const tokens = await getTokens("reuse-test");
    expect(tokens).toBeTruthy();

    // First refresh (valid)
    const firstRefresh = await fetchJSON(`${relayBaseUrl}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens!.refresh_token,
        client_id: "test-client",
      }),
    });
    expect(firstRefresh.status).toBe(200);

    // Reuse original token (should fail - family revoked)
    const reuseAttempt = await fetchJSON(`${relayBaseUrl}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens!.refresh_token,
        client_id: "test-client",
      }),
    });
    expect(reuseAttempt.status).toBe(400);
  });

  test("POST /mcp with tools/list returns tools", async () => {
    const tokens = await getTokens("mcp-test");
    expect(tokens).toBeTruthy();

    const mcpResponse = await fetchJSON(`${relayBaseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokens!.access_token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
    });

    expect(mcpResponse.status).toBe(200);
    expect(mcpResponse.body.result).toBeTruthy();
    expect(mcpResponse.body.result.tools).toBeInstanceOf(Array);
    const toolNames = mcpResponse.body.result.tools.map(
      (t: any) => t.name,
    );
    expect(toolNames).toContain("read_health_records");
  });

  test("expired token returns 401", async () => {
    const mcpResponse = await fetchJSON(`${relayBaseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer expired-token-does-not-exist",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
    });
    expect(mcpResponse.status).toBe(401);
  });
});
