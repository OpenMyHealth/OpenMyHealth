# Seeding And Fixtures

## Objective
Seed deterministic vault data before strict QA so MCP responses can be checked at data level.

## Seed Command
```bash
pnpm qa:seed
```

Options:
```bash
node qa/chatbot/seed-fixtures.mjs --json
node qa/chatbot/seed-fixtures.mjs --clear-only
node qa/chatbot/seed-fixtures.mjs --provider chatgpt
node qa/chatbot/seed-fixtures.mjs --keep-existing
```

## Seed Inputs
The seeder uploads these fixtures:
- `e2e/data/sample-lab-report.txt` -> expected `Observation`
- `e2e/data/sample-medication.txt` -> expected `MedicationStatement`
- `e2e/data/sample-condition.txt` -> expected `Condition`
- `e2e/data/sample-report.txt` -> expected `DiagnosticReport`
- `qa/chatbot/fixtures/docref-note.txt` -> expected `DocumentReference`

## Mandatory Seed Validation
After seeding, `vault:get-state.summary` must include:
- `Observation >= 1`
- `MedicationStatement >= 1`
- `Condition >= 1`
- `DiagnosticReport >= 1`
- `DocumentReference >= 1`

If any expected resource count is missing, strict QA must stop.

## Seed Safety Rules
- Default behavior clears existing vault files before upload.
- Use `--keep-existing` only for exploratory runs.
- Strict QA runs must use clean seed state (no residual files).

## Seed Evidence
Archive:
- Seeder stdout JSON.
- Uploaded file IDs.
- Final vault summary snapshot.
