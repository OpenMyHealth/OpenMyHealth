import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import http from "node:http";
import { normalizeRedirectUri, type AuthorizeParams, type RelayConfig, type Stores } from "./config.js";
import { base64UrlJson, json, now, randomToken } from "./http-helpers.js";

export function signJwt(config: RelayConfig, payload: Record<string, unknown>): string {
  const header = {
    alg: "HS256",
    typ: "JWT",
    kid: "v1",
  };
  const encodedHeader = base64UrlJson(header);
  const encodedPayload = base64UrlJson(payload);
  const input = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", config.JWT_SECRET).update(input).digest("base64url");
  return `${input}.${signature}`;
}

export function verifyJwt(config: RelayConfig, token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [header, payload, signature] = parts;
  const input = `${header}.${payload}`;
  const expectedBytes = createHmac("sha256", config.JWT_SECRET).update(input).digest();

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
  if (iss !== config.ISSUER) {
    return null;
  }
  if (!aud || !isClientAllowed(config, aud)) {
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

export function issueAccessToken(config: RelayConfig, sub: string, clientId: string, scope = "mcp:read"): string {
  const iat = now();
  return signJwt(config, {
    iss: config.ISSUER,
    aud: clientId,
    sub,
    scope,
    iat,
    nbf: iat,
    exp: iat + config.ACCESS_TOKEN_TTL_SECONDS,
    jti: randomToken(16),
  });
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function revokeRefreshFamily(stores: Stores, familyId: string): void {
  for (const [key, record] of stores.refreshStore.entries()) {
    if (record.familyId === familyId) {
      stores.refreshStore.delete(key);
    }
  }
}

export function issueRefreshToken(
  config: RelayConfig,
  stores: Stores,
  sub: string,
  clientId: string,
  familyId?: string,
): { token: string; familyId: string } {
  if (stores.refreshStore.size >= config.MAX_REFRESH_TOKENS) {
    cleanupExpiredTokens(stores);
  }
  while (stores.refreshStore.size >= config.MAX_REFRESH_TOKENS) {
    const oldest = stores.refreshStore.keys().next();
    if (oldest.done) {
      break;
    }
    stores.refreshStore.delete(oldest.value);
  }

  const tokenFamilyId = familyId ?? randomToken(12);
  const raw = randomToken(48);
  stores.refreshStore.set(hashRefreshToken(raw), {
    sub,
    clientId,
    familyId: tokenFamilyId,
    expiresAt: now() + 30 * 24 * 60 * 60,
    used: false,
  });

  return { token: raw, familyId: tokenFamilyId };
}

export function sendTokenResponse(
  config: RelayConfig,
  stores: Stores,
  res: http.ServerResponse,
  sub: string,
  clientId: string,
  refreshFamilyId?: string,
): void {
  const accessToken = issueAccessToken(config, sub, clientId);
  const refresh = issueRefreshToken(config, stores, sub, clientId, refreshFamilyId);
  json(res, 200, {
    token_type: "Bearer",
    access_token: accessToken,
    expires_in: config.ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refresh.token,
    refresh_expires_in: 30 * 24 * 60 * 60,
    scope: "mcp:read",
  });
}

export function isClientAllowed(config: RelayConfig, clientId: string): boolean {
  return config.clientRedirects.has(clientId);
}

export function isRedirectAllowed(config: RelayConfig, clientId: string, redirectUri: string): boolean {
  let normalized: string;
  try {
    normalized = normalizeRedirectUri(redirectUri);
  } catch {
    return false;
  }

  const allowed = config.clientRedirects.get(clientId);
  if (!allowed) {
    return false;
  }

  return allowed.has(normalized);
}

export function issueAuthCode(config: RelayConfig, stores: Stores, params: AuthorizeParams): string | null {
  if (stores.authCodes.size >= config.MAX_AUTH_CODES) {
    cleanupExpiredTokens(stores);
    if (stores.authCodes.size >= config.MAX_AUTH_CODES) {
      return null;
    }
  }

  const code = randomToken(24);
  stores.authCodes.set(code, {
    clientId: params.clientId,
    redirectUri: params.redirectUri,
    codeChallenge: params.codeChallenge,
    state: params.state,
    expiresAt: now() + 5 * 60,
    sub: `omh-${randomToken(12)}`,
  });
  return code;
}

export function cleanupExpiredTokens(stores: Stores): void {
  const current = now();
  for (const [code, record] of stores.authCodes.entries()) {
    if (record.expiresAt < current) {
      stores.authCodes.delete(code);
    }
  }
  for (const [id, record] of stores.pendingAuthorizations.entries()) {
    if (record.expiresAt < current) {
      stores.pendingAuthorizations.delete(id);
    }
  }
  for (const [hash, record] of stores.refreshStore.entries()) {
    if (record.expiresAt <= current || record.used) {
      stores.refreshStore.delete(hash);
    }
  }
}

export function getBearerClaims(config: RelayConfig, req: http.IncomingMessage): Record<string, unknown> | null {
  const authHeader = req.headers.authorization ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice("Bearer ".length);
  return verifyJwt(config, token);
}
