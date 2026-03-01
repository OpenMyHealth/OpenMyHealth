import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import type http from "node:http";
import type { Socket } from "node:net";
import type { RelayConfig } from "./config.js";
import {
  escapeHtml,
  parseCookies,
  parseFormBody,
  parseJsonBody,
  requestFingerprint,
  json,
  html,
  safeStringEqual,
  redirect,
  unauthorized,
  invalidGrant,
  notFound,
  jsonRpcResult,
  jsonRpcError,
  consentCookie,
  clearConsentCookie,
  signConsentToken,
  sha256Base64Url,
  randomToken,
  now,
  base64UrlJson,
  RequestBodyTooLargeError,
} from "./http-helpers.js";

/* ---------- helpers ---------- */

function mockReq(
  headers: Record<string, string | undefined> = {},
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
    headers: { ...headers },
    socket: { remoteAddress: socketOpts.remoteAddress ?? "127.0.0.1" } as Socket,
  });
  return readable as unknown as http.IncomingMessage;
}

function mockRes(): {
  res: http.ServerResponse;
  statusCode: () => number;
  headers: () => Record<string, string>;
  body: () => string;
} {
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
    },
  } as unknown as http.ServerResponse;

  return {
    res,
    statusCode: () => _status,
    headers: () => _headers,
    body: () => _body,
  };
}

function testConfig(overrides: Partial<RelayConfig> = {}): RelayConfig {
  return {
    PORT: 8787,
    HOST: "127.0.0.1",
    ISSUER: "test-issuer",
    BRIDGE_AUTH_TOKEN: "",
    JWT_SECRET: "x".repeat(32),
    PUBLIC_ORIGIN: "http://127.0.0.1:8787",
    SECURE_COOKIE: false,
    BRIDGE_URL: "",
    clientRedirects: new Map(),
    PKCE_S256_PATTERN: /^[A-Za-z0-9_-]{43,128}$/,
    PKCE_VERIFIER_PATTERN: /^[A-Za-z0-9._~-]{43,128}$/,
    CONSENT_COOKIE_NAME: "omh_consent_nonce",
    MAX_AUTH_CODES: 1000,
    MAX_PENDING_AUTHS: 1000,
    MAX_REFRESH_TOKENS: 5000,
    ACCESS_TOKEN_TTL_SECONDS: 3600,
    ...overrides,
  };
}

/* ---------- escapeHtml ---------- */
describe("escapeHtml", () => {
  it("escapes & to &amp;", () => {
    expect(escapeHtml("a&b")).toBe("a&amp;b");
  });

  it("escapes < and >", () => {
    expect(escapeHtml("<div>")).toBe("&lt;div&gt;");
  });

  it("escapes double quotes", () => {
    expect(escapeHtml('"hello"')).toBe("&quot;hello&quot;");
  });

  it("escapes single quotes", () => {
    expect(escapeHtml("it's")).toBe("it&#39;s");
  });

  it("escapes all special characters together", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;",
    );
  });
});

/* ---------- parseCookies ---------- */
describe("parseCookies", () => {
  it("parses name=value pairs", () => {
    const req = mockReq({ cookie: "a=1; b=2" });
    expect(parseCookies(req)).toEqual({ a: "1", b: "2" });
  });

  it("handles URL-encoded values", () => {
    const req = mockReq({ cookie: "name=%E4%BA%BA" });
    expect(parseCookies(req)).toEqual({ name: "人" });
  });

  it("returns empty object when no cookie header", () => {
    const req = mockReq({});
    expect(parseCookies(req)).toEqual({});
  });

  it("handles cookies with = in value", () => {
    const req = mockReq({ cookie: "token=abc=def" });
    expect(parseCookies(req)).toEqual({ token: "abc=def" });
  });
});

/* ---------- parseFormBody ---------- */
describe("parseFormBody", () => {
  it("parses URL-encoded form body", async () => {
    const req = mockReq({}, "grant_type=authorization_code&code=abc123");
    const result = await parseFormBody(req);
    expect(result).toEqual({
      grant_type: "authorization_code",
      code: "abc123",
    });
  });

  it("returns empty object for empty body", async () => {
    const req = mockReq({}, "");
    const result = await parseFormBody(req);
    expect(result).toEqual({});
  });
});

/* ---------- parseJsonBody ---------- */
describe("parseJsonBody", () => {
  it("parses JSON body", async () => {
    const req = mockReq({}, '{"method":"initialize"}');
    const result = await parseJsonBody(req);
    expect(result).toEqual({ method: "initialize" });
  });

  it("returns empty object for empty body", async () => {
    const req = mockReq({}, "");
    const result = await parseJsonBody(req);
    expect(result).toEqual({});
  });

  it("throws on invalid JSON", async () => {
    const req = mockReq({}, "not-json{");
    await expect(parseJsonBody(req)).rejects.toThrow();
  });
});

/* ---------- requestFingerprint ---------- */
describe("requestFingerprint", () => {
  it("produces deterministic hash from IP + User-Agent", () => {
    const req1 = mockReq({ "user-agent": "TestBot/1.0" }, "", { remoteAddress: "10.0.0.1" });
    const req2 = mockReq({ "user-agent": "TestBot/1.0" }, "", { remoteAddress: "10.0.0.1" });
    expect(requestFingerprint(req1)).toBe(requestFingerprint(req2));
  });

  it("differs for different IPs", () => {
    const req1 = mockReq({ "user-agent": "Bot" }, "", { remoteAddress: "10.0.0.1" });
    const req2 = mockReq({ "user-agent": "Bot" }, "", { remoteAddress: "10.0.0.2" });
    expect(requestFingerprint(req1)).not.toBe(requestFingerprint(req2));
  });

  it("differs for different User-Agents", () => {
    const req1 = mockReq({ "user-agent": "Bot/1" }, "", { remoteAddress: "10.0.0.1" });
    const req2 = mockReq({ "user-agent": "Bot/2" }, "", { remoteAddress: "10.0.0.1" });
    expect(requestFingerprint(req1)).not.toBe(requestFingerprint(req2));
  });
});

/* ---------- json ---------- */
describe("json()", () => {
  it("sets Content-Type and Cache-Control headers", () => {
    const { res, headers, statusCode } = mockRes();
    json(res, 200, { ok: true });
    expect(statusCode()).toBe(200);
    expect(headers()["Content-Type"]).toBe("application/json");
    expect(headers()["Cache-Control"]).toBe("no-store");
  });

  it("serializes payload as JSON body", () => {
    const { res, body } = mockRes();
    json(res, 200, { key: "value" });
    expect(JSON.parse(body())).toEqual({ key: "value" });
  });

  it("merges additional headers", () => {
    const { res, headers } = mockRes();
    json(res, 200, {}, { "X-Custom": "yes" });
    expect(headers()["X-Custom"]).toBe("yes");
  });
});

/* ---------- html ---------- */
describe("html()", () => {
  it("sets Content-Type to text/html", () => {
    const { res, headers } = mockRes();
    html(res, 200, "<p>hi</p>");
    expect(headers()["Content-Type"]).toBe("text/html; charset=utf-8");
  });

  it("sets X-Frame-Options DENY", () => {
    const { res, headers } = mockRes();
    html(res, 200, "<p>hi</p>");
    expect(headers()["X-Frame-Options"]).toBe("DENY");
  });

  it("sets Content-Security-Policy", () => {
    const { res, headers } = mockRes();
    html(res, 200, "<p>hi</p>");
    expect(headers()["Content-Security-Policy"]).toContain("default-src 'none'");
  });

  it("sets X-Content-Type-Options nosniff", () => {
    const { res, headers } = mockRes();
    html(res, 200, "<p>hi</p>");
    expect(headers()["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("sets Referrer-Policy no-referrer", () => {
    const { res, headers } = mockRes();
    html(res, 200, "<p>hi</p>");
    expect(headers()["Referrer-Policy"]).toBe("no-referrer");
  });
});

/* ---------- safeStringEqual ---------- */
describe("safeStringEqual", () => {
  it("returns true for identical strings", () => {
    expect(safeStringEqual("hello", "hello")).toBe(true);
  });

  it("returns false for different strings of same length", () => {
    expect(safeStringEqual("hello", "world")).toBe(false);
  });

  it("returns false for strings of different length", () => {
    expect(safeStringEqual("short", "much longer string")).toBe(false);
  });
});

/* ---------- redirect ---------- */
describe("redirect()", () => {
  it("sets 302 status and Location header", () => {
    const { res, statusCode, headers } = mockRes();
    redirect(res, "https://example.com/cb");
    expect(statusCode()).toBe(302);
    expect(headers()["Location"]).toBe("https://example.com/cb");
    expect(headers()["Cache-Control"]).toBe("no-store");
  });
});

/* ---------- helper response functions ---------- */
describe("unauthorized()", () => {
  it("returns 401 with error JSON", () => {
    const { res, statusCode, body } = mockRes();
    unauthorized(res);
    expect(statusCode()).toBe(401);
    expect(JSON.parse(body())).toEqual({ error: "unauthorized" });
  });
});

describe("invalidGrant()", () => {
  it("returns 400 with default message", () => {
    const { res, statusCode, body } = mockRes();
    invalidGrant(res);
    expect(statusCode()).toBe(400);
    expect(JSON.parse(body()).error).toBe("invalid_grant");
  });

  it("uses custom message", () => {
    const { res, body } = mockRes();
    invalidGrant(res, "custom reason");
    expect(JSON.parse(body()).error_description).toBe("custom reason");
  });
});

describe("notFound()", () => {
  it("returns 404", () => {
    const { res, statusCode, body } = mockRes();
    notFound(res);
    expect(statusCode()).toBe(404);
    expect(JSON.parse(body()).error).toBe("not_found");
  });
});

/* ---------- jsonRpcResult / jsonRpcError ---------- */
describe("jsonRpcResult()", () => {
  it("returns proper JSON-RPC result envelope", () => {
    const { res, body } = mockRes();
    jsonRpcResult(res, 1, { data: "ok" });
    const parsed = JSON.parse(body());
    expect(parsed).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { data: "ok" },
    });
  });
});

describe("jsonRpcError()", () => {
  it("returns proper JSON-RPC error envelope", () => {
    const { res, body } = mockRes();
    jsonRpcError(res, 1, -32600, "Invalid Request");
    const parsed = JSON.parse(body());
    expect(parsed).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32600, message: "Invalid Request" },
    });
  });

  it("includes data when provided", () => {
    const { res, body } = mockRes();
    jsonRpcError(res, null, -32602, "Err", { detail: "x" });
    const parsed = JSON.parse(body());
    expect(parsed.error.data).toEqual({ detail: "x" });
  });
});

/* ---------- consentCookie / clearConsentCookie ---------- */
describe("consentCookie()", () => {
  it("builds cookie string without Secure for http", () => {
    const cfg = testConfig({ SECURE_COOKIE: false });
    const cookie = consentCookie(cfg, "nonce123", 300);
    expect(cookie).toContain("omh_consent_nonce=nonce123");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Max-Age=300");
    expect(cookie).not.toContain("Secure");
  });

  it("includes Secure for https", () => {
    const cfg = testConfig({ SECURE_COOKIE: true });
    const cookie = consentCookie(cfg, "n", 300);
    expect(cookie).toContain("; Secure");
  });
});

describe("clearConsentCookie()", () => {
  it("sets Max-Age=0", () => {
    const cfg = testConfig();
    const cookie = clearConsentCookie(cfg);
    expect(cookie).toContain("Max-Age=0");
  });
});

/* ---------- signConsentToken ---------- */
describe("signConsentToken()", () => {
  it("produces deterministic HMAC", () => {
    const cfg = testConfig();
    const a = signConsentToken(cfg, "req1", "nonce1");
    const b = signConsentToken(cfg, "req1", "nonce1");
    expect(a).toBe(b);
  });

  it("differs for different inputs", () => {
    const cfg = testConfig();
    const a = signConsentToken(cfg, "req1", "nonce1");
    const b = signConsentToken(cfg, "req2", "nonce1");
    expect(a).not.toBe(b);
  });
});

/* ---------- utility functions ---------- */
describe("sha256Base64Url()", () => {
  it("produces consistent hash", () => {
    expect(sha256Base64Url("test")).toBe(sha256Base64Url("test"));
  });

  it("produces base64url encoded output", () => {
    const result = sha256Base64Url("test");
    expect(result).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("randomToken()", () => {
  it("produces unique tokens", () => {
    expect(randomToken()).not.toBe(randomToken());
  });

  it("respects byte length param", () => {
    const short = randomToken(8);
    const long = randomToken(32);
    expect(short.length).toBeLessThan(long.length);
  });
});

describe("now()", () => {
  it("returns seconds not milliseconds", () => {
    const ts = now();
    expect(ts).toBeLessThan(1e11);
    expect(ts).toBeGreaterThan(1e9);
  });
});

describe("base64UrlJson()", () => {
  it("encodes object as base64url JSON", () => {
    const encoded = base64UrlJson({ a: 1 });
    const decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    expect(decoded).toEqual({ a: 1 });
  });
});

describe("RequestBodyTooLargeError", () => {
  it("has correct name", () => {
    const err = new RequestBodyTooLargeError();
    expect(err.name).toBe("RequestBodyTooLargeError");
    expect(err.message).toBe("Request body too large");
  });
});
