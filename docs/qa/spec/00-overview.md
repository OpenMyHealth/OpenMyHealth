# OpenMyHealth QA Spec Overview

## Goal
This specification defines a production-grade QA workflow for `qa/chatbot` with data-level verification.

The workflow validates the full path:
1. Chat input is sent.
2. LLM emits a `read_health_records` tool call.
3. MCP bridge sends request to extension.
4. Overlay action is executed (`approve`, `deny`, `timeout`).
5. MCP result is returned through `MessagePort`.
6. Assistant response is generated from MCP result.

## Scope
- In scope: `qa/chatbot` web app, extension MCP bridge, overlay lifecycle, MCP data contract.
- Out of scope: direct automation on `chatgpt.com` or `claude.ai`.

## QA Layers
- Gate A (Deterministic, mandatory): seeded fixtures + MCP contract checks + scenario checklist pass.
- Gate B (Live dependency smoke, mandatory): same scenario path with live LLM API connectivity.

## Principles
- Spec-driven first: Markdown scenario is the source of truth.
- Data-level assertions are mandatory for every MCP scenario.
- Evidence completeness is mandatory: no scenario is valid without artifacts.
- Zero tolerance on contract violation and console/runtime exceptions.

## Required Evidence
For each scenario:
- Chat input.
- Tool call arguments snapshot.
- Overlay action evidence.
- MCP result JSON snapshot.
- Assistant final text.
- Per-check pass/fail reasons.

## Execution Modes
- Primary mode: AI coding agent executes scenario steps from Markdown using `agent-browser` + CDP checks.
- E2E automation exists separately under `e2e/` and is not a QA gate substitute.

## Related Files
- `docs/qa/spec/01-environment-setup.md`
- `docs/qa/spec/02-seeding-and-fixtures.md`
- `docs/qa/spec/03-execution-protocol.md`
- `docs/qa/spec/10-scenarios-core.md`
- `docs/qa/spec/11-scenarios-negative.md`
- `docs/qa/spec/12-scenarios-resilience.md`
- `docs/qa/spec/20-exit-criteria.md`
- `docs/qa/spec/artifacts-schema.md`
