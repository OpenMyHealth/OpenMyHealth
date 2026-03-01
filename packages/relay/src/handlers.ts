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
import {
  normalizeRedirectUri,
  type AuthorizeParams,
  type JsonRpcRequest,
  type PendingAuthorizationRecord,
  type RelayConfig,
  type Stores,
} from "./config.js";
import {
  cleanupExpiredTokens,
  getBearerClaims,
  hashRefreshToken,
  isClientAllowed,
  isRedirectAllowed,
  issueAuthCode,
  revokeRefreshFamily,
  sendTokenResponse,
} from "./auth.js";
import {
  RequestBodyTooLargeError,
  consentCookie,
  clearConsentCookie,
  escapeHtml,
  html,
  invalidGrant,
  json,
  jsonRpcError,
  jsonRpcResult,
  notFound,
  now,
  openSseStream,
  parseCookies,
  parseFormBody,
  parseJsonBody,
  randomToken,
  redirect,
  requestFingerprint,
  safeStringEqual,
  sha256Base64Url,
  signConsentToken,
  unauthorized,
} from "./http-helpers.js";

function parseAuthorizeParams(config: RelayConfig, url: URL): AuthorizeParams | null {
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
  if (challengeMethod !== "S256" || !config.PKCE_S256_PATTERN.test(codeChallenge)) {
    return null;
  }
  if (!isClientAllowed(config, clientId) || !isRedirectAllowed(config, clientId, redirectUriRaw)) {
    return null;
  }

  return {
    clientId,
    redirectUri: normalizeRedirectUri(redirectUriRaw),
    state,
    codeChallenge,
  };
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

async function forwardToBridge(
  config: RelayConfig,
  payload: unknown,
  depth: McpDepth,
  claims: { sub: string; aud: string },
): Promise<ReadHealthRecordsResponse | null> {
  if (!config.BRIDGE_URL) {
    return null;
  }

  try {
    const response = await fetch(config.BRIDGE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.BRIDGE_AUTH_TOKEN}`,
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

async function executeReadHealthRecords(
  config: RelayConfig,
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

  const bridged = await forwardToBridge(config, parsed.data, parsed.data.depth, { sub, aud });
  if (bridged) {
    return { httpStatus: 200, response: bridged };
  }

  return {
    httpStatus: 200,
    response: buildMcpErrorResponse(parsed.data.depth, "NETWORK_UNAVAILABLE", "MCP bridge unavailable", true),
  };
}

export function createRouter(
  config: RelayConfig,
  stores: Stores,
): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> {
  function handleAuthorize(req: http.IncomingMessage, url: URL, res: http.ServerResponse): void {
    const params = parseAuthorizeParams(config, url);
    if (!params) {
      json(res, 400, { error: "invalid_request" });
      return;
    }

    if (stores.pendingAuthorizations.size >= config.MAX_PENDING_AUTHS) {
      cleanupExpiredTokens(stores);
      if (stores.pendingAuthorizations.size >= config.MAX_PENDING_AUTHS) {
        json(res, 429, { error: "too_many_requests" });
        return;
      }
    }

    const pendingId = randomToken(16);
    const nonce = randomToken(16);
    const csrfToken = signConsentToken(config, pendingId, nonce);

    stores.pendingAuthorizations.set(pendingId, {
      ...params,
      nonce,
      requesterFingerprint: requestFingerprint(req),
      expiresAt: now() + 5 * 60,
    });

    html(res, 200, renderConsentPage(pendingId, csrfToken, params), {
      "Set-Cookie": consentCookie(config, nonce, 300),
    });
  }

  async function handleAuthorizeConfirm(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await parseFormBody(req);
    const requestId = body.request_id ?? "";
    const decision = body.decision ?? "deny";
    const csrfToken = body.csrf_token ?? "";

    const pending = stores.pendingAuthorizations.get(requestId);
    if (!pending) {
      json(res, 400, { error: "invalid_request", error_description: "unknown authorization request" });
      return;
    }

    if (pending.expiresAt <= now()) {
      stores.pendingAuthorizations.delete(requestId);
      json(res, 400, { error: "invalid_request", error_description: "authorization request expired" });
      return;
    }

    const origin = req.headers.origin ?? "";
    if (!origin || origin !== config.PUBLIC_ORIGIN) {
      stores.pendingAuthorizations.delete(requestId);
      json(res, 400, { error: "invalid_request", error_description: "origin mismatch" }, { "Set-Cookie": clearConsentCookie(config) });
      return;
    }

    const referer = req.headers.referer ?? "";
    let refererUrl: URL;
    try {
      refererUrl = new URL(referer);
    } catch {
      stores.pendingAuthorizations.delete(requestId);
      json(res, 400, { error: "invalid_request", error_description: "referer mismatch" }, { "Set-Cookie": clearConsentCookie(config) });
      return;
    }
    if (refererUrl.origin !== config.PUBLIC_ORIGIN || refererUrl.pathname !== "/authorize") {
      stores.pendingAuthorizations.delete(requestId);
      json(res, 400, { error: "invalid_request", error_description: "referer mismatch" }, { "Set-Cookie": clearConsentCookie(config) });
      return;
    }

    const fetchSite = req.headers["sec-fetch-site"];
    if (typeof fetchSite !== "string" || (fetchSite !== "same-origin" && fetchSite !== "none")) {
      stores.pendingAuthorizations.delete(requestId);
      json(res, 400, { error: "invalid_request", error_description: "origin mismatch" }, { "Set-Cookie": clearConsentCookie(config) });
      return;
    }

    const fetchMode = req.headers["sec-fetch-mode"];
    if (typeof fetchMode === "string" && fetchMode !== "navigate") {
      stores.pendingAuthorizations.delete(requestId);
      json(res, 400, { error: "invalid_request", error_description: "invalid fetch mode" }, { "Set-Cookie": clearConsentCookie(config) });
      return;
    }

    const fetchDest = req.headers["sec-fetch-dest"];
    if (typeof fetchDest === "string" && fetchDest !== "document") {
      stores.pendingAuthorizations.delete(requestId);
      json(res, 400, { error: "invalid_request", error_description: "invalid fetch destination" }, { "Set-Cookie": clearConsentCookie(config) });
      return;
    }

    const cookies = parseCookies(req);
    const nonce = cookies[config.CONSENT_COOKIE_NAME] ?? "";
    if (!nonce || !safeStringEqual(nonce, pending.nonce)) {
      stores.pendingAuthorizations.delete(requestId);
      json(res, 400, { error: "invalid_request", error_description: "invalid consent session" }, { "Set-Cookie": clearConsentCookie(config) });
      return;
    }

    const expectedCsrf = signConsentToken(config, requestId, nonce);
    if (!csrfToken || !safeStringEqual(csrfToken, expectedCsrf)) {
      stores.pendingAuthorizations.delete(requestId);
      json(res, 400, { error: "invalid_request", error_description: "csrf validation failed" }, { "Set-Cookie": clearConsentCookie(config) });
      return;
    }

    if (!safeStringEqual(pending.requesterFingerprint, requestFingerprint(req))) {
      stores.pendingAuthorizations.delete(requestId);
      json(
        res,
        400,
        { error: "invalid_request", error_description: "authorization request context mismatch" },
        { "Set-Cookie": clearConsentCookie(config) },
      );
      return;
    }

    stores.pendingAuthorizations.delete(requestId);

    if (decision !== "approve") {
      redirect(res, buildDenyRedirect(pending), { "Set-Cookie": clearConsentCookie(config) });
      return;
    }

    const code = issueAuthCode(config, stores, {
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      state: pending.state,
      codeChallenge: pending.codeChallenge,
    });

    if (!code) {
      json(res, 429, { error: "too_many_requests" }, { "Set-Cookie": clearConsentCookie(config) });
      return;
    }

    const callback = new URL(pending.redirectUri);
    callback.searchParams.set("code", code);
    callback.searchParams.set("state", pending.state);
    redirect(res, callback.toString(), { "Set-Cookie": clearConsentCookie(config) });
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

      const record = stores.authCodes.get(code);
      if (!record) {
        invalidGrant(res, "authorization code not found");
        return;
      }

      stores.authCodes.delete(code);

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
      if (!config.PKCE_VERIFIER_PATTERN.test(codeVerifier)) {
        invalidGrant(res, "invalid code_verifier");
        return;
      }
      if (sha256Base64Url(codeVerifier) !== record.codeChallenge) {
        invalidGrant(res, "PKCE verification failed");
        return;
      }

      sendTokenResponse(config, stores, res, record.sub, record.clientId);
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
      const current = stores.refreshStore.get(hash);

      if (!current) {
        invalidGrant(res, "refresh token not found");
        return;
      }

      if (current.clientId !== requestedClientId) {
        invalidGrant(res, "client mismatch");
        return;
      }

      if (current.used || current.expiresAt <= now()) {
        revokeRefreshFamily(stores, current.familyId);
        invalidGrant(res, "refresh token expired or reused");
        return;
      }

      current.used = true;
      stores.refreshStore.set(hash, current);

      sendTokenResponse(config, stores, res, current.sub, current.clientId, current.familyId);
      return;
    }

    json(res, 400, { error: "unsupported_grant_type" });
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

    const claims = getBearerClaims(config, req);
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

      const executed = await executeReadHealthRecords(config, params.arguments ?? {}, claims);
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
    const claims = getBearerClaims(config, req);
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

    const executed = await executeReadHealthRecords(config, payload, claims);
    json(res, executed.httpStatus, executed.response);
  }

  function handleMcpSse(req: http.IncomingMessage, res: http.ServerResponse): void {
    const claims = getBearerClaims(config, req);
    if (!claims) {
      unauthorized(res);
      return;
    }
    openSseStream(req, res);
  }

  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", `http://${config.HOST}:${config.PORT}`);

    try {
      if (method === "GET" && url.pathname === "/health") {
        const bridgeConfigured = Boolean(config.BRIDGE_URL);
        json(res, 200, {
          ok: true,
          service: "openmyhealth-relay",
          version: "0.1.0",
          issuer: config.ISSUER,
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
  };
}
