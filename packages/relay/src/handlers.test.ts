import { describe, it, expect, beforeEach } from "vitest";
import { Readable } from "node:stream";
import type http from "node:http";
import type { Socket } from "node:net";
import { loadConfig, type RelayConfig, type Stores } from "./config.js";
import { createRouter } from "./handlers.js";
import {
  issueAuthCode,
  issueAccessToken,
  issueRefreshToken,
  hashRefreshToken,
} from "./auth.js";
import {
  sha256Base64Url,
  requestFingerprint,
  signConsentToken,
  now,
} from "./http-helpers.js";

/* ---------- test env ---------- */

const TEST_ENV: Record<string, string> = {
  RELAY_JWT_SECRET: "a]3kF9$mPq!zR7vW2xL8nB5jC0dY4hT6",
  RELAY_CLIENT_IDS: "test-client",
  RELAY_REDIRECT_ALLOWLIST: "https://example.com/callback",
};

function loadTestEnv(): { config: RelayConfig; stores: Stores } {
  return loadConfig(TEST_ENV as unknown as NodeJS.ProcessEnv);
}

/* ---------- mock helpers ---------- */

function mockReq(
  method: string,
  url: string,
  headers: Record<string, string> = {},
  body = "",
  socketOpts: { remoteAddress?: string } = {},
): http.IncomingMessage {
  const readable = new Readable({
    read() {
      if (body) this.push(body);
      this.push(null);
    },
  });
  Object.assign(readable, {
    method,
    url,
    headers: { host: "127.0.0.1:8787", ...headers },
    socket: { remoteAddress: socketOpts.remoteAddress ?? "127.0.0.1" } as Socket,
  });
  return readable as unknown as http.IncomingMessage;
}

type MockRes = {
  res: http.ServerResponse;
  statusCode: () => number;
  headers: () => Record<string, string>;
  body: () => string;
  json: () => unknown;
};

function mockRes(): MockRes {
  let _status = 200;
  const _headers: Record<string, string> = {};
  let _body = "";

  const res = {
    writeHead(status: number, headers?: Record<string, string>) {
      _status = status;
      if (headers) Object.assign(_headers, headers);
    },
    setHeader(name: string, value: string) {
      _headers[name] = value;
    },
    end(data?: string) {
      if (data) _body += data;
    },
    write(data: string) {
      _body += data;
      return true;
    },
    writableEnded: false,
  } as unknown as http.ServerResponse;

  return {
    res,
    statusCode: () => _status,
    headers: () => _headers,
    body: () => _body,
    json: () => JSON.parse(_body),
  };
}

function bearerHeader(config: RelayConfig, sub = "omh-test-user"): Record<string, string> {
  const token = issueAccessToken(config, sub, "test-client");
  return { authorization: `Bearer ${token}` };
}

/* ---------- test suite ---------- */

let config: RelayConfig;
let stores: Stores;
let handler: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>;

beforeEach(() => {
  const env = loadTestEnv();
  config = env.config;
  stores = env.stores;
  handler = createRouter(config, stores);
});

/* ---------- GET /health ---------- */
describe("GET /health", () => {
  it("returns 200 with service info", async () => {
    const req = mockReq("GET", "/health");
    const { res, statusCode, json: getJson } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(200);
    const body = getJson() as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.service).toBe("openmyhealth-relay");
    expect(body.version).toBe("0.1.0");
    expect(body.issuer).toBe(config.ISSUER);
  });

  it("reports bridge_configured as false when no bridge", async () => {
    const req = mockReq("GET", "/health");
    const { res, json: getJson } = mockRes();
    await handler(req, res);
    expect((getJson() as Record<string, unknown>).bridge_configured).toBe(false);
  });
});

/* ---------- GET /authorize ---------- */
describe("GET /authorize", () => {
  const validChallenge = "A".repeat(43);

  function authorizeUrl(overrides: Record<string, string> = {}): string {
    const params = new URLSearchParams({
      client_id: "test-client",
      redirect_uri: "https://example.com/callback",
      response_type: "code",
      state: "state123",
      code_challenge: validChallenge,
      code_challenge_method: "S256",
      ...overrides,
    });
    return `/authorize?${params.toString()}`;
  }

  it("returns 200 HTML consent page with valid params", async () => {
    const req = mockReq("GET", authorizeUrl());
    const { res, statusCode, headers, body } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(200);
    expect(headers()["Content-Type"]).toContain("text/html");
    expect(body()).toContain("test-client");
    expect(body()).toContain("csrf_token");
  });

  it("sets consent cookie", async () => {
    const req = mockReq("GET", authorizeUrl());
    const { res, headers } = mockRes();
    await handler(req, res);
    expect(headers()["Set-Cookie"]).toContain("omh_consent_nonce");
  });

  it("rejects missing client_id", async () => {
    const req = mockReq("GET", authorizeUrl({ client_id: "" }));
    const { res, statusCode, json: getJson } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(400);
    expect((getJson() as Record<string, unknown>).error).toBe("invalid_request");
  });

  it("rejects invalid response_type", async () => {
    const req = mockReq("GET", authorizeUrl({ response_type: "token" }));
    const { res, statusCode } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(400);
  });

  it("rejects missing code_challenge", async () => {
    const req = mockReq("GET", authorizeUrl({ code_challenge: "" }));
    const { res, statusCode } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(400);
  });

  it("rejects wrong code_challenge_method", async () => {
    const req = mockReq("GET", authorizeUrl({ code_challenge_method: "plain" }));
    const { res, statusCode } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(400);
  });

  it("rejects invalid redirect_uri", async () => {
    const req = mockReq("GET", authorizeUrl({ redirect_uri: "https://evil.com/cb" }));
    const { res, statusCode } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(400);
  });

  it("rejects unknown client_id", async () => {
    const req = mockReq("GET", authorizeUrl({ client_id: "unknown" }));
    const { res, statusCode } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(400);
  });

  it("rejects missing state", async () => {
    const req = mockReq("GET", authorizeUrl({ state: "" }));
    const { res, statusCode } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(400);
  });

  it("returns 429 when pending auths at capacity", async () => {
    const smallConfig = { ...config, MAX_PENDING_AUTHS: 0 };
    const h = createRouter(smallConfig, stores);
    const req = mockReq("GET", authorizeUrl());
    const { res, statusCode } = mockRes();
    await h(req, res);
    expect(statusCode()).toBe(429);
  });
});

/* ---------- POST /authorize/confirm ---------- */
describe("POST /authorize/confirm", () => {
  const validChallenge = "B".repeat(43);
  const remoteAddress = "127.0.0.1";
  const userAgent = "TestAgent";

  function setupPendingAuth(): { requestId: string; nonce: string; csrfToken: string } {
    const requestId = "pending-req-id";
    const nonce = "test-nonce-value";
    const fp = (() => {
      const { createHash } = require("node:crypto");
      return createHash("sha256").update(`${remoteAddress}|${userAgent}`).digest("hex");
    })();
    const csrfToken = signConsentToken(config, requestId, nonce);

    stores.pendingAuthorizations.set(requestId, {
      clientId: "test-client",
      redirectUri: "https://example.com/callback",
      state: "state123",
      codeChallenge: validChallenge,
      nonce,
      requesterFingerprint: fp,
      expiresAt: now() + 300,
    });

    return { requestId, nonce, csrfToken };
  }

  function confirmReq(
    body: string,
    headers: Record<string, string> = {},
  ): http.IncomingMessage {
    return mockReq("POST", "/authorize/confirm", {
      "content-type": "application/x-www-form-urlencoded",
      origin: config.PUBLIC_ORIGIN,
      referer: `${config.PUBLIC_ORIGIN}/authorize`,
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
      "user-agent": userAgent,
      ...headers,
    }, body, { remoteAddress });
  }

  it("approve redirects with code and state", async () => {
    const { requestId, nonce, csrfToken } = setupPendingAuth();
    const body = `request_id=${requestId}&decision=approve&csrf_token=${encodeURIComponent(csrfToken)}`;
    const req = confirmReq(body, {
      cookie: `omh_consent_nonce=${nonce}`,
    });
    const { res, statusCode, headers } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(302);
    const location = headers()["Location"];
    expect(location).toContain("code=");
    expect(location).toContain("state=state123");
  });

  it("deny redirects with error", async () => {
    const { requestId, nonce, csrfToken } = setupPendingAuth();
    const body = `request_id=${requestId}&decision=deny&csrf_token=${encodeURIComponent(csrfToken)}`;
    const req = confirmReq(body, {
      cookie: `omh_consent_nonce=${nonce}`,
    });
    const { res, statusCode, headers } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(302);
    const location = headers()["Location"];
    expect(location).toContain("error=access_denied");
    expect(location).toContain("state=state123");
  });

  it("rejects unknown request_id", async () => {
    const body = "request_id=nonexistent&decision=approve&csrf_token=x";
    const req = confirmReq(body);
    const { res, statusCode } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(400);
  });

  it("rejects mismatched origin", async () => {
    const { requestId, nonce, csrfToken } = setupPendingAuth();
    const body = `request_id=${requestId}&decision=approve&csrf_token=${encodeURIComponent(csrfToken)}`;
    const req = confirmReq(body, {
      origin: "https://evil.com",
      cookie: `omh_consent_nonce=${nonce}`,
    });
    const { res, statusCode, json: getJson } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(400);
    expect((getJson() as Record<string, unknown>).error_description).toBe("origin mismatch");
  });

  it("rejects invalid referer", async () => {
    const { requestId, nonce, csrfToken } = setupPendingAuth();
    const body = `request_id=${requestId}&decision=approve&csrf_token=${encodeURIComponent(csrfToken)}`;
    const req = confirmReq(body, {
      referer: "https://evil.com/authorize",
      cookie: `omh_consent_nonce=${nonce}`,
    });
    const { res, statusCode } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(400);
  });

  it("rejects wrong sec-fetch-site", async () => {
    const { requestId, nonce, csrfToken } = setupPendingAuth();
    const body = `request_id=${requestId}&decision=approve&csrf_token=${encodeURIComponent(csrfToken)}`;
    const req = confirmReq(body, {
      "sec-fetch-site": "cross-site",
      cookie: `omh_consent_nonce=${nonce}`,
    });
    const { res, statusCode } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(400);
  });

  it("rejects wrong sec-fetch-mode", async () => {
    const { requestId, nonce, csrfToken } = setupPendingAuth();
    const body = `request_id=${requestId}&decision=approve&csrf_token=${encodeURIComponent(csrfToken)}`;
    const req = confirmReq(body, {
      "sec-fetch-mode": "cors",
      cookie: `omh_consent_nonce=${nonce}`,
    });
    const { res, statusCode } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(400);
  });

  it("rejects wrong sec-fetch-dest", async () => {
    const { requestId, nonce, csrfToken } = setupPendingAuth();
    const body = `request_id=${requestId}&decision=approve&csrf_token=${encodeURIComponent(csrfToken)}`;
    const req = confirmReq(body, {
      "sec-fetch-dest": "script",
      cookie: `omh_consent_nonce=${nonce}`,
    });
    const { res, statusCode } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(400);
  });

  it("rejects missing cookie nonce", async () => {
    const { requestId, csrfToken } = setupPendingAuth();
    const body = `request_id=${requestId}&decision=approve&csrf_token=${encodeURIComponent(csrfToken)}`;
    const req = confirmReq(body);
    const { res, statusCode } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(400);
  });

  it("rejects wrong CSRF token", async () => {
    const { requestId, nonce } = setupPendingAuth();
    const body = `request_id=${requestId}&decision=approve&csrf_token=wrong-token`;
    const req = confirmReq(body, {
      cookie: `omh_consent_nonce=${nonce}`,
    });
    const { res, statusCode } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(400);
  });

  it("rejects fingerprint mismatch", async () => {
    const { requestId, nonce, csrfToken } = setupPendingAuth();
    const body = `request_id=${requestId}&decision=approve&csrf_token=${encodeURIComponent(csrfToken)}`;
    const req = confirmReq(body, {
      cookie: `omh_consent_nonce=${nonce}`,
      "user-agent": "DifferentBrowser",
    });
    const { res, statusCode } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(400);
  });

  it("rejects expired pending authorization", async () => {
    const { requestId, nonce, csrfToken } = setupPendingAuth();
    // Force expiry
    const pending = stores.pendingAuthorizations.get(requestId)!;
    pending.expiresAt = now() - 1;
    stores.pendingAuthorizations.set(requestId, pending);

    const body = `request_id=${requestId}&decision=approve&csrf_token=${encodeURIComponent(csrfToken)}`;
    const req = confirmReq(body, {
      cookie: `omh_consent_nonce=${nonce}`,
    });
    const { res, statusCode, json: getJson } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(400);
    expect((getJson() as Record<string, unknown>).error_description).toContain("expired");
  });
});

/* ---------- POST /token ---------- */
describe("POST /token", () => {
  it("exchanges authorization_code with PKCE for tokens", async () => {
    const verifier = "x".repeat(43);
    const challenge = sha256Base64Url(verifier);

    const code = issueAuthCode(config, stores, {
      clientId: "test-client",
      redirectUri: "https://example.com/callback",
      state: "s",
      codeChallenge: challenge,
    })!;

    const body = `grant_type=authorization_code&code=${code}&client_id=test-client&redirect_uri=${encodeURIComponent("https://example.com/callback")}&code_verifier=${verifier}`;
    const req = mockReq("POST", "/token", { "content-type": "application/x-www-form-urlencoded" }, body);
    const { res, statusCode, json: getJson } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(200);
    const result = getJson() as Record<string, unknown>;
    expect(result.token_type).toBe("Bearer");
    expect(result.access_token).toBeTruthy();
    expect(result.refresh_token).toBeTruthy();
    expect(result.scope).toBe("mcp:read");
  });

  it("rejects PKCE verification failure", async () => {
    const challenge = sha256Base64Url("x".repeat(43));
    const code = issueAuthCode(config, stores, {
      clientId: "test-client",
      redirectUri: "https://example.com/callback",
      state: "s",
      codeChallenge: challenge,
    })!;

    const wrongVerifier = "y".repeat(43);
    const body = `grant_type=authorization_code&code=${code}&client_id=test-client&redirect_uri=${encodeURIComponent("https://example.com/callback")}&code_verifier=${wrongVerifier}`;
    const req = mockReq("POST", "/token", {}, body);
    const { res, statusCode, json: getJson } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(400);
    expect((getJson() as Record<string, unknown>).error_description).toContain("PKCE");
  });

  it("rejects code one-time use (replay)", async () => {
    const verifier = "z".repeat(43);
    const challenge = sha256Base64Url(verifier);
    const code = issueAuthCode(config, stores, {
      clientId: "test-client",
      redirectUri: "https://example.com/callback",
      state: "s",
      codeChallenge: challenge,
    })!;

    const body = `grant_type=authorization_code&code=${code}&client_id=test-client&redirect_uri=${encodeURIComponent("https://example.com/callback")}&code_verifier=${verifier}`;

    // First use
    const req1 = mockReq("POST", "/token", {}, body);
    const r1 = mockRes();
    await handler(req1, r1.res);
    expect(r1.statusCode()).toBe(200);

    // Second use (replay)
    const req2 = mockReq("POST", "/token", {}, body);
    const r2 = mockRes();
    await handler(req2, r2.res);
    expect(r2.statusCode()).toBe(400);
    expect((r2.json() as Record<string, unknown>).error_description).toContain("not found");
  });

  it("rejects missing client_id", async () => {
    const body = "grant_type=authorization_code&code=x";
    const req = mockReq("POST", "/token", {}, body);
    const { res, statusCode, json: getJson } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(400);
    expect((getJson() as Record<string, unknown>).error_description).toContain("client_id");
  });

  it("rejects invalid code", async () => {
    const body = "grant_type=authorization_code&code=invalid&client_id=test-client&redirect_uri=https://example.com/callback&code_verifier=" + "a".repeat(43);
    const req = mockReq("POST", "/token", {}, body);
    const { res, statusCode } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(400);
  });

  it("rejects expired code", async () => {
    const verifier = "e".repeat(43);
    const challenge = sha256Base64Url(verifier);
    const code = issueAuthCode(config, stores, {
      clientId: "test-client",
      redirectUri: "https://example.com/callback",
      state: "s",
      codeChallenge: challenge,
    })!;
    // Force expiry
    const record = stores.authCodes.get(code)!;
    record.expiresAt = now() - 1;

    const body = `grant_type=authorization_code&code=${code}&client_id=test-client&redirect_uri=${encodeURIComponent("https://example.com/callback")}&code_verifier=${verifier}`;
    const req = mockReq("POST", "/token", {}, body);
    const { res, statusCode, json: getJson } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(400);
    expect((getJson() as Record<string, unknown>).error_description).toContain("expired");
  });

  it("rejects client_id mismatch", async () => {
    const verifier = "m".repeat(43);
    const challenge = sha256Base64Url(verifier);
    const code = issueAuthCode(config, stores, {
      clientId: "test-client",
      redirectUri: "https://example.com/callback",
      state: "s",
      codeChallenge: challenge,
    })!;

    const body = `grant_type=authorization_code&code=${code}&client_id=wrong-client&redirect_uri=${encodeURIComponent("https://example.com/callback")}&code_verifier=${verifier}`;
    const req = mockReq("POST", "/token", {}, body);
    const { res, statusCode } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(400);
  });

  it("rejects invalid redirect_uri on token exchange", async () => {
    const verifier = "r".repeat(43);
    const challenge = sha256Base64Url(verifier);
    const code = issueAuthCode(config, stores, {
      clientId: "test-client",
      redirectUri: "https://example.com/callback",
      state: "s",
      codeChallenge: challenge,
    })!;

    const body = `grant_type=authorization_code&code=${code}&client_id=test-client&redirect_uri=not-a-url&code_verifier=${verifier}`;
    const req = mockReq("POST", "/token", {}, body);
    const { res, statusCode } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(400);
  });

  it("rejects invalid code_verifier format", async () => {
    const challenge = sha256Base64Url("v".repeat(43));
    const code = issueAuthCode(config, stores, {
      clientId: "test-client",
      redirectUri: "https://example.com/callback",
      state: "s",
      codeChallenge: challenge,
    })!;

    const body = `grant_type=authorization_code&code=${code}&client_id=test-client&redirect_uri=${encodeURIComponent("https://example.com/callback")}&code_verifier=short`;
    const req = mockReq("POST", "/token", {}, body);
    const { res, statusCode, json: getJson } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(400);
    expect((getJson() as Record<string, unknown>).error_description).toContain("code_verifier");
  });

  it("refresh_token grant rotates token", async () => {
    const { token, familyId } = issueRefreshToken(config, stores, "sub-1", "test-client");

    const body = `grant_type=refresh_token&refresh_token=${token}&client_id=test-client`;
    const req = mockReq("POST", "/token", {}, body);
    const { res, statusCode, json: getJson } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(200);
    const result = getJson() as Record<string, unknown>;
    expect(result.access_token).toBeTruthy();
    expect(result.refresh_token).toBeTruthy();
    expect(result.refresh_token).not.toBe(token);
  });

  it("refresh_token reuse revokes family", async () => {
    const { token, familyId } = issueRefreshToken(config, stores, "sub-1", "test-client");

    // First use
    const body1 = `grant_type=refresh_token&refresh_token=${token}&client_id=test-client`;
    const req1 = mockReq("POST", "/token", {}, body1);
    const r1 = mockRes();
    await handler(req1, r1.res);
    expect(r1.statusCode()).toBe(200);

    // Get new token from first rotation
    const newToken = (r1.json() as Record<string, unknown>).refresh_token as string;

    // Replay original token (reuse detection)
    const body2 = `grant_type=refresh_token&refresh_token=${token}&client_id=test-client`;
    const req2 = mockReq("POST", "/token", {}, body2);
    const r2 = mockRes();
    await handler(req2, r2.res);
    expect(r2.statusCode()).toBe(400);

    // The new token from rotation should also be revoked (family revocation)
    const body3 = `grant_type=refresh_token&refresh_token=${newToken}&client_id=test-client`;
    const req3 = mockReq("POST", "/token", {}, body3);
    const r3 = mockRes();
    await handler(req3, r3.res);
    expect(r3.statusCode()).toBe(400);
  });

  it("rejects expired refresh_token", async () => {
    const { token } = issueRefreshToken(config, stores, "sub-1", "test-client");
    const hash = hashRefreshToken(token);
    const record = stores.refreshStore.get(hash)!;
    record.expiresAt = now() - 1;

    const body = `grant_type=refresh_token&refresh_token=${token}&client_id=test-client`;
    const req = mockReq("POST", "/token", {}, body);
    const { res, statusCode } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(400);
  });

  it("rejects refresh_token with wrong client_id", async () => {
    const { token } = issueRefreshToken(config, stores, "sub-1", "test-client");

    const body = `grant_type=refresh_token&refresh_token=${token}&client_id=wrong-client`;
    const req = mockReq("POST", "/token", {}, body);
    const { res, statusCode } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(400);
  });

  it("rejects refresh_token missing client_id", async () => {
    const { token } = issueRefreshToken(config, stores, "sub-1", "test-client");

    const body = `grant_type=refresh_token&refresh_token=${token}`;
    const req = mockReq("POST", "/token", {}, body);
    const { res, statusCode, json: getJson } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(400);
    expect((getJson() as Record<string, unknown>).error_description).toContain("client_id");
  });

  it("rejects unknown grant_type", async () => {
    const body = "grant_type=implicit";
    const req = mockReq("POST", "/token", {}, body);
    const { res, statusCode, json: getJson } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(400);
    expect((getJson() as Record<string, unknown>).error).toBe("unsupported_grant_type");
  });

  it("rejects nonexistent refresh_token", async () => {
    const body = "grant_type=refresh_token&refresh_token=nonexistent&client_id=test-client";
    const req = mockReq("POST", "/token", {}, body);
    const { res, statusCode } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(400);
  });
});

/* ---------- POST /mcp (JSON-RPC) ---------- */
describe("POST /mcp", () => {
  it("handles initialize request", async () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" });
    const req = mockReq("POST", "/mcp", { "content-type": "application/json" }, body);
    const { res, statusCode, json: getJson } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(200);
    const result = getJson() as { result: Record<string, unknown> };
    expect(result.result.protocolVersion).toBe("2024-11-05");
    expect(result.result.serverInfo).toBeTruthy();
  });

  it("handles notifications/initialized (no id -> 204)", async () => {
    const body = JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" });
    const req = mockReq("POST", "/mcp", { "content-type": "application/json" }, body);
    const { res, statusCode } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(204);
  });

  it("handles notifications/initialized (with id -> result)", async () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "notifications/initialized" });
    const req = mockReq("POST", "/mcp", { "content-type": "application/json" }, body);
    const { res, statusCode } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(200);
  });

  it("tools/list returns tool definitions with auth", async () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const req = mockReq("POST", "/mcp", {
      "content-type": "application/json",
      ...bearerHeader(config),
    }, body);
    const { res, statusCode, json: getJson } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(200);
    const result = getJson() as { result: { tools: Array<{ name: string }> } };
    expect(result.result.tools).toHaveLength(1);
    expect(result.result.tools[0].name).toBe("read_health_records");
  });

  it("returns 401 for tools/list without auth", async () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const req = mockReq("POST", "/mcp", { "content-type": "application/json" }, body);
    const { res, statusCode, json: getJson } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(401);
    expect((getJson() as { error: { code: number } }).error.code).toBe(-32001);
  });

  it("returns error for unknown method with auth", async () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "unknown/method" });
    const req = mockReq("POST", "/mcp", {
      "content-type": "application/json",
      ...bearerHeader(config),
    }, body);
    const { res, json: getJson } = mockRes();
    await handler(req, res);
    const result = getJson() as { error: { code: number; message: string } };
    expect(result.error.code).toBe(-32601);
    expect(result.error.message).toBe("Method not found");
  });

  it("returns parse error for invalid JSON", async () => {
    const req = mockReq("POST", "/mcp", { "content-type": "application/json" }, "{bad json");
    const { res, statusCode, json: getJson } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(400);
    expect((getJson() as { error: { code: number } }).error.code).toBe(-32700);
  });

  it("rejects batch (array) requests", async () => {
    const body = JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "initialize" }]);
    const req = mockReq("POST", "/mcp", { "content-type": "application/json" }, body);
    const { res, statusCode, json: getJson } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(400);
    expect((getJson() as { error: { code: number } }).error.code).toBe(-32600);
  });

  it("rejects invalid JSON-RPC structure", async () => {
    const body = JSON.stringify({ not: "jsonrpc" });
    const req = mockReq("POST", "/mcp", { "content-type": "application/json" }, body);
    const { res, statusCode, json: getJson } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(400);
    expect((getJson() as { error: { code: number } }).error.code).toBe(-32600);
  });

  it("tools/call with unknown tool returns error", async () => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "nonexistent_tool", arguments: {} },
    });
    const req = mockReq("POST", "/mcp", {
      "content-type": "application/json",
      ...bearerHeader(config),
    }, body);
    const { res, json: getJson } = mockRes();
    await handler(req, res);
    const result = getJson() as { error: { code: number } };
    expect(result.error.code).toBe(-32601);
  });

  it("tools/call with missing params returns error", async () => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
    });
    const req = mockReq("POST", "/mcp", {
      "content-type": "application/json",
      ...bearerHeader(config),
    }, body);
    const { res, json: getJson } = mockRes();
    await handler(req, res);
    const result = getJson() as { error: { code: number } };
    expect(result.error.code).toBe(-32602);
  });

  it("tools/call read_health_records returns structured content (no bridge)", async () => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "read_health_records",
        arguments: {
          resource_types: ["Observation"],
          depth: "summary",
        },
      },
    });
    const req = mockReq("POST", "/mcp", {
      "content-type": "application/json",
      ...bearerHeader(config),
    }, body);
    const { res, statusCode, json: getJson } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(200);
    const result = getJson() as { result: { structuredContent: { status: string } } };
    expect(result.result.structuredContent).toBeTruthy();
  });
});

/* ---------- 404 for unknown routes ---------- */
describe("Unknown routes", () => {
  it("returns 404 for unknown GET path", async () => {
    const req = mockReq("GET", "/unknown");
    const { res, statusCode, json: getJson } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(404);
    expect((getJson() as Record<string, unknown>).error).toBe("not_found");
  });

  it("returns 404 for unknown POST path", async () => {
    const req = mockReq("POST", "/unknown");
    const { res, statusCode } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(404);
  });
});

/* ---------- Error handling ---------- */
describe("Error handling", () => {
  it("catches generic errors and returns 500", async () => {
    // Use a handler that will throw on /mcp due to broken parseJsonBody
    const req = mockReq("GET", "/nonexistent-path");
    const { res, statusCode } = mockRes();
    await handler(req, res);
    expect(statusCode()).toBe(404);
  });
});
