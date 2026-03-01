import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import { URL } from "node:url";
import {
  MAX_RECORDS_PER_RESPONSE,
  ReadHealthRecordsRequestSchema,
  ReadHealthRecordsResponseSchema,
  buildMcpErrorResponse,
  buildMcpTimeoutResponse,
  type McpDepth,
  type ReadHealthRecordsResponse,
} from "../../contracts/src/index.js";

type AuthCodeRecord = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  expiresAt: number;
  sub: string;
};

type PendingAuthorizationRecord = {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  nonce: string;
  requesterFingerprint: string;
  expiresAt: number;
};

type RefreshRecord = {
  sub: string;
  clientId: string;
  familyId: string;
  expiresAt: number;
  used: boolean;
};

type AuthorizeParams = {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
};

type JsonRpcId = string | number | null;
type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
};

const PORT = Number(process.env.RELAY_PORT ?? 8787);
const HOST = process.env.RELAY_HOST ?? "127.0.0.1";
const ALLOW_REMOTE_HOST = process.env.RELAY_ALLOW_REMOTE_HOST === "1";
const ISSUER = process.env.RELAY_ISSUER ?? "openmyhealth-relay";
const BRIDGE_AUTH_TOKEN = process.env.RELAY_BRIDGE_AUTH_TOKEN ?? "";

const PKCE_S256_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
const CONSENT_COOKIE_NAME = "omh_consent_nonce";

const rawSecret = process.env.RELAY_JWT_SECRET;
if (!rawSecret || rawSecret.length < 32) {
  throw new Error("RELAY_JWT_SECRET must be set and at least 32 characters long.");
}
const JWT_SECRET = rawSecret;

function normalizeRedirectUri(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("Only https redirect URIs are allowed");
  }
  if (url.username || url.password) {
    throw new Error("Redirect URI must not contain credentials");
  }
  url.hash = "";
  return url.toString();
}

function parseCsvList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseClientRedirects(): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const mapped = (process.env.RELAY_CLIENT_REDIRECTS ?? "").trim();

  if (mapped) {
    const pairs = mapped
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean);

    for (const pair of pairs) {
      const [clientIdRaw, redirectsRaw] = pair.split("=", 2);
      const clientId = (clientIdRaw ?? "").trim();
      if (!clientId || !redirectsRaw) {
        throw new Error(`Invalid RELAY_CLIENT_REDIRECTS segment: ${pair}`);
      }
      const redirects = redirectsRaw
        .split("|")
        .map((item) => item.trim())
        .filter(Boolean)
        .map((uri) => normalizeRedirectUri(uri));
      if (redirects.length === 0) {
        throw new Error(`No redirect URIs configured for client ${clientId}`);
      }
      map.set(clientId, new Set(redirects));
    }

    return map;
  }

  const clientIds = parseCsvList(process.env.RELAY_CLIENT_IDS ?? "openmyhealth-chatgpt,openmyhealth-claude");
  const allowlist = parseCsvList(process.env.RELAY_REDIRECT_ALLOWLIST ?? "https://chatgpt.com/,https://claude.ai/")
    .map((uri) => normalizeRedirectUri(uri));

  if (clientIds.length === 0) {
    throw new Error("At least one client_id must be configured.");
  }

  if (clientIds.length === 1) {
    map.set(clientIds[0], new Set(allowlist));
    return map;
  }

  if (allowlist.length === clientIds.length) {
    for (let i = 0; i < clientIds.length; i += 1) {
      map.set(clientIds[i], new Set([allowlist[i]]));
    }
    return map;
  }

  throw new Error(
    "Multiple client IDs configured. Provide RELAY_CLIENT_REDIRECTS or ensure RELAY_REDIRECT_ALLOWLIST count matches RELAY_CLIENT_IDS.",
  );
}

function normalizePublicOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("RELAY_PUBLIC_ORIGIN must be http or https origin");
  }
  return `${url.protocol}//${url.host}`;
}

function normalizeBridgeUrl(value: string): string {
  if (!value) {
    return "";
  }
  const url = new URL(value);
  const isLoopback = isLoopbackHost(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    throw new Error("RELAY_MCP_BRIDGE_URL must be https (or http on loopback only).");
  }
  return url.toString();
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

if (!ALLOW_REMOTE_HOST && !isLoopbackHost(HOST)) {
  throw new Error("RELAY_HOST must be loopback unless RELAY_ALLOW_REMOTE_HOST=1 is explicitly set.");
}

const clientRedirects = parseClientRedirects();
const PUBLIC_ORIGIN = normalizePublicOrigin(process.env.RELAY_PUBLIC_ORIGIN ?? `http://${HOST}:${PORT}`);
const SECURE_COOKIE = PUBLIC_ORIGIN.startsWith("https://");
const publicOriginHost = new URL(PUBLIC_ORIGIN).hostname;
const BRIDGE_URL = normalizeBridgeUrl(process.env.RELAY_MCP_BRIDGE_URL ?? "");

if (!isLoopbackHost(publicOriginHost) && !SECURE_COOKIE) {
  throw new Error("RELAY_PUBLIC_ORIGIN must use https for non-loopback hosts.");
}

if (BRIDGE_URL && !BRIDGE_AUTH_TOKEN) {
  throw new Error("RELAY_BRIDGE_AUTH_TOKEN is required when RELAY_MCP_BRIDGE_URL is set.");
}

const MAX_AUTH_CODES = 1000;
const MAX_PENDING_AUTHS = 1000;
const MAX_REFRESH_TOKENS = 5000;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

const authCodes = new Map<string, AuthCodeRecord>();
const pendingAuthorizations = new Map<string, PendingAuthorizationRecord>();
const refreshStore = new Map<string, RefreshRecord>();

class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body too large");
    this.name = "RequestBodyTooLargeError";
  }
}

function now() {
  return Math.floor(Date.now() / 1000);
}

function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function safeStringEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function parseCookies(req: http.IncomingMessage): Record<string, string> {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) {
    return {};
  }
  const entries = cookieHeader.split(";").map((part) => part.trim()).filter(Boolean);
  const cookies: Record<string, string> = {};
  for (const entry of entries) {
    const [key, ...rest] = entry.split("=");
    if (!key || rest.length === 0) {
      continue;
    }
    cookies[key] = decodeURIComponent(rest.join("="));
  }
  return cookies;
}

function requestFingerprint(req: http.IncomingMessage): string {
  const address = req.socket.remoteAddress ?? "unknown";
  const ua = String(req.headers["user-agent"] ?? "");
  return createHash("sha256").update(`${address}|${ua}`).digest("hex");
}

function json(
  res: http.ServerResponse,
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

function html(
  res: http.ServerResponse,
  status: number,
  body: string,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(body);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function redirect(res: http.ServerResponse, target: string, headers: Record<string, string> = {}): void {
  res.writeHead(302, {
    Location: target,
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end();
}

function parseBodyRaw(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    let done = false;
    req.on("data", (chunk) => {
      if (done) return;
      data += chunk.toString("utf8");
      if (data.length > 1_000_000) {
        done = true;
        reject(new RequestBodyTooLargeError());
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!done) resolve(data);
    });
    req.on("error", (err) => {
      if (!done) {
        done = true;
        reject(err);
      }
    });
  });
}

async function parseFormBody(req: http.IncomingMessage): Promise<Record<string, string>> {
  const raw = await parseBodyRaw(req);
  return Object.fromEntries(new URLSearchParams(raw).entries());
}

async function parseJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const raw = await parseBodyRaw(req);
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function isClientAllowed(clientId: string): boolean {
  return clientRedirects.has(clientId);
}

function isRedirectAllowed(clientId: string, redirectUri: string): boolean {
  let normalized: string;
  try {
    normalized = normalizeRedirectUri(redirectUri);
  } catch {
    return false;
  }

  const allowed = clientRedirects.get(clientId);
  if (!allowed) {
    return false;
  }

  return allowed.has(normalized);
}

function signJwt(payload: Record<string, unknown>): string {
  const header = {
    alg: "HS256",
    typ: "JWT",
    kid: "v1",
  };
  const encodedHeader = base64UrlJson(header);
  const encodedPayload = base64UrlJson(payload);
  const input = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", JWT_SECRET).update(input).digest("base64url");
  return `${input}.${signature}`;
}

function verifyJwt(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [header, payload, signature] = parts;
  const input = `${header}.${payload}`;
  const expectedBytes = createHmac("sha256", JWT_SECRET).update(input).digest();

  let providedBytes: Buffer;
  try {
    providedBytes = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }

  if (providedBytes.length !== expectedBytes.length) {
    return null;
  }

  if (!timingSafeEqual(providedBytes, expectedBytes)) {
    return null;
  }

  let decoded: Record<string, unknown>;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }

  const exp = typeof decoded.exp === "number" ? decoded.exp : 0;
  const nbf = typeof decoded.nbf === "number" ? decoded.nbf : 0;
  const iss = typeof decoded.iss === "string" ? decoded.iss : "";
  const aud = typeof decoded.aud === "string" ? decoded.aud : "";
  const scope = typeof decoded.scope === "string" ? decoded.scope : "";
  const sub = typeof decoded.sub === "string" ? decoded.sub : "";

  if (exp <= now()) {
    return null;
  }
  if (nbf > now()) {
    return null;
  }
  if (iss !== ISSUER) {
    return null;
  }
  if (!aud || !isClientAllowed(aud)) {
    return null;
  }
  if (!scope.split(" ").includes("mcp:read")) {
    return null;
  }
  if (!sub) {
    return null;
  }

  return decoded;
}

function issueAccessToken(sub: string, clientId: string, scope = "mcp:read") {
  const iat = now();
  return signJwt({
    iss: ISSUER,
    aud: clientId,
    sub,
    scope,
    iat,
    nbf: iat,
    exp: iat + ACCESS_TOKEN_TTL_SECONDS,
    jti: randomToken(16),
  });
}

function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function revokeRefreshFamily(familyId: string): void {
  for (const [key, record] of refreshStore.entries()) {
    if (record.familyId === familyId) {
      refreshStore.delete(key);
    }
  }
}

function issueRefreshToken(sub: string, clientId: string, familyId?: string): { token: string; familyId: string } {
  if (refreshStore.size >= MAX_REFRESH_TOKENS) {
    cleanupExpiredTokens();
  }
  while (refreshStore.size >= MAX_REFRESH_TOKENS) {
    const oldest = refreshStore.keys().next();
    if (oldest.done) {
      break;
    }
    refreshStore.delete(oldest.value);
  }

  const tokenFamilyId = familyId ?? randomToken(12);
  const raw = randomToken(48);
  refreshStore.set(hashRefreshToken(raw), {
    sub,
    clientId,
    familyId: tokenFamilyId,
    expiresAt: now() + 30 * 24 * 60 * 60,
    used: false,
  });

  return { token: raw, familyId: tokenFamilyId };
}

function sendTokenResponse(
  res: http.ServerResponse,
  sub: string,
  clientId: string,
  refreshFamilyId?: string,
): void {
  const accessToken = issueAccessToken(sub, clientId);
  const refresh = issueRefreshToken(sub, clientId, refreshFamilyId);
  json(res, 200, {
    token_type: "Bearer",
    access_token: accessToken,
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refresh.token,
    refresh_expires_in: 30 * 24 * 60 * 60,
    scope: "mcp:read",
  });
}

function unauthorized(res: http.ServerResponse): void {
  json(res, 401, { error: "unauthorized" });
}

function invalidGrant(res: http.ServerResponse, message = "invalid_grant"): void {
  json(res, 400, { error: "invalid_grant", error_description: message });
}

function notFound(res: http.ServerResponse): void {
  json(res, 404, { error: "not_found" });
}

function jsonRpcResult(res: http.ServerResponse, id: JsonRpcId, result: unknown, status = 200): void {
  json(res, status, {
    jsonrpc: "2.0",
    id,
    result,
  });
}

function jsonRpcError(
  res: http.ServerResponse,
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
  status = 200,
): void {
  json(res, status, {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  });
}

function openSseStream(req: http.IncomingMessage, res: http.ServerResponse): void {
  const heartbeatMs = 15_000;
  const streamId = randomToken(8);
  let heartbeat: NodeJS.Timeout | null = null;
  let closed = false;

  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    if (!res.writableEnded) {
      res.end();
    }
  };

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`event: ready\nid: ${streamId}:0\ndata: {"transport":"sse","endpoint":"/mcp"}\n\n`);

  heartbeat = setInterval(() => {
    if (res.writableEnded) {
      close();
      return;
    }
    res.write(`: keepalive ${Date.now()}\n\n`);
  }, heartbeatMs);
  heartbeat.unref();

  req.on("close", close);
  req.on("aborted", close);
  res.on("close", close);
}

function consentCookie(value: string, maxAge: number): string {
  const secure = SECURE_COOKIE ? "; Secure" : "";
  return `${CONSENT_COOKIE_NAME}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/authorize; Max-Age=${maxAge}${secure}`;
}

function clearConsentCookie(): string {
  const secure = SECURE_COOKIE ? "; Secure" : "";
  return `${CONSENT_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/authorize; Max-Age=0${secure}`;
}

function signConsentToken(requestId: string, nonce: string): string {
  return createHmac("sha256", JWT_SECRET).update(`${requestId}.${nonce}`).digest("base64url");
}

function parseAuthorizeParams(url: URL): AuthorizeParams | null {
  const clientId = url.searchParams.get("client_id") ?? "";
  const redirectUriRaw = url.searchParams.get("redirect_uri") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const responseType = url.searchParams.get("response_type") ?? "";
  const codeChallenge = url.searchParams.get("code_challenge") ?? "";
  const challengeMethod = url.searchParams.get("code_challenge_method") ?? "";

  if (!clientId || responseType !== "code") {
    return null;
  }
  if (!state) {
    return null;
  }
  if (challengeMethod !== "S256" || !PKCE_S256_PATTERN.test(codeChallenge)) {
    return null;
  }
  if (!isClientAllowed(clientId) || !isRedirectAllowed(clientId, redirectUriRaw)) {
    return null;
  }

  return {
    clientId,
    redirectUri: normalizeRedirectUri(redirectUriRaw),
    state,
    codeChallenge,
  };
}

function issueAuthCode(params: AuthorizeParams): string | null {
  if (authCodes.size >= MAX_AUTH_CODES) {
    cleanupExpiredTokens();
    if (authCodes.size >= MAX_AUTH_CODES) {
      return null;
    }
  }

  const code = randomToken(24);
  authCodes.set(code, {
    clientId: params.clientId,
    redirectUri: params.redirectUri,
    codeChallenge: params.codeChallenge,
    state: params.state,
    expiresAt: now() + 5 * 60,
    sub: `omh-${randomToken(12)}`,
  });
  return code;
}

function renderConsentPage(pendingId: string, csrfToken: string, params: AuthorizeParams): string {
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenMyHealth Authorization</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 24px; color: #111827; }
      .card { max-width: 560px; margin: 0 auto; border: 1px solid #d1d5db; border-radius: 12px; padding: 20px; }
      h1 { font-size: 20px; margin: 0 0 8px; }
      p { margin: 0 0 16px; line-height: 1.5; }
      .actions { display: flex; gap: 10px; }
      .btn { display: inline-block; padding: 10px 14px; border-radius: 8px; text-decoration: none; font-weight: 600; border: 0; cursor: pointer; }
      .btn-primary { background: #065f46; color: #fff; }
      .btn-secondary { background: #fff; color: #374151; border: 1px solid #d1d5db; }
      .meta { margin-top: 12px; font-size: 13px; color: #6b7280; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>연결 승인</h1>
      <p>요청 클라이언트가 OpenMyHealth 데이터 읽기 권한을 요청합니다. 승인하면 1시간 액세스 토큰이 발급됩니다.</p>
      <form method="post" action="/authorize/confirm">
        <input type="hidden" name="request_id" value="${escapeHtml(pendingId)}" />
        <input type="hidden" name="csrf_token" value="${escapeHtml(csrfToken)}" />
        <div class="actions">
          <button class="btn btn-primary" type="submit" name="decision" value="approve">승인하고 계속</button>
          <button class="btn btn-secondary" type="submit" name="decision" value="deny">거절</button>
        </div>
      </form>
      <div class="meta">client_id: ${escapeHtml(params.clientId)}</div>
    </div>
  </body>
</html>`;
}

function buildDenyRedirect(record: PendingAuthorizationRecord): string {
  const deny = new URL(record.redirectUri);
  deny.searchParams.set("error", "access_denied");
  deny.searchParams.set("error_description", "User denied authorization");
  deny.searchParams.set("state", record.state);
  return deny.toString();
}

function handleAuthorize(req: http.IncomingMessage, url: URL, res: http.ServerResponse): void {
  const params = parseAuthorizeParams(url);
  if (!params) {
    json(res, 400, { error: "invalid_request" });
    return;
  }

  if (pendingAuthorizations.size >= MAX_PENDING_AUTHS) {
    cleanupExpiredTokens();
    if (pendingAuthorizations.size >= MAX_PENDING_AUTHS) {
      json(res, 429, { error: "too_many_requests" });
      return;
    }
  }

  const pendingId = randomToken(16);
  const nonce = randomToken(16);
  const csrfToken = signConsentToken(pendingId, nonce);

  pendingAuthorizations.set(pendingId, {
    ...params,
    nonce,
    requesterFingerprint: requestFingerprint(req),
    expiresAt: now() + 5 * 60,
  });

  html(res, 200, renderConsentPage(pendingId, csrfToken, params), {
    "Set-Cookie": consentCookie(nonce, 300),
  });
}

async function handleAuthorizeConfirm(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await parseFormBody(req);
  const requestId = body.request_id ?? "";
  const decision = body.decision ?? "deny";
  const csrfToken = body.csrf_token ?? "";

  const pending = pendingAuthorizations.get(requestId);
  if (!pending) {
    json(res, 400, { error: "invalid_request", error_description: "unknown authorization request" });
    return;
  }

  if (pending.expiresAt <= now()) {
    pendingAuthorizations.delete(requestId);
    json(res, 400, { error: "invalid_request", error_description: "authorization request expired" });
    return;
  }

  const origin = req.headers.origin ?? "";
  if (!origin || origin !== PUBLIC_ORIGIN) {
    pendingAuthorizations.delete(requestId);
    json(res, 400, { error: "invalid_request", error_description: "origin mismatch" }, { "Set-Cookie": clearConsentCookie() });
    return;
  }

  const referer = req.headers.referer ?? "";
  let refererUrl: URL;
  try {
    refererUrl = new URL(referer);
  } catch {
    pendingAuthorizations.delete(requestId);
    json(res, 400, { error: "invalid_request", error_description: "referer mismatch" }, { "Set-Cookie": clearConsentCookie() });
    return;
  }
  if (refererUrl.origin !== PUBLIC_ORIGIN || refererUrl.pathname !== "/authorize") {
    pendingAuthorizations.delete(requestId);
    json(res, 400, { error: "invalid_request", error_description: "referer mismatch" }, { "Set-Cookie": clearConsentCookie() });
    return;
  }

  const fetchSite = req.headers["sec-fetch-site"];
  if (typeof fetchSite !== "string" || (fetchSite !== "same-origin" && fetchSite !== "none")) {
    pendingAuthorizations.delete(requestId);
    json(res, 400, { error: "invalid_request", error_description: "origin mismatch" }, { "Set-Cookie": clearConsentCookie() });
    return;
  }

  const fetchMode = req.headers["sec-fetch-mode"];
  if (typeof fetchMode === "string" && fetchMode !== "navigate") {
    pendingAuthorizations.delete(requestId);
    json(res, 400, { error: "invalid_request", error_description: "invalid fetch mode" }, { "Set-Cookie": clearConsentCookie() });
    return;
  }

  const fetchDest = req.headers["sec-fetch-dest"];
  if (typeof fetchDest === "string" && fetchDest !== "document") {
    pendingAuthorizations.delete(requestId);
    json(res, 400, { error: "invalid_request", error_description: "invalid fetch destination" }, { "Set-Cookie": clearConsentCookie() });
    return;
  }

  const cookies = parseCookies(req);
  const nonce = cookies[CONSENT_COOKIE_NAME] ?? "";
  if (!nonce || !safeStringEqual(nonce, pending.nonce)) {
    pendingAuthorizations.delete(requestId);
    json(res, 400, { error: "invalid_request", error_description: "invalid consent session" }, { "Set-Cookie": clearConsentCookie() });
    return;
  }

  const expectedCsrf = signConsentToken(requestId, nonce);
  if (!csrfToken || !safeStringEqual(csrfToken, expectedCsrf)) {
    pendingAuthorizations.delete(requestId);
    json(res, 400, { error: "invalid_request", error_description: "csrf validation failed" }, { "Set-Cookie": clearConsentCookie() });
    return;
  }

  if (!safeStringEqual(pending.requesterFingerprint, requestFingerprint(req))) {
    pendingAuthorizations.delete(requestId);
    json(
      res,
      400,
      { error: "invalid_request", error_description: "authorization request context mismatch" },
      { "Set-Cookie": clearConsentCookie() },
    );
    return;
  }

  pendingAuthorizations.delete(requestId);

  if (decision !== "approve") {
    redirect(res, buildDenyRedirect(pending), { "Set-Cookie": clearConsentCookie() });
    return;
  }

  const code = issueAuthCode({
    clientId: pending.clientId,
    redirectUri: pending.redirectUri,
    state: pending.state,
    codeChallenge: pending.codeChallenge,
  });

  if (!code) {
    json(res, 429, { error: "too_many_requests" }, { "Set-Cookie": clearConsentCookie() });
    return;
  }

  const callback = new URL(pending.redirectUri);
  callback.searchParams.set("code", code);
  callback.searchParams.set("state", pending.state);
  redirect(res, callback.toString(), { "Set-Cookie": clearConsentCookie() });
}

async function handleToken(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await parseFormBody(req);
  const grantType = body.grant_type;

  if (grantType === "authorization_code") {
    const code = body.code ?? "";
    const clientId = body.client_id ?? "";
    const redirectUri = body.redirect_uri ?? "";
    const codeVerifier = body.code_verifier ?? "";

    if (!clientId) {
      invalidGrant(res, "client_id is required");
      return;
    }

    const record = authCodes.get(code);
    if (!record) {
      invalidGrant(res, "authorization code not found");
      return;
    }

    authCodes.delete(code);

    if (record.expiresAt < now()) {
      invalidGrant(res, "authorization code expired");
      return;
    }

    let normalizedRedirect: string;
    try {
      normalizedRedirect = normalizeRedirectUri(redirectUri);
    } catch {
      invalidGrant(res, "invalid redirect_uri");
      return;
    }

    if (record.clientId !== clientId || record.redirectUri !== normalizedRedirect) {
      invalidGrant(res, "authorization code mismatch");
      return;
    }
    if (!PKCE_VERIFIER_PATTERN.test(codeVerifier)) {
      invalidGrant(res, "invalid code_verifier");
      return;
    }
    if (sha256Base64Url(codeVerifier) !== record.codeChallenge) {
      invalidGrant(res, "PKCE verification failed");
      return;
    }

    sendTokenResponse(res, record.sub, record.clientId);
    return;
  }

  if (grantType === "refresh_token") {
    const refreshToken = body.refresh_token ?? "";
    const requestedClientId = body.client_id ?? "";

    if (!requestedClientId) {
      invalidGrant(res, "client_id is required");
      return;
    }

    const hash = hashRefreshToken(refreshToken);
    const current = refreshStore.get(hash);

    if (!current) {
      invalidGrant(res, "refresh token not found");
      return;
    }

    if (current.clientId !== requestedClientId) {
      invalidGrant(res, "client mismatch");
      return;
    }

    if (current.used || current.expiresAt <= now()) {
      revokeRefreshFamily(current.familyId);
      invalidGrant(res, "refresh token expired or reused");
      return;
    }

    current.used = true;
    refreshStore.set(hash, current);

    sendTokenResponse(res, current.sub, current.clientId, current.familyId);
    return;
  }

  json(res, 400, { error: "unsupported_grant_type" });
}

async function forwardToBridge(
  payload: unknown,
  depth: McpDepth,
  claims: { sub: string; aud: string },
): Promise<ReadHealthRecordsResponse | null> {
  if (!BRIDGE_URL) {
    return null;
  }

  try {
    const response = await fetch(BRIDGE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${BRIDGE_AUTH_TOKEN}`,
        "X-OMH-Sub": claims.sub,
        "X-OMH-Aud": claims.aud,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(55_000),
    });

    if (!response.ok) {
      return null;
    }

    const bridgePayload = await response.json();
    const parsed = ReadHealthRecordsResponseSchema.safeParse(bridgePayload);
    if (!parsed.success) {
      return null;
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return buildMcpTimeoutResponse(depth);
    }
    return null;
  }
}

function getBearerClaims(req: http.IncomingMessage): Record<string, unknown> | null {
  const authHeader = req.headers.authorization ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice("Bearer ".length);
  return verifyJwt(token);
}

async function executeReadHealthRecords(
  payload: unknown,
  claims: Record<string, unknown>,
): Promise<{
  httpStatus: number;
  response: ReadHealthRecordsResponse;
}> {
  const sub = typeof claims?.sub === "string" ? claims.sub : "";
  const aud = typeof claims?.aud === "string" ? claims.aud : "";
  if (!sub || !aud) {
    return {
      httpStatus: 401,
      response: buildMcpErrorResponse("summary", "INVALID_REQUEST", "Invalid token claims", false),
    };
  }

  const parsed = ReadHealthRecordsRequestSchema.safeParse(payload);

  if (!parsed.success) {
    const rawDepth = typeof payload === "object" && payload !== null
      ? (payload as { depth?: unknown }).depth
      : undefined;
    const candidateDepth = rawDepth === "codes" || rawDepth === "summary" || rawDepth === "detail"
      ? rawDepth
      : "summary";
    return {
      httpStatus: 400,
      response: buildMcpErrorResponse(candidateDepth, "INVALID_REQUEST", parsed.error.message, false),
    };
  }

  const bridged = await forwardToBridge(parsed.data, parsed.data.depth, { sub, aud });
  if (bridged) {
    return { httpStatus: 200, response: bridged };
  }

  return {
    httpStatus: 200,
    response: buildMcpErrorResponse(parsed.data.depth, "NETWORK_UNAVAILABLE", "MCP bridge unavailable", true),
  };
}

function parseJsonRpcRequest(payload: unknown): JsonRpcRequest | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const candidate = payload as Partial<JsonRpcRequest>;
  if (candidate.jsonrpc !== "2.0" || typeof candidate.method !== "string") {
    return null;
  }
  if (
    candidate.id !== undefined
    && candidate.id !== null
    && typeof candidate.id !== "string"
    && typeof candidate.id !== "number"
  ) {
    return null;
  }
  return candidate as JsonRpcRequest;
}

function readHealthRecordsToolDefinition(): Record<string, unknown> {
  return {
    name: "read_health_records",
    description: "Read approved health records from local OpenMyHealth vault.",
    inputSchema: {
      type: "object",
      properties: {
        resource_types: {
          type: "array",
          items: {
            type: "string",
            enum: ["Observation", "MedicationStatement", "Condition", "DiagnosticReport", "DocumentReference"],
          },
          minItems: 1,
        },
        query: { type: "string" },
        date_from: { type: "string", format: "date-time" },
        date_to: { type: "string", format: "date-time" },
        depth: { type: "string", enum: ["codes", "summary", "detail"] },
        limit: { type: "integer", minimum: 1, maximum: MAX_RECORDS_PER_RESPONSE },
      },
      required: ["resource_types", "depth"],
      additionalProperties: false,
    },
  };
}

async function handleMcpRpc(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  let payload: unknown;
  try {
    payload = await parseJsonBody(req);
  } catch {
    jsonRpcError(res, null, -32700, "Parse error", undefined, 400);
    return;
  }

  if (Array.isArray(payload)) {
    jsonRpcError(res, null, -32600, "Batch requests are not supported", undefined, 400);
    return;
  }

  const rpc = parseJsonRpcRequest(payload);
  if (!rpc) {
    jsonRpcError(res, null, -32600, "Invalid Request", undefined, 400);
    return;
  }

  const id = rpc.id ?? null;
  if (rpc.method === "notifications/initialized") {
    // JSON-RPC notification: no response body required when id is absent.
    if (rpc.id === undefined) {
      res.writeHead(204, { "Cache-Control": "no-store" });
      res.end();
      return;
    }
    jsonRpcResult(res, id, {});
    return;
  }

  if (rpc.method === "initialize") {
    jsonRpcResult(res, id, {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: {
          listChanged: false,
        },
      },
      serverInfo: {
        name: "openmyhealth-relay",
        version: "0.1.0",
      },
    });
    return;
  }

  const claims = getBearerClaims(req);
  if (!claims) {
    jsonRpcError(res, id, -32001, "Unauthorized", undefined, 401);
    return;
  }

  if (rpc.method === "tools/list") {
    jsonRpcResult(res, id, {
      tools: [readHealthRecordsToolDefinition()],
    });
    return;
  }

  if (rpc.method === "tools/call") {
    if (!rpc.params || typeof rpc.params !== "object") {
      jsonRpcError(res, id, -32602, "Invalid params");
      return;
    }
    const params = rpc.params as { name?: unknown; arguments?: unknown };
    if (params.name !== "read_health_records") {
      jsonRpcError(res, id, -32601, "Tool not found");
      return;
    }

    const executed = await executeReadHealthRecords(params.arguments ?? {}, claims);
    if (executed.httpStatus === 400) {
      jsonRpcError(res, id, -32602, "Invalid params", executed.response, 400);
      return;
    }
    if (executed.httpStatus === 401) {
      jsonRpcError(res, id, -32001, "Unauthorized", executed.response, 401);
      return;
    }

    const resultPayload = executed.response;
    jsonRpcResult(res, id, {
      content: [
        {
          type: "text",
          text: JSON.stringify(resultPayload),
        },
      ],
      structuredContent: resultPayload,
      isError: resultPayload.status !== "ok",
    });
    return;
  }

  // keep claims variable used for future policy expansion
  if (!claims.sub) {
    jsonRpcError(res, id, -32002, "Invalid claims");
    return;
  }
  jsonRpcError(res, id, -32601, "Method not found");
}

async function handleMcpRead(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const claims = getBearerClaims(req);
  if (!claims) {
    unauthorized(res);
    return;
  }

  let payload: unknown;
  try {
    payload = await parseJsonBody(req);
  } catch {
    json(res, 400, buildMcpErrorResponse("summary", "INVALID_REQUEST", "Invalid JSON body", false));
    return;
  }

  const executed = await executeReadHealthRecords(payload, claims);
  json(res, executed.httpStatus, executed.response);
}

function handleMcpSse(req: http.IncomingMessage, res: http.ServerResponse): void {
  const claims = getBearerClaims(req);
  if (!claims) {
    unauthorized(res);
    return;
  }
  openSseStream(req, res);
}

const server = http.createServer(async (req, res) => {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);

  try {
    if (method === "GET" && url.pathname === "/health") {
      const bridgeConfigured = Boolean(BRIDGE_URL);
      json(res, 200, {
        ok: true,
        service: "openmyhealth-relay",
        version: "0.1.0",
        issuer: ISSUER,
        max_records_per_response: MAX_RECORDS_PER_RESPONSE,
        bridge_configured: bridgeConfigured,
        mcp_read_ready: bridgeConfigured,
      });
      return;
    }

    if (method === "GET" && url.pathname === "/authorize") {
      handleAuthorize(req, url, res);
      return;
    }

    if (method === "POST" && url.pathname === "/authorize/confirm") {
      await handleAuthorizeConfirm(req, res);
      return;
    }

    if (method === "POST" && url.pathname === "/token") {
      await handleToken(req, res);
      return;
    }

    if (method === "POST" && url.pathname === "/mcp") {
      await handleMcpRpc(req, res);
      return;
    }

    if (method === "GET" && url.pathname === "/mcp") {
      handleMcpSse(req, res);
      return;
    }

    if (method === "POST" && url.pathname === "/mcp/read_health_records") {
      await handleMcpRead(req, res);
      return;
    }

    notFound(res);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      if (method === "POST" && url.pathname === "/mcp") {
        jsonRpcError(res, null, -32600, "Request body too large", undefined, 413);
        return;
      }
      if (method === "POST" && url.pathname === "/mcp/read_health_records") {
        json(res, 413, buildMcpErrorResponse("summary", "INVALID_REQUEST", "Request body too large", false));
        return;
      }
      json(res, 413, { error: "payload_too_large" });
      return;
    }

    if (method === "POST" && url.pathname === "/mcp") {
      jsonRpcError(res, null, -32603, "Internal error", undefined, 500);
      return;
    }

    if (method === "POST" && url.pathname === "/mcp/read_health_records") {
      json(
        res,
        500,
        buildMcpErrorResponse("summary", "INTERNAL_ERROR", "An unexpected error occurred. Please try again.", true),
      );
      return;
    }

    json(res, 500, {
      error: "internal_error",
      message: "An unexpected error occurred. Please try again.",
    });
  }
});

function cleanupExpiredTokens(): void {
  const current = now();
  for (const [code, record] of authCodes.entries()) {
    if (record.expiresAt < current) {
      authCodes.delete(code);
    }
  }
  for (const [id, record] of pendingAuthorizations.entries()) {
    if (record.expiresAt < current) {
      pendingAuthorizations.delete(id);
    }
  }
  for (const [hash, record] of refreshStore.entries()) {
    if (record.expiresAt <= current || record.used) {
      refreshStore.delete(hash);
    }
  }
}

const cleanupInterval = setInterval(cleanupExpiredTokens, 10 * 60 * 1000);
cleanupInterval.unref();

server.on("close", () => {
  clearInterval(cleanupInterval);
});

server.listen(PORT, HOST, () => {
  console.log(`[relay] listening on http://${HOST}:${PORT}`);
});
