# Negative Scenarios

## Objective
Verify that invalid requests and blocked states fail safely with correct MCP/status contracts.

## Required Negative Set
| ID | Case | Expected Outcome |
|---|---|---|
| qn01 | invalid tool args shape | MCP error with `INVALID_REQUEST` |
| qn02 | unsupported resource type path | request rejected before MCP read |
| qn03 | vault locked state | MCP error/timeout contract and user-facing retry path |
| qn04 | provider not connected | enqueue rejected with connection guidance |
| qn05 | bridge unavailable/network unavailable | MCP error with `NETWORK_UNAVAILABLE` or timeout |
| qn06 | malformed JSON from server/tool-result continuation | graceful error event, no crash |
| qn07 | overlay unavailable/render failed | MCP error with `CONTENT_SCRIPT_*` code |
| qn08 | runtime exception injection | scenario fails with console/runtime evidence |

## Mandatory Checks
For each negative scenario:
1. Error is explicit and classified.
2. No silent failure.
3. No uncaught runtime exception in page.
4. MCP response remains schema-valid even on error.

## Evidence
- Error code/message snapshot.
- Console/runtime error snapshot.
- User-visible message snapshot.
