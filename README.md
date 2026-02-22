# openChart

`openChart` is a Chrome Extension that converts HIRA (Korean health insurance) records into evidence-linked context drafts for AI chatbots such as ChatGPT, Gemini, and Claude.

## What it does now
- Parses HIRA-style payload into normalized records.
- Builds structured context packets (`summary`, `timeline`, `medications`, `evidence`, `safety note`).
- Inserts draft text into provider input boxes (manual review before send).
- Includes browser-compatible HIRA parser, authenticated-session fetch client, and in-browser RSA encryption utility for HIRA auth flow.
- Includes Ralph++ Codex loop scripts for continuous agentic execution.

## Project principles
- Local-first: no mandatory server upload of medical records.
- Human-in-the-loop: draft insertion only, never auto-send.
- Evidence-first: every draft includes source snippets.
- Safety baseline: clear medical safety notice in every draft.

## Setup
```bash
pnpm install
pnpm type-check
pnpm lint
pnpm test
pnpm build
```

## Load extension
1. Run `pnpm build`
2. Open `chrome://extensions`
3. Enable Developer Mode
4. Click `Load unpacked`
5. Select `dist/`

## Ralph++ loop execution (Codex)
### Run a single mode indefinitely
```bash
pnpm loop:builder
```

### Run finite iterations
```bash
MAX_ITERS=3 pnpm loop:verifier
```

### Disable gates or review temporarily
```bash
RUN_GATES=false RUN_REVIEW=false pnpm loop:builder
```

Loop state and logs are stored in `.loop/`.

## Current limitations
- Full browser-side HIRA SMS/Kakao auth flow is not completed yet.
- Side panel currently assumes JSON payload input for context generation.
- Provider selectors may require updates when chatbot DOM changes.

## Source provenance
Original `hira5y` implementation is copied from Persly internal implementation for portability analysis under:
- `references/hira5y-original/hira5y/*`
- `references/hira5y-original/nicePhoneCertification/*`

