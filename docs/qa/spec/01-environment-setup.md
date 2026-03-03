# Environment Setup

## Preconditions
- Node.js >= 22
- pnpm >= 10
- Chrome with remote debugging on port `9222`
- Extension loaded and running
- Azure OpenAI API key configured for `qa/chatbot`

## Step 1. Install and build
```bash
pnpm install
pnpm wxt:build
```

## Step 2. Start Chrome for CDP QA
Use the project standard launch command:
```bash
pnpm dev:e2e
```

Verify CDP:
```bash
curl -sS http://127.0.0.1:9222/json/version
curl -sS http://127.0.0.1:9222/json/list
```

## Step 3. Load extension and initialize vault
1. Open `chrome://extensions`.
2. Enable developer mode.
3. Load unpacked extension from `.output/chrome-mv3` for production-like QA.
4. Complete setup flow (PIN and vault landing).

## Step 4. Start chatbot server
```bash
pnpm qa:server
```

Verify chatbot server:
```bash
curl -I http://127.0.0.1:3939/
```

## Step 5. Verify agent-browser availability
```bash
agent-browser --help
```

## Step 6. Verify QA preflight
```bash
pnpm qa:seed
agent-browser open http://127.0.0.1:3939/?provider=chatgpt
agent-browser snapshot -i
```

## Common Failures
- `CDP not reachable on 9222`:
  - ensure `pnpm dev:e2e` is still running.
- `MCP not ready`:
  - verify extension is loaded in the active Chrome profile.
- `Chatbot server not reachable`:
  - start `qa/chatbot/chatbot-server.mjs`.
- `Azure key missing`:
  - set `AZURE_OPENAI_API_KEY` or project `.env` key.
