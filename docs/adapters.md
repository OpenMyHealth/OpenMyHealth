# OpenMyHealth Adapter Guide

## Goal
Add a country/source integration that can:
1. guide users on the official source page,
2. parse records locally in browser,
3. normalize records into OpenMyHealth + FHIR resources.

## Interface
Implement `SourceAdapter` in `src/shared/adapters/<id>.ts`.
Use `src/shared/adapters/template.ts` as a base.

## Rules
- Never automate user credentials or bypass source auth flows.
- Parse only after the user is already on the official source page.
- Keep parsing local; do not transmit raw source records to external servers.
- Preserve original fields under `raw` for auditability.
- Add at least one unit test for code normalization and one for mapping output shape.

## Registration
Add your adapter to `src/shared/adapters/index.ts`.

## Suggested Mapping Pattern
- Source diagnosis code -> `Condition.code.coding[]`
- Source medication rows -> `MedicationStatement`
- Source procedure rows -> `Procedure`
- Unknown fields -> keep in `raw`

## Pull Request Checklist
- [ ] Adapter implemented
- [ ] Tests added and passing
- [ ] `pnpm type-check && pnpm test` passing
- [ ] No remote code / no secret handling added
