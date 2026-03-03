# Execution Protocol (Agent-Executed)

## Required Tools
- `agent-browser` for browser actions and screenshots.
- Chrome CDP checks (network, console, runtime state).
- QA chatbot server (`pnpm qa:server`).

## Manual Protocol
1. Run seed: `pnpm qa:seed`
2. Start QA server: `pnpm qa:server`
3. Execute scenarios from Markdown specs one-by-one.
4. For each scenario, collect required evidence artifacts.
5. Mark each checklist item pass/fail with concrete reason.
6. Repeat full scenario set for an independent second run.

## agent-browser Flow Example
```bash
agent-browser open http://127.0.0.1:3939/?provider=chatgpt
agent-browser wait --load networkidle
agent-browser snapshot -i
agent-browser fill @e1 "최근 혈액검사 결과를 알려줘"
agent-browser click @e2
```

## CDP Validation Points
For MCP scenarios, confirm all:
- Tool call card appears with expected args.
- Overlay appears in extension content script.
- Overlay action result matches scenario.
- Tool result JSON includes MCP response.
- MCP status and resource payload shape match contract.
- No uncaught console/runtime exception.

## Evidence Storage Rules
- Create run directory: `qa/chatbot/runs/<run-id>/`
- Mandatory run files:
  - `run-summary.md`
  - `run-metadata.json`
- Mandatory per-scenario files:
  - `scenario-<id>.md`
  - `tool-call-<id>.json`
  - `mcp-result-<id>.json`
  - `assistant-output-<id>.txt`
  - `console-<id>.log`
  - `screenshot-<id>-*.png`

## Strict Gate (Manual)
- Full scenario set must pass in two independent runs.
- A run fails immediately if any scenario check fails.
- Missing evidence file counts as failure.
