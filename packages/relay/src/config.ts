import { URL } from "node:url";

export type AuthCodeRecord = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  expiresAt: number;
  sub: string;
};

export type PendingAuthorizationRecord = {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  nonce: string;
  requesterFingerprint: string;
  expiresAt: number;
};

export type RefreshRecord = {
  sub: string;
  clientId: string;
  familyId: string;
  expiresAt: number;
  used: boolean;
};

export type AuthorizeParams = {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
};

export type JsonRpcId = string | number | null;
export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
};

export type Stores = {
  authCodes: Map<string, AuthCodeRecord>;
  pendingAuthorizations: Map<string, PendingAuthorizationRecord>;
  refreshStore: Map<string, RefreshRecord>;
};

export type RelayConfig = {
  PORT: number;
  HOST: string;
  ISSUER: string;
  BRIDGE_AUTH_TOKEN: string;
  JWT_SECRET: string;
  PUBLIC_ORIGIN: string;
  SECURE_COOKIE: boolean;
  BRIDGE_URL: string;
  clientRedirects: Map<string, Set<string>>;
  PKCE_S256_PATTERN: RegExp;
  PKCE_VERIFIER_PATTERN: RegExp;
  CONSENT_COOKIE_NAME: string;
  MAX_AUTH_CODES: number;
  MAX_PENDING_AUTHS: number;
  MAX_REFRESH_TOKENS: number;
  ACCESS_TOKEN_TTL_SECONDS: number;
};

export function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

export function normalizeRedirectUri(value: string): string {
  const url = new URL(value);
  const isLoopback = isLoopbackHost(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    throw new Error("Only https redirect URIs are allowed (http permitted on loopback)");
  }
  if (url.username || url.password) {
    throw new Error("Redirect URI must not contain credentials");
  }
  url.hash = "";
  return url.toString();
}

export function parseCsvList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseClientRedirects(env: NodeJS.ProcessEnv): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const mapped = (env.RELAY_CLIENT_REDIRECTS ?? "").trim();

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

  const clientIds = parseCsvList(env.RELAY_CLIENT_IDS ?? "openmyhealth-chatgpt,openmyhealth-claude");
  const allowlist = parseCsvList(env.RELAY_REDIRECT_ALLOWLIST ?? "https://chatgpt.com/,https://claude.ai/")
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

export function normalizePublicOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("RELAY_PUBLIC_ORIGIN must be http or https origin");
  }
  return `${url.protocol}//${url.host}`;
}

export function normalizeBridgeUrl(value: string): string {
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): { config: RelayConfig; stores: Stores } {
  const PORT = Number(env.RELAY_PORT ?? 8787);
  const HOST = env.RELAY_HOST ?? "127.0.0.1";
  const ALLOW_REMOTE_HOST = env.RELAY_ALLOW_REMOTE_HOST === "1";
  const ISSUER = env.RELAY_ISSUER ?? "openmyhealth-relay";
  const BRIDGE_AUTH_TOKEN = env.RELAY_BRIDGE_AUTH_TOKEN ?? "";

  const rawSecret = env.RELAY_JWT_SECRET;
  if (!rawSecret || rawSecret.length < 32) {
    throw new Error("RELAY_JWT_SECRET must be set and at least 32 characters long.");
  }
  const JWT_SECRET = rawSecret;

  if (!ALLOW_REMOTE_HOST && !isLoopbackHost(HOST)) {
    throw new Error("RELAY_HOST must be loopback unless RELAY_ALLOW_REMOTE_HOST=1 is explicitly set.");
  }

  const clientRedirects = parseClientRedirects(env);
  const PUBLIC_ORIGIN = normalizePublicOrigin(env.RELAY_PUBLIC_ORIGIN ?? `http://${HOST}:${PORT}`);
  const SECURE_COOKIE = PUBLIC_ORIGIN.startsWith("https://");
  const publicOriginHost = new URL(PUBLIC_ORIGIN).hostname;
  const BRIDGE_URL = normalizeBridgeUrl(env.RELAY_MCP_BRIDGE_URL ?? "");

  if (!isLoopbackHost(publicOriginHost) && !SECURE_COOKIE) {
    throw new Error("RELAY_PUBLIC_ORIGIN must use https for non-loopback hosts.");
  }

  if (BRIDGE_URL && !BRIDGE_AUTH_TOKEN) {
    throw new Error("RELAY_BRIDGE_AUTH_TOKEN is required when RELAY_MCP_BRIDGE_URL is set.");
  }

  const config: RelayConfig = {
    PORT,
    HOST,
    ISSUER,
    BRIDGE_AUTH_TOKEN,
    JWT_SECRET,
    PUBLIC_ORIGIN,
    SECURE_COOKIE,
    BRIDGE_URL,
    clientRedirects,
    PKCE_S256_PATTERN: /^[A-Za-z0-9_-]{43,128}$/,
    PKCE_VERIFIER_PATTERN: /^[A-Za-z0-9._~-]{43,128}$/,
    CONSENT_COOKIE_NAME: "omh_consent_nonce",
    MAX_AUTH_CODES: 1000,
    MAX_PENDING_AUTHS: 1000,
    MAX_REFRESH_TOKENS: 5000,
    ACCESS_TOKEN_TTL_SECONDS: 60 * 60,
  };

  const stores: Stores = {
    authCodes: new Map<string, AuthCodeRecord>(),
    pendingAuthorizations: new Map<string, PendingAuthorizationRecord>(),
    refreshStore: new Map<string, RefreshRecord>(),
  };

  return { config, stores };
}
