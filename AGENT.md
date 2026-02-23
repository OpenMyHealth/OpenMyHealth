# AGENT.md

## Mission
Build and operate OpenMyHealth as a production-grade Chrome extension that transforms HIRA records into safe, evidence-linked AI chatbot draft context.

## Core Commands
- Install: `pnpm install`
- Type-check: `pnpm type-check`
- Lint: `pnpm lint`
- Test: `pnpm test`
- Build extension: `pnpm build`
- Run all quality gates: `pnpm loop:gates`
- Start Ralph planner loop: `pnpm loop:planner`
- Start Ralph builder loop: `pnpm loop:builder`
- Start Ralph verifier loop: `pnpm loop:verifier`

## Loop Rules
- One critical objective per loop.
- Always align implementation with `specs/*.md`.
- Keep `fix_plan.md` sorted by impact and urgency.
- If a loop fails, capture reason in `fix_plan.md` before next loop.

## Product Guardrails
- Never auto-submit chatbot message; insert draft only.
- Preserve evidence links between summary and source records.
- Do not store raw HIRA payload in remote services.
- Avoid logging personal identifiers.

## Debugging Heuristics
- Provider input not found: review selectors in `src/provider/adapters.ts` and update tests.
- Context quality weak: improve `src/context/build.ts` summarization and evidence selection.
- Parsing mismatch: fix parser functions in `src/hira/browserParser.ts` with unit tests.
