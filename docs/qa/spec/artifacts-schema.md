# Artifact Schema (Manual QA)

## Run Directory
Each QA execution creates:
- `qa/chatbot/runs/<run-id>/`

Required top-level files:
- `run-summary.md`
- `run-metadata.json`

`run-metadata.json` required fields:
- `run_id`
- `executed_at`
- `executor` (agent id/name)
- `provider`
- `seed_summary`
- `scenario_ids`
- `summary` (`pass`/`fail`, counts)

## Per-Scenario Artifacts
For each scenario id `<id>`, required files:
- `scenario-<id>.md`
- `tool-call-<id>.json`
- `mcp-result-<id>.json`
- `assistant-output-<id>.txt`
- `console-<id>.log`
- `screenshot-<id>-*.png` (at least 1)

## scenario-<id>.md Required Sections
- Metadata (id/category/priority)
- Input
- Expected
- Observed
- Checklist (pass/fail + reason)
- Verdict (`pass`/`fail`)

## Failure Rules
- Missing required file => scenario fail.
- Missing required section/field => scenario fail.
- Any failed checklist item => scenario fail.
