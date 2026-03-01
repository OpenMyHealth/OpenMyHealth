import { describe, it, expect, beforeEach } from "vitest";
import type { RelayConfig, Stores } from "./config.js";
import {
  signJwt,
  verifyJwt,
  issueAccessToken,
  hashRefreshToken,
  revokeRefreshFamily,
  issueRefreshToken,
  isClientAllowed,
  isRedirectAllowed,
  issueAuthCode,
  cleanupExpiredTokens,
  getBearerClaims,
} from "./auth.js";
import { now, sha256Base64Url } from "./http-helpers.js";
import { Readable } from "node:stream";
import type http from "node:http";
import type { Socket } from "node:net";

/* ---------- helpers ---------- */

function testConfig(overrides: Partial<RelayConfig> = {}): RelayConfig {
  return {
    PORT: 8787,
    HOST: "127.0.0.1",
    ISSUER: "test-issuer",
    BRIDGE_AUTH_TOKEN: "",
    JWT_SECRET: "test-secret-key-that-is-long-enough-for-tests",
    PUBLIC_ORIGIN: "http://127.0.0.1:8787",
    SECURE_COOKIE: false,
    BRIDGE_URL: "",
    clientRedirects: new Map([
      ["allowed-client", new Set(["https://example.com/callback"])],
    ]),
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

function testStores(): Stores {
  return {
    authCodes: new Map(),
    pendingAuthorizations: new Map(),
    refreshStore: new Map(),
  };
}

function mockReqWithAuth(authHeader: string): http.IncomingMessage {
  const readable = new Readable({ read() { this.push(null); } });
  Object.assign(readable, {
    headers: { authorization: authHeader },
    socket: { remoteAddress: "127.0.0.1" } as Socket,
  });
  return readable as unknown as http.IncomingMessage;
}

/* ---------- signJwt / verifyJwt roundtrip ---------- */
describe("signJwt / verifyJwt", () => {
  const config = testConfig();

  it("roundtrip: sign then verify returns original payload", () => {
    const payload = {
      iss: config.ISSUER,
      aud: "allowed-client",
      sub: "user-1",
      scope: "mcp:read",
      iat: now(),
      nbf: now(),
      exp: now() + 3600,
    };
    const token = signJwt(config, payload);
    const decoded = verifyJwt(config, token);
    expect(decoded).not.toBeNull();
    expect(decoded!.sub).toBe("user-1");
    expect(decoded!.scope).toBe("mcp:read");
  });

  it("rejects expired token", () => {
    const payload = {
      iss: config.ISSUER,
      aud: "allowed-client",
      sub: "user-1",
      scope: "mcp:read",
      iat: now() - 7200,
      nbf: now() - 7200,
      exp: now() - 3600,
    };
    const token = signJwt(config, payload);
    expect(verifyJwt(config, token)).toBeNull();
  });

  it("rejects token with wrong issuer", () => {
    const payload = {
      iss: "wrong-issuer",
      aud: "allowed-client",
      sub: "user-1",
      scope: "mcp:read",
      iat: now(),
      nbf: now(),
      exp: now() + 3600,
    };
    const token = signJwt(config, payload);
    expect(verifyJwt(config, token)).toBeNull();
  });

  it("rejects token with unknown audience", () => {
    const payload = {
      iss: config.ISSUER,
      aud: "unknown-client",
      sub: "user-1",
      scope: "mcp:read",
      iat: now(),
      nbf: now(),
      exp: now() + 3600,
    };
    const token = signJwt(config, payload);
    expect(verifyJwt(config, token)).toBeNull();
  });

  it("rejects token without mcp:read scope", () => {
    const payload = {
      iss: config.ISSUER,
      aud: "allowed-client",
      sub: "user-1",
      scope: "other:scope",
      iat: now(),
      nbf: now(),
      exp: now() + 3600,
    };
    const token = signJwt(config, payload);
    expect(verifyJwt(config, token)).toBeNull();
  });

  it("rejects token with bad signature", () => {
    const payload = {
      iss: config.ISSUER,
      aud: "allowed-client",
      sub: "user-1",
      scope: "mcp:read",
      iat: now(),
      nbf: now(),
      exp: now() + 3600,
    };
    const token = signJwt(config, payload);
    const tampered = token.slice(0, -5) + "XXXXX";
    expect(verifyJwt(config, tampered)).toBeNull();
  });

  it("rejects token with not-yet-valid nbf", () => {
    const payload = {
      iss: config.ISSUER,
      aud: "allowed-client",
      sub: "user-1",
      scope: "mcp:read",
      iat: now(),
      nbf: now() + 9999,
      exp: now() + 10000,
    };
    const token = signJwt(config, payload);
    expect(verifyJwt(config, token)).toBeNull();
  });

  it("rejects token with empty sub", () => {
    const payload = {
      iss: config.ISSUER,
      aud: "allowed-client",
      sub: "",
      scope: "mcp:read",
      iat: now(),
      nbf: now(),
      exp: now() + 3600,
    };
    const token = signJwt(config, payload);
    expect(verifyJwt(config, token)).toBeNull();
  });

  it("rejects malformed token (wrong number of parts)", () => {
    expect(verifyJwt(config, "only.two")).toBeNull();
  });

  it("rejects token with invalid base64url signature", () => {
    const payload = {
      iss: config.ISSUER,
      aud: "allowed-client",
      sub: "user-1",
      scope: "mcp:read",
      iat: now(),
      nbf: now(),
      exp: now() + 3600,
    };
    const token = signJwt(config, payload);
    const [h, p] = token.split(".");
    // signature with wrong length will fail length check
    expect(verifyJwt(config, `${h}.${p}.short`)).toBeNull();
  });
});

/* ---------- PKCE ---------- */
describe("PKCE sha256Base64Url", () => {
  it("verifier hashed matches challenge", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = sha256Base64Url(verifier);
    expect(challenge).toBe(sha256Base64Url(verifier));
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("different verifiers produce different challenges", () => {
    expect(sha256Base64Url("verifier-a")).not.toBe(sha256Base64Url("verifier-b"));
  });
});

/* ---------- issueAuthCode ---------- */
describe("issueAuthCode", () => {
  it("creates a record with 5-min TTL", () => {
    const config = testConfig();
    const stores = testStores();
    const code = issueAuthCode(config, stores, {
      clientId: "allowed-client",
      redirectUri: "https://example.com/callback",
      state: "state123",
      codeChallenge: "challenge_abc",
    });
    expect(code).toBeTruthy();
    expect(stores.authCodes.size).toBe(1);
    const record = stores.authCodes.get(code!);
    expect(record!.clientId).toBe("allowed-client");
    expect(record!.expiresAt).toBeGreaterThan(now());
    expect(record!.expiresAt).toBeLessThanOrEqual(now() + 300);
  });

  it("generates unique codes", () => {
    const config = testConfig();
    const stores = testStores();
    const params = {
      clientId: "allowed-client",
      redirectUri: "https://example.com/callback",
      state: "s",
      codeChallenge: "c",
    };
    const code1 = issueAuthCode(config, stores, params);
    const code2 = issueAuthCode(config, stores, params);
    expect(code1).not.toBe(code2);
  });

  it("returns null when MAX_AUTH_CODES reached and cleanup does not help", () => {
    const config = testConfig({ MAX_AUTH_CODES: 2 });
    const stores = testStores();
    const params = {
      clientId: "allowed-client",
      redirectUri: "https://example.com/callback",
      state: "s",
      codeChallenge: "c",
    };
    issueAuthCode(config, stores, params);
    issueAuthCode(config, stores, params);
    const third = issueAuthCode(config, stores, params);
    expect(third).toBeNull();
  });

  it("assigns sub with omh- prefix", () => {
    const config = testConfig();
    const stores = testStores();
    const code = issueAuthCode(config, stores, {
      clientId: "allowed-client",
      redirectUri: "https://example.com/callback",
      state: "s",
      codeChallenge: "c",
    });
    const record = stores.authCodes.get(code!);
    expect(record!.sub).toMatch(/^omh-/);
  });
});

/* ---------- issueRefreshToken ---------- */
describe("issueRefreshToken", () => {
  it("creates a record with 30-day TTL", () => {
    const config = testConfig();
    const stores = testStores();
    const { token, familyId } = issueRefreshToken(config, stores, "sub-1", "allowed-client");
    expect(token).toBeTruthy();
    expect(familyId).toBeTruthy();
    expect(stores.refreshStore.size).toBe(1);
    const hash = hashRefreshToken(token);
    const record = stores.refreshStore.get(hash);
    expect(record!.sub).toBe("sub-1");
    expect(record!.used).toBe(false);
    const thirtyDays = 30 * 24 * 60 * 60;
    expect(record!.expiresAt).toBeGreaterThan(now() + thirtyDays - 10);
  });

  it("uses existing familyId for rotation", () => {
    const config = testConfig();
    const stores = testStores();
    const first = issueRefreshToken(config, stores, "sub-1", "c", "family-x");
    expect(first.familyId).toBe("family-x");
  });

  it("evicts oldest when MAX_REFRESH_TOKENS reached", () => {
    const config = testConfig({ MAX_REFRESH_TOKENS: 2 });
    const stores = testStores();
    issueRefreshToken(config, stores, "sub-1", "c");
    issueRefreshToken(config, stores, "sub-2", "c");
    issueRefreshToken(config, stores, "sub-3", "c");
    expect(stores.refreshStore.size).toBeLessThanOrEqual(2);
  });
});

/* ---------- revokeRefreshFamily ---------- */
describe("revokeRefreshFamily", () => {
  it("deletes all tokens in a family", () => {
    const stores = testStores();
    stores.refreshStore.set("hash1", {
      sub: "s", clientId: "c", familyId: "f1", expiresAt: now() + 9999, used: false,
    });
    stores.refreshStore.set("hash2", {
      sub: "s", clientId: "c", familyId: "f1", expiresAt: now() + 9999, used: false,
    });
    stores.refreshStore.set("hash3", {
      sub: "s", clientId: "c", familyId: "f2", expiresAt: now() + 9999, used: false,
    });
    revokeRefreshFamily(stores, "f1");
    expect(stores.refreshStore.size).toBe(1);
    expect(stores.refreshStore.has("hash3")).toBe(true);
  });

  it("no-ops when family not found", () => {
    const stores = testStores();
    stores.refreshStore.set("h", {
      sub: "s", clientId: "c", familyId: "f1", expiresAt: now() + 9999, used: false,
    });
    revokeRefreshFamily(stores, "nonexistent");
    expect(stores.refreshStore.size).toBe(1);
  });
});

/* ---------- cleanupExpiredTokens ---------- */
describe("cleanupExpiredTokens", () => {
  it("removes expired auth codes", () => {
    const stores = testStores();
    stores.authCodes.set("expired", {
      clientId: "c", redirectUri: "r", codeChallenge: "cc", state: "s",
      expiresAt: now() - 100, sub: "u",
    });
    stores.authCodes.set("valid", {
      clientId: "c", redirectUri: "r", codeChallenge: "cc", state: "s",
      expiresAt: now() + 9999, sub: "u",
    });
    cleanupExpiredTokens(stores);
    expect(stores.authCodes.size).toBe(1);
    expect(stores.authCodes.has("valid")).toBe(true);
  });

  it("removes expired pending authorizations", () => {
    const stores = testStores();
    stores.pendingAuthorizations.set("expired", {
      clientId: "c", redirectUri: "r", state: "s", codeChallenge: "cc",
      nonce: "n", requesterFingerprint: "fp", expiresAt: now() - 100,
    });
    cleanupExpiredTokens(stores);
    expect(stores.pendingAuthorizations.size).toBe(0);
  });

  it("removes expired and used refresh tokens", () => {
    const stores = testStores();
    stores.refreshStore.set("expired", {
      sub: "s", clientId: "c", familyId: "f", expiresAt: now() - 100, used: false,
    });
    stores.refreshStore.set("used", {
      sub: "s", clientId: "c", familyId: "f", expiresAt: now() + 9999, used: true,
    });
    stores.refreshStore.set("active", {
      sub: "s", clientId: "c", familyId: "f", expiresAt: now() + 9999, used: false,
    });
    cleanupExpiredTokens(stores);
    expect(stores.refreshStore.size).toBe(1);
    expect(stores.refreshStore.has("active")).toBe(true);
  });
});

/* ---------- hashRefreshToken ---------- */
describe("hashRefreshToken", () => {
  it("produces deterministic SHA-256 hex", () => {
    expect(hashRefreshToken("token-abc")).toBe(hashRefreshToken("token-abc"));
  });

  it("produces different hashes for different tokens", () => {
    expect(hashRefreshToken("a")).not.toBe(hashRefreshToken("b"));
  });

  it("returns 64-char hex string", () => {
    expect(hashRefreshToken("test")).toMatch(/^[a-f0-9]{64}$/);
  });
});

/* ---------- isClientAllowed ---------- */
describe("isClientAllowed", () => {
  const config = testConfig();

  it("returns true for allowed client", () => {
    expect(isClientAllowed(config, "allowed-client")).toBe(true);
  });

  it("returns false for unknown client", () => {
    expect(isClientAllowed(config, "unknown-client")).toBe(false);
  });
});

/* ---------- isRedirectAllowed ---------- */
describe("isRedirectAllowed", () => {
  const config = testConfig();

  it("returns true for allowed redirect", () => {
    expect(isRedirectAllowed(config, "allowed-client", "https://example.com/callback")).toBe(true);
  });

  it("returns false for disallowed redirect", () => {
    expect(isRedirectAllowed(config, "allowed-client", "https://evil.com/callback")).toBe(false);
  });

  it("returns false for unknown client", () => {
    expect(isRedirectAllowed(config, "no-client", "https://example.com/callback")).toBe(false);
  });

  it("returns false for non-https redirect", () => {
    expect(isRedirectAllowed(config, "allowed-client", "http://example.com/callback")).toBe(false);
  });

  it("returns false for invalid URL", () => {
    expect(isRedirectAllowed(config, "allowed-client", "not-a-url")).toBe(false);
  });
});

/* ---------- issueAccessToken ---------- */
describe("issueAccessToken", () => {
  it("produces a JWT that verifyJwt accepts", () => {
    const config = testConfig();
    const token = issueAccessToken(config, "sub-1", "allowed-client");
    const claims = verifyJwt(config, token);
    expect(claims).not.toBeNull();
    expect(claims!.sub).toBe("sub-1");
    expect(claims!.aud).toBe("allowed-client");
    expect(claims!.scope).toBe("mcp:read");
  });

  it("accepts custom scope", () => {
    const config = testConfig();
    const token = issueAccessToken(config, "sub-1", "allowed-client", "mcp:read mcp:write");
    const claims = verifyJwt(config, token);
    expect(claims).not.toBeNull();
    expect(claims!.scope).toBe("mcp:read mcp:write");
  });
});

/* ---------- getBearerClaims ---------- */
describe("getBearerClaims", () => {
  const config = testConfig();

  it("returns claims for valid Bearer token", () => {
    const token = issueAccessToken(config, "user-1", "allowed-client");
    const req = mockReqWithAuth(`Bearer ${token}`);
    const claims = getBearerClaims(config, req);
    expect(claims).not.toBeNull();
    expect(claims!.sub).toBe("user-1");
  });

  it("returns null when no Authorization header", () => {
    const readable = new Readable({ read() { this.push(null); } });
    Object.assign(readable, {
      headers: {},
      socket: { remoteAddress: "127.0.0.1" } as Socket,
    });
    const req = readable as unknown as http.IncomingMessage;
    expect(getBearerClaims(config, req)).toBeNull();
  });

  it("returns null for non-Bearer scheme", () => {
    const req = mockReqWithAuth("Basic dXNlcjpwYXNz");
    expect(getBearerClaims(config, req)).toBeNull();
  });

  it("returns null for invalid token", () => {
    const req = mockReqWithAuth("Bearer invalid.token.here");
    expect(getBearerClaims(config, req)).toBeNull();
  });
});
