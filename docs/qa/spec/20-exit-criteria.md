# Strict Exit Criteria

A QA cycle is complete only if all criteria are satisfied.

## Gate Criteria
1. Seed step succeeds and fixture summary meets expected resource coverage.
2. Gate A deterministic scenarios pass 100% with zero skips.
3. Gate B live dependency smoke passes 100% with zero skips.
4. Two independent full runs pass consecutively.

## Quality Criteria
1. `failed checks == 0`.
2. `failed scenarios == 0`.
3. MCP contract violations == 0.
4. Console/runtime exceptions == 0.
5. Missing artifact fields == 0.

## Defect Criteria
1. No open P0 defects.
2. No open P1 defects affecting MCP path, overlay action, or data integrity.

## Data Integrity Criteria
1. Tool-call args match scenario spec.
2. MCP status matches scenario action outcome.
3. MCP payload shape remains valid for `ok`, `denied`, `timeout`, and `error`.
4. Assistant response reflects MCP status correctly.

## Stability Criteria
1. Two consecutive full strict runs pass.
2. No intermittent failure within those runs.

## Exit Artifact Set
- `run-summary.md` for each attempt.
- `run-metadata.json` for each attempt.
- Per-scenario artifacts (`scenario-<id>.md`, tool/mcp/output/console/screenshot files).
- Seed summary JSON.
