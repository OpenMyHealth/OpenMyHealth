import { describe, it, expect } from "vitest";
import {
  isLoopbackHost,
  normalizeRedirectUri,
  parseCsvList,
  parseClientRedirects,
  normalizePublicOrigin,
  normalizeBridgeUrl,
  loadConfig,
} from "./config.js";

/* ---------- isLoopbackHost ---------- */
describe("isLoopbackHost", () => {
  it("returns true for 127.0.0.1", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
  });

  it("returns true for ::1", () => {
    expect(isLoopbackHost("::1")).toBe(true);
  });

  it("returns true for localhost", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
  });

  it("returns false for google.com", () => {
    expect(isLoopbackHost("google.com")).toBe(false);
  });

  it("returns false for 0.0.0.0", () => {
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
  });
});

/* ---------- normalizeRedirectUri ---------- */
describe("normalizeRedirectUri", () => {
  it("returns normalized HTTPS URL", () => {
    expect(normalizeRedirectUri("https://example.com/callback")).toBe(
      "https://example.com/callback",
    );
  });

  it("strips hash fragment", () => {
    expect(normalizeRedirectUri("https://example.com/cb#frag")).toBe(
      "https://example.com/cb",
    );
  });

  it("throws for HTTP URLs", () => {
    expect(() => normalizeRedirectUri("http://example.com/cb")).toThrow(
      "Only https redirect URIs are allowed",
    );
  });

  it("throws for URLs with credentials", () => {
    expect(() =>
      normalizeRedirectUri("https://user:pass@example.com/cb"),
    ).toThrow("Redirect URI must not contain credentials");
  });

  it("throws for invalid URL", () => {
    expect(() => normalizeRedirectUri("not-a-url")).toThrow();
  });
});

/* ---------- parseCsvList ---------- */
describe("parseCsvList", () => {
  it("splits comma-separated values", () => {
    expect(parseCsvList("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("trims whitespace around items", () => {
    expect(parseCsvList("  a , b , c  ")).toEqual(["a", "b", "c"]);
  });

  it("filters empty strings", () => {
    expect(parseCsvList("a,,b,")).toEqual(["a", "b"]);
  });

  it("returns empty array for empty input", () => {
    expect(parseCsvList("")).toEqual([]);
  });
});

/* ---------- parseClientRedirects ---------- */
describe("parseClientRedirects", () => {
  it("parses RELAY_CLIENT_REDIRECTS format", () => {
    const env = {
      RELAY_CLIENT_REDIRECTS: "client1=https://a.com/cb|https://b.com/cb;client2=https://c.com/cb",
    } as NodeJS.ProcessEnv;
    const map = parseClientRedirects(env);
    expect(map.get("client1")).toEqual(new Set(["https://a.com/cb", "https://b.com/cb"]));
    expect(map.get("client2")).toEqual(new Set(["https://c.com/cb"]));
  });

  it("falls back to RELAY_CLIENT_IDS auto-config (single client)", () => {
    const env = {
      RELAY_CLIENT_IDS: "my-client",
      RELAY_REDIRECT_ALLOWLIST: "https://example.com/",
    } as NodeJS.ProcessEnv;
    const map = parseClientRedirects(env);
    expect(map.get("my-client")).toEqual(new Set(["https://example.com/"]));
  });

  it("falls back to RELAY_CLIENT_IDS auto-config (matching count)", () => {
    const env = {
      RELAY_CLIENT_IDS: "clientA,clientB",
      RELAY_REDIRECT_ALLOWLIST: "https://a.com/,https://b.com/",
    } as NodeJS.ProcessEnv;
    const map = parseClientRedirects(env);
    expect(map.get("clientA")).toEqual(new Set(["https://a.com/"]));
    expect(map.get("clientB")).toEqual(new Set(["https://b.com/"]));
  });

  it("throws when client/redirect count mismatch with multiple clients", () => {
    const env = {
      RELAY_CLIENT_IDS: "a,b,c",
      RELAY_REDIRECT_ALLOWLIST: "https://x.com/,https://y.com/",
    } as NodeJS.ProcessEnv;
    expect(() => parseClientRedirects(env)).toThrow("Multiple client IDs configured");
  });

  it("throws on invalid RELAY_CLIENT_REDIRECTS segment", () => {
    const env = {
      RELAY_CLIENT_REDIRECTS: "no-equals-sign",
    } as NodeJS.ProcessEnv;
    expect(() => parseClientRedirects(env)).toThrow("Invalid RELAY_CLIENT_REDIRECTS segment");
  });

  it("uses defaults when no env vars set", () => {
    const env = {} as NodeJS.ProcessEnv;
    const map = parseClientRedirects(env);
    expect(map.has("openmyhealth-chatgpt")).toBe(true);
    expect(map.has("openmyhealth-claude")).toBe(true);
  });
});

/* ---------- normalizePublicOrigin ---------- */
describe("normalizePublicOrigin", () => {
  it("returns origin for HTTPS URL", () => {
    expect(normalizePublicOrigin("https://example.com:443/path")).toBe(
      "https://example.com",
    );
  });

  it("returns origin for HTTP URL", () => {
    expect(normalizePublicOrigin("http://localhost:8787/path")).toBe(
      "http://localhost:8787",
    );
  });

  it("throws for non-HTTP protocols", () => {
    expect(() => normalizePublicOrigin("ftp://example.com")).toThrow(
      "must be http or https",
    );
  });
});

/* ---------- normalizeBridgeUrl ---------- */
describe("normalizeBridgeUrl", () => {
  it("returns empty string for empty input", () => {
    expect(normalizeBridgeUrl("")).toBe("");
  });

  it("allows https URLs", () => {
    expect(normalizeBridgeUrl("https://bridge.example.com/mcp")).toBe(
      "https://bridge.example.com/mcp",
    );
  });

  it("allows http on loopback", () => {
    expect(normalizeBridgeUrl("http://127.0.0.1:3000")).toBe(
      "http://127.0.0.1:3000/",
    );
  });

  it("throws for http on non-loopback", () => {
    expect(() => normalizeBridgeUrl("http://example.com/mcp")).toThrow(
      "must be https",
    );
  });
});

/* ---------- loadConfig ---------- */
describe("loadConfig", () => {
  function validEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
    return {
      RELAY_JWT_SECRET: "a".repeat(32),
      RELAY_CLIENT_IDS: "test-client",
      RELAY_REDIRECT_ALLOWLIST: "https://example.com/",
      ...overrides,
    } as NodeJS.ProcessEnv;
  }

  it("returns config and stores with valid env", () => {
    const { config, stores } = loadConfig(validEnv());
    expect(config.PORT).toBe(8787);
    expect(config.HOST).toBe("127.0.0.1");
    expect(config.JWT_SECRET).toBe("a".repeat(32));
    expect(config.ISSUER).toBe("openmyhealth-relay");
    expect(config.ACCESS_TOKEN_TTL_SECONDS).toBe(3600);
    expect(stores.authCodes).toBeInstanceOf(Map);
    expect(stores.pendingAuthorizations).toBeInstanceOf(Map);
    expect(stores.refreshStore).toBeInstanceOf(Map);
  });

  it("throws when JWT_SECRET is missing", () => {
    expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow("RELAY_JWT_SECRET");
  });

  it("throws when JWT_SECRET is too short", () => {
    expect(() =>
      loadConfig({ RELAY_JWT_SECRET: "short" } as NodeJS.ProcessEnv),
    ).toThrow("at least 32 characters");
  });

  it("throws for non-loopback HOST without ALLOW_REMOTE_HOST", () => {
    expect(() =>
      loadConfig(validEnv({ RELAY_HOST: "0.0.0.0" })),
    ).toThrow("must be loopback");
  });

  it("allows non-loopback HOST with ALLOW_REMOTE_HOST=1 and https origin", () => {
    const { config } = loadConfig(
      validEnv({
        RELAY_HOST: "0.0.0.0",
        RELAY_ALLOW_REMOTE_HOST: "1",
        RELAY_PUBLIC_ORIGIN: "https://example.com",
      }),
    );
    expect(config.HOST).toBe("0.0.0.0");
    expect(config.SECURE_COOKIE).toBe(true);
  });

  it("sets SECURE_COOKIE true for https origins", () => {
    const { config } = loadConfig(
      validEnv({
        RELAY_HOST: "0.0.0.0",
        RELAY_ALLOW_REMOTE_HOST: "1",
        RELAY_PUBLIC_ORIGIN: "https://prod.example.com",
      }),
    );
    expect(config.SECURE_COOKIE).toBe(true);
  });

  it("sets SECURE_COOKIE false for http loopback origins", () => {
    const { config } = loadConfig(validEnv());
    expect(config.SECURE_COOKIE).toBe(false);
  });

  it("throws when non-loopback PUBLIC_ORIGIN uses http", () => {
    expect(() =>
      loadConfig(
        validEnv({
          RELAY_HOST: "0.0.0.0",
          RELAY_ALLOW_REMOTE_HOST: "1",
          RELAY_PUBLIC_ORIGIN: "http://example.com",
        }),
      ),
    ).toThrow("must use https for non-loopback");
  });

  it("throws when BRIDGE_URL is set without BRIDGE_AUTH_TOKEN", () => {
    expect(() =>
      loadConfig(validEnv({ RELAY_MCP_BRIDGE_URL: "https://bridge.example.com" })),
    ).toThrow("RELAY_BRIDGE_AUTH_TOKEN is required");
  });

  it("accepts custom PORT", () => {
    const { config } = loadConfig(validEnv({ RELAY_PORT: "9999" }));
    expect(config.PORT).toBe(9999);
  });
});
