/**
 * azure-openai.mjs — Azure OpenAI HTTPS client for the QA chatbot.
 * Zero npm dependencies — uses Node.js built-in `https` and `fs`.
 */

import https from "node:https";
import fs from "node:fs";
import path from "node:path";

// ─── Configuration ──────────────────────────────────────────────────────────

const AZURE_ENDPOINT = "https://persly-eastus2.openai.azure.com";
const DEPLOYMENT = "gpt-5-mini";
const API_VERSION = "2025-04-01-preview";

const CHAT_COMPLETIONS_PATH = `/openai/deployments/${DEPLOYMENT}/chat/completions?api-version=${API_VERSION}`;

// ─── API Key Loading ────────────────────────────────────────────────────────

/**
 * Load the Azure OpenAI API key from environment or .env files.
 * Priority:
 *   1. AZURE_OPENAI_API_KEY env var
 *   2. Project root .env file
 *   3. Fallback: ~/Github/perslyai/persly/.env.local (AZURE_OPENAI_API_KEY_US)
 * @returns {string} The API key
 */
function loadApiKey() {
  // 1. Environment variable
  if (process.env.AZURE_OPENAI_API_KEY) {
    return process.env.AZURE_OPENAI_API_KEY;
  }

  const projectRoot = path.resolve(
    new URL("../../../", import.meta.url).pathname,
  );

  // 2. Project root .env
  const projectEnv = path.join(projectRoot, ".env");
  const key = readKeyFromFile(projectEnv, "AZURE_OPENAI_API_KEY");
  if (key) return key;

  // 3. Fallback .env.local
  const fallbackEnv = path.join(
    process.env.HOME || "",
    "Github/perslyai/persly/.env.local",
  );
  const fallbackKey = readKeyFromFile(fallbackEnv, "AZURE_OPENAI_API_KEY_US");
  if (fallbackKey) return fallbackKey;

  throw new Error(
    "Azure OpenAI API key not found. Set AZURE_OPENAI_API_KEY env var, " +
      "or add it to .env or ~/Github/perslyai/persly/.env.local",
  );
}

/**
 * Read a key=value from a .env-style file.
 * @param {string} filePath
 * @param {string} varName
 * @returns {string|null}
 */
function readKeyFromFile(filePath, varName) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const eqIdx = trimmed.indexOf("=");
      const name = trimmed.slice(0, eqIdx).trim();
      if (name === varName) {
        let value = trimmed.slice(eqIdx + 1).trim();
        // Strip surrounding quotes
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        return value || null;
      }
    }
  } catch {
    // File doesn't exist or isn't readable
  }
  return null;
}

let _cachedApiKey = null;

function getApiKey() {
  if (!_cachedApiKey) {
    _cachedApiKey = loadApiKey();
  }
  return _cachedApiKey;
}

// ─── Tool Definition ────────────────────────────────────────────────────────

/**
 * OpenAI function-calling tool definition for read_health_records.
 * Mirrors the MCP tool from packages/relay/src/handlers.ts.
 */
export const READ_HEALTH_RECORDS_TOOL = {
  type: "function",
  function: {
    name: "read_health_records",
    description: "Read approved health records from local OpenMyHealth vault.",
    parameters: {
      type: "object",
      properties: {
        resource_types: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "Observation",
              "MedicationStatement",
              "Condition",
              "DiagnosticReport",
              "DocumentReference",
            ],
          },
          minItems: 1,
        },
        query: { type: "string" },
        date_from: { type: "string", format: "date-time" },
        date_to: { type: "string", format: "date-time" },
        depth: { type: "string", enum: ["codes", "summary", "detail"] },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: ["resource_types", "depth"],
      additionalProperties: false,
    },
  },
};

// ─── System Prompt ──────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are a helpful health assistant for OpenMyHealth.
You can access the user's health records through the read_health_records tool.

When the user asks about their health data:
1. Call read_health_records with the appropriate resource_types and depth.
2. Summarize the results in a clear, friendly manner.
3. Use "summary" depth by default unless the user asks for detail.

Always be concise and helpful. If the tool returns an error or denied status, explain what happened.
Do not fabricate health data — only use data returned by the tool.`;

// ─── SSE Streaming Parser ───────────────────────────────────────────────────

/**
 * Parse SSE stream chunks and yield parsed data objects.
 * Handles `data: [DONE]` termination and multi-line buffering.
 */
class SSEParser {
  constructor() {
    this._buffer = "";
  }

  /**
   * Feed a chunk into the parser.
   * @param {string} chunk
   * @returns {{ done: boolean, data: object | null }[]}
   */
  feed(chunk) {
    this._buffer += chunk;
    const results = [];
    const lines = this._buffer.split("\n");
    // Keep the last incomplete line in the buffer
    this._buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(":")) continue;
      if (trimmed.startsWith("data: ")) {
        const payload = trimmed.slice(6);
        if (payload === "[DONE]") {
          results.push({ done: true, data: null });
        } else {
          try {
            results.push({ done: false, data: JSON.parse(payload) });
          } catch {
            // Skip malformed JSON
          }
        }
      }
    }
    return results;
  }
}

// ─── Chat Completion ────────────────────────────────────────────────────────

/**
 * Send a streaming chat completion request to Azure OpenAI.
 * Collects the full response from the stream and returns it.
 *
 * @param {Array<{role: string, content: string, tool_call_id?: string, tool_calls?: any[]}>} messages
 * @param {object[]} [tools] - OpenAI function-calling tools
 * @returns {Promise<{ content: string|null, tool_calls: object[]|null, finish_reason: string }>}
 */
export async function chatCompletion(messages, tools) {
  const apiKey = getApiKey();

  const requestBody = {
    messages,
    stream: true,
  };

  if (tools && tools.length > 0) {
    requestBody.tools = tools;
  }

  const bodyStr = JSON.stringify(requestBody);

  const url = new URL(AZURE_ENDPOINT);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        port: 443,
        path: CHAT_COMPLETIONS_PATH,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": apiKey,
          "Content-Length": Buffer.byteLength(bodyStr),
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          let errBody = "";
          res.setEncoding("utf8");
          res.on("data", (c) => { errBody += c; });
          res.on("end", () => {
            reject(
              new Error(
                `Azure OpenAI returned ${res.statusCode}: ${errBody}`,
              ),
            );
          });
          return;
        }

        const parser = new SSEParser();
        let content = "";
        const toolCallsMap = new Map(); // index -> { id, type, function: { name, arguments } }
        let finishReason = "stop";

        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          const events = parser.feed(chunk);
          for (const event of events) {
            if (event.done) continue;
            const choice = event.data?.choices?.[0];
            if (!choice) continue;

            if (choice.finish_reason) {
              finishReason = choice.finish_reason;
            }

            const delta = choice.delta;
            if (!delta) continue;

            // Content delta
            if (delta.content) {
              content += delta.content;
            }

            // Tool call deltas
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index;
                if (!toolCallsMap.has(idx)) {
                  toolCallsMap.set(idx, {
                    id: tc.id || "",
                    type: "function",
                    function: { name: "", arguments: "" },
                  });
                }
                const entry = toolCallsMap.get(idx);
                if (tc.id) entry.id = tc.id;
                if (tc.function?.name) entry.function.name += tc.function.name;
                if (tc.function?.arguments) {
                  entry.function.arguments += tc.function.arguments;
                }
              }
            }
          }
        });

        res.on("end", () => {
          const toolCalls =
            toolCallsMap.size > 0
              ? Array.from(toolCallsMap.entries())
                  .sort(([a], [b]) => a - b)
                  .map(([, v]) => v)
              : null;

          resolve({
            content: content || null,
            tool_calls: toolCalls,
            finish_reason: finishReason,
          });
        });

        res.on("error", reject);
      },
    );

    req.on("error", reject);
    req.write(bodyStr);
    req.end();
  });
}

/**
 * Send a streaming chat completion request and yield SSE events as a callback.
 * Used by the HTTP server to forward SSE events to the browser.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @param {object[]} [tools]
 * @param {(event: { type: 'delta'|'tool_call'|'done'|'error', data: any }) => void} onEvent
 * @returns {Promise<{ content: string|null, tool_calls: object[]|null, finish_reason: string }>}
 */
export async function chatCompletionStream(messages, tools, onEvent) {
  const apiKey = getApiKey();

  const requestBody = {
    messages,
    stream: true,
  };

  if (tools && tools.length > 0) {
    requestBody.tools = tools;
  }

  const bodyStr = JSON.stringify(requestBody);
  const url = new URL(AZURE_ENDPOINT);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        port: 443,
        path: CHAT_COMPLETIONS_PATH,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": apiKey,
          "Content-Length": Buffer.byteLength(bodyStr),
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          let errBody = "";
          res.setEncoding("utf8");
          res.on("data", (c) => { errBody += c; });
          res.on("end", () => {
            const err = new Error(
              `Azure OpenAI returned ${res.statusCode}: ${errBody}`,
            );
            onEvent({ type: "error", data: { message: err.message } });
            reject(err);
          });
          return;
        }

        const parser = new SSEParser();
        let content = "";
        const toolCallsMap = new Map();
        let finishReason = "stop";

        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          const events = parser.feed(chunk);
          for (const event of events) {
            if (event.done) continue;
            const choice = event.data?.choices?.[0];
            if (!choice) continue;

            if (choice.finish_reason) {
              finishReason = choice.finish_reason;
            }

            const delta = choice.delta;
            if (!delta) continue;

            // Content delta — emit immediately for streaming
            if (delta.content) {
              content += delta.content;
              onEvent({ type: "delta", data: { content: delta.content } });
            }

            // Tool call deltas — accumulate
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index;
                if (!toolCallsMap.has(idx)) {
                  toolCallsMap.set(idx, {
                    id: tc.id || "",
                    type: "function",
                    function: { name: "", arguments: "" },
                  });
                }
                const entry = toolCallsMap.get(idx);
                if (tc.id) entry.id = tc.id;
                if (tc.function?.name) entry.function.name += tc.function.name;
                if (tc.function?.arguments) {
                  entry.function.arguments += tc.function.arguments;
                }
              }
            }
          }
        });

        res.on("end", () => {
          const toolCalls =
            toolCallsMap.size > 0
              ? Array.from(toolCallsMap.entries())
                  .sort(([a], [b]) => a - b)
                  .map(([, v]) => v)
              : null;

          // Emit tool_call events for each completed tool call
          if (toolCalls) {
            for (const tc of toolCalls) {
              onEvent({ type: "tool_call", data: tc });
            }
          }

          // Emit done event
          onEvent({
            type: "done",
            data: { finish_reason: finishReason },
          });

          resolve({
            content: content || null,
            tool_calls: toolCalls,
            finish_reason: finishReason,
          });
        });

        res.on("error", (err) => {
          onEvent({ type: "error", data: { message: err.message } });
          reject(err);
        });
      },
    );

    req.on("error", (err) => {
      onEvent({ type: "error", data: { message: err.message } });
      reject(err);
    });

    req.write(bodyStr);
    req.end();
  });
}
