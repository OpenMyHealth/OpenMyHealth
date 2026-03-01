import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import type { JsonRpcId, RelayConfig } from "./config.js";

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body too large");
    this.name = "RequestBodyTooLargeError";
  }
}

export function now(): number {
  return Math.floor(Date.now() / 1000);
}

export function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function safeStringEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export function parseCookies(req: http.IncomingMessage): Record<string, string> {
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

export function requestFingerprint(req: http.IncomingMessage): string {
  const address = req.socket.remoteAddress ?? "unknown";
  const ua = String(req.headers["user-agent"] ?? "");
  return createHash("sha256").update(`${address}|${ua}`).digest("hex");
}

export function json(
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

export function html(
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

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

export function redirect(res: http.ServerResponse, target: string, headers: Record<string, string> = {}): void {
  res.writeHead(302, {
    Location: target,
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end();
}

export function parseBodyRaw(req: http.IncomingMessage): Promise<string> {
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

export async function parseFormBody(req: http.IncomingMessage): Promise<Record<string, string>> {
  const raw = await parseBodyRaw(req);
  return Object.fromEntries(new URLSearchParams(raw).entries());
}

export async function parseJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const raw = await parseBodyRaw(req);
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

export function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function unauthorized(res: http.ServerResponse): void {
  json(res, 401, { error: "unauthorized" });
}

export function invalidGrant(res: http.ServerResponse, message = "invalid_grant"): void {
  json(res, 400, { error: "invalid_grant", error_description: message });
}

export function notFound(res: http.ServerResponse): void {
  json(res, 404, { error: "not_found" });
}

export function jsonRpcResult(res: http.ServerResponse, id: JsonRpcId, result: unknown, status = 200): void {
  json(res, status, {
    jsonrpc: "2.0",
    id,
    result,
  });
}

export function jsonRpcError(
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

export function consentCookie(config: RelayConfig, value: string, maxAge: number): string {
  const secure = config.SECURE_COOKIE ? "; Secure" : "";
  return `${config.CONSENT_COOKIE_NAME}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/authorize; Max-Age=${maxAge}${secure}`;
}

export function clearConsentCookie(config: RelayConfig): string {
  const secure = config.SECURE_COOKIE ? "; Secure" : "";
  return `${config.CONSENT_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/authorize; Max-Age=0${secure}`;
}

export function signConsentToken(config: RelayConfig, requestId: string, nonce: string): string {
  return createHmac("sha256", config.JWT_SECRET).update(`${requestId}.${nonce}`).digest("base64url");
}

export function openSseStream(req: http.IncomingMessage, res: http.ServerResponse): void {
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
