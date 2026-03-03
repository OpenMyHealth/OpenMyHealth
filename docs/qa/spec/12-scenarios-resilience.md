# Resilience Scenarios

## Objective
Validate recovery behavior under lifecycle and timing stress.

## Required Resilience Set
| ID | Case | Expected Outcome |
|---|---|---|
| qr01 | service worker restart before approval | request can recover or fail with explicit contract |
| qr02 | service worker restart after overlay shown | no ghost state, final MCP status resolved |
| qr03 | repeated queue load | ordering preserved, no cross-request contamination |
| qr04 | permission revoke then same request | overlay shown again (no stale always-allow) |
| qr05 | network flap during MCP wait | timeout/error is explicit and retryable path exists |
| qr06 | long session continuity | conversation id continuity and no memory of stale tool call |

## Mandatory Checks
- Request/response mapping stays 1:1.
- No previous scenario state leaks into current scenario.
- Overlay state cleans up after completion.
- MCP result belongs to the active request only.

## Evidence
- before/after state snapshots
- queue length snapshots (if available)
- final MCP response and scenario verdict
