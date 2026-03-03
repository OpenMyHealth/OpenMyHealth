/**
 * chatbot-server.mjs — HTTP server for the QA chatbot.
 * Zero npm dependencies — uses Node.js built-in `http`, `fs`, `path`.
 *
 * Endpoints:
 *   GET /              → serve public/index.html
 *   GET /static/*      → serve static files from public/
 *   POST /api/chat     → SSE streaming chat completion
 *   POST /api/tool-result → continue LLM after tool execution
 *
 * SSE event protocol:
 *   event: delta       → { content: "..." }
 *   event: tool_call   → { id, type, function: { name, arguments } }
 *   event: done        → { finish_reason: "..." }
 *   event: error       → { message: "..." }
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  chatCompletionStream,
  READ_HEALTH_RECORDS_TOOL,
  SYSTEM_PROMPT,
} from "./lib/azure-openai.mjs";

// ─── Configuration ──────────────────────────────────────────────────────────

const PORT = parseInt(process.env.CHATBOT_PORT || "3939", 10);
const HOST = process.env.CHATBOT_HOST || "127.0.0.1";

const PUBLIC_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "public",
);

// ─── MIME Types ─────────────────────────────────────────────────────────────

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

// ─── In-Memory Conversation State ───────────────────────────────────────────

/** @type {Map<string, Array<{role: string, content: string, tool_call_id?: string, tool_calls?: any[]}>>} */
const conversations = new Map();

/**
 * Get or create a conversation's message history.
 * @param {string} conversationId
 * @returns {Array}
 */
function getConversation(conversationId) {
  if (!conversations.has(conversationId)) {
    conversations.set(conversationId, [
      { role: "system", content: SYSTEM_PROMPT },
    ]);
  }
  return conversations.get(conversationId);
}

// ─── HTTP Helpers ───────────────────────────────────────────────────────────

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendSSE(res, eventType, data) {
  res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Read the full request body as a string.
 * @param {http.IncomingMessage} req
 * @returns {Promise<string>}
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// ─── Static File Serving ────────────────────────────────────────────────────

/**
 * Serve a static file from the public directory.
 * @param {http.ServerResponse} res
 * @param {string} urlPath
 * @returns {boolean} true if file was served
 */
function serveStatic(res, urlPath) {
  // Normalize the path (remove leading slash, default to index.html)
  let filePath = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");

  // Prevent directory traversal
  const resolved = path.resolve(PUBLIC_DIR, filePath);
  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return true;
  }

  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) return false;

    const ext = path.extname(resolved);
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const content = fs.readFileSync(resolved);

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": content.length,
      "Cache-Control": "no-cache",
    });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

// ─── API Handlers ───────────────────────────────────────────────────────────

/**
 * POST /api/chat
 * Body: { messages: [{ role, content }], conversation_id?: string }
 * Response: SSE stream with events: delta, tool_call, done
 */
async function handleChat(req, res) {
  let body;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const { messages, conversation_id } = body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    sendJson(res, 400, { error: "messages array is required" });
    return;
  }

  const convId = conversation_id || randomUUID();
  const conversation = getConversation(convId);

  // Append user messages to conversation history
  for (const msg of messages) {
    conversation.push({ role: msg.role, content: msg.content });
  }

  // Set up SSE response
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Conversation-ID": convId,
  });

  try {
    const result = await chatCompletionStream(
      conversation,
      [READ_HEALTH_RECORDS_TOOL],
      (event) => {
        sendSSE(res, event.type, event.data);
      },
    );

    // Store assistant response in conversation history
    const assistantMsg = { role: "assistant", content: result.content };
    if (result.tool_calls) {
      assistantMsg.tool_calls = result.tool_calls;
      assistantMsg.content = null;
    }
    conversation.push(assistantMsg);
  } catch (err) {
    sendSSE(res, "error", { message: err.message });
    sendSSE(res, "done", { finish_reason: "error" });
  }

  res.end();
}

/**
 * POST /api/tool-result
 * Body: { conversation_id, tool_call_id, result }
 * Response: SSE stream — continues LLM with the tool result
 */
async function handleToolResult(req, res) {
  let body;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const { conversation_id, tool_call_id, result } = body;

  if (!conversation_id || !tool_call_id || result === undefined) {
    sendJson(res, 400, {
      error: "conversation_id, tool_call_id, and result are required",
    });
    return;
  }

  if (!conversations.has(conversation_id)) {
    sendJson(res, 404, { error: "Conversation not found" });
    return;
  }

  const conversation = conversations.get(conversation_id);

  // Add the tool result message
  conversation.push({
    role: "tool",
    tool_call_id,
    content:
      typeof result === "string" ? result : JSON.stringify(result),
  });

  // Set up SSE response
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Conversation-ID": conversation_id,
  });

  try {
    const llmResult = await chatCompletionStream(
      conversation,
      [READ_HEALTH_RECORDS_TOOL],
      (event) => {
        sendSSE(res, event.type, event.data);
      },
    );

    // Store assistant response
    const assistantMsg = { role: "assistant", content: llmResult.content };
    if (llmResult.tool_calls) {
      assistantMsg.tool_calls = llmResult.tool_calls;
      assistantMsg.content = null;
    }
    conversation.push(assistantMsg);
  } catch (err) {
    sendSSE(res, "error", { message: err.message });
    sendSSE(res, "done", { finish_reason: "error" });
  }

  res.end();
}

// ─── Request Router ─────────────────────────────────────────────────────────

/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function handleRequest(req, res) {
  setCorsHeaders(res);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // API routes
  if (req.method === "POST" && pathname === "/api/chat") {
    await handleChat(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/tool-result") {
    await handleToolResult(req, res);
    return;
  }

  // Static file serving (GET and HEAD)
  if (req.method === "GET" || req.method === "HEAD") {
    if (serveStatic(res, pathname)) return;
  }

  // 404
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
}

// ─── Server ─────────────────────────────────────────────────────────────────

const server = http.createServer(handleRequest);

server.listen(PORT, HOST, () => {
  console.log(`[chatbot] listening on http://${HOST}:${PORT}`);
  console.log(`[chatbot] serving static files from ${PUBLIC_DIR}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("[chatbot] shutting down...");
  server.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  console.log("[chatbot] shutting down...");
  server.close(() => process.exit(0));
});
