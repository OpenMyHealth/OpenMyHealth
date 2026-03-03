# Core Scenarios

All core scenarios use the template in `templates/scenario-template.md`.

## Coverage Matrix
| ID | Intent | Expected Tool Call | Overlay Action | MCP Status |
|---|---|---|---|---|
| qc01 | Blood test summary | Observation + depth=summary | approve | ok |
| qc02 | Medication summary | MedicationStatement | approve | ok |
| qc03 | Condition summary | Condition | approve | ok |
| qc04 | User denies access | resource_types>=1 | deny | denied |
| qc05 | User does not respond | resource_types>=1 | timeout | timeout |
| qc06 | Multi-resource request | resource_types length>=2 | approve | ok |
| qc07 | Detail request | depth=detail | approve | ok |
| qc08 | Greeting only | no tool call | none | n/a |
| qc09 | Date-filtered query | date_from contains 2024 | approve | ok |
| qc10 | Codes depth | depth=codes | approve | ok |

## Scenario Detail Requirements
For each scenario, always capture:
1. Chat input text used.
2. Raw tool call args from tool card JSON.
3. Overlay action evidence.
4. MCP result JSON from tool result block.
5. Assistant final response text.

## Data-Level Assertions
For MCP `ok` scenarios:
- `schema_version === "1.0"`
- `status === "ok"`
- `resources` is an array
- `count` is integer >= 0
- `meta.total_available`, `meta.filtered_count`, `meta.query_matched` exist

Additional per scenario:
- `qc01`: Observation data contains numeric values.
- `qc02`: MedicationStatement data has dose-like values (`value` + `unit`).
- `qc03`: Condition data has textual clinical content (`display` or `notes`).
- `qc06`: At least Observation and MedicationStatement resource groups are present.
- `qc07`: `depth === "detail"` and `count > 0`.
- `qc09`: metadata exists and request args include date filter.
- `qc10`: `depth === "codes"` and records retain stable `id` fields.

## Assistant Output Assertions
Assistant output is validated in structure/fact mode:
- Must not be empty.
- Must reflect scenario topic and MCP outcome.
- Must not contradict MCP status (for example, no data claim when status is denied/timeout).

## Pass Rule
A scenario passes only when all checklist items pass.
Any single failed checklist item means scenario fail.
