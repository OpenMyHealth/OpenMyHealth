# Scenario Template

## Metadata
- Scenario ID:
- Category: core | negative | resilience
- Priority: P0 | P1 | P2

## Objective
Describe what behavior this scenario validates.

## Preconditions
- Environment state
- Seed dataset state
- Provider and session state

## Inputs
- Chat input text:
- Additional context (if any):

## Expected Tool Call
- Tool name:
- Required args:
- Forbidden args:

## Expected Overlay Behavior
- Overlay expected: yes | no
- Expected action: approve | deny | timeout | none

## Expected MCP Result
- Expected status:
- Required resource groups:
- Required fields:
- Forbidden fields:

## Expected Assistant Output
- Required factual cues:
- Forbidden contradictions:

## Execution Steps
1. Step 1
2. Step 2
3. Step 3

## Checks
- [ ] toolCallCorrectness
- [ ] mcpRequestSent
- [ ] overlayAppeared
- [ ] overlayAction
- [ ] mcpResponseReceived
- [ ] responseQuality
- [ ] noConsoleErrors
- [ ] roundtripTime
- [ ] mcpStatus
- [ ] mcpDataContract
- [ ] conversationContinuity

## Evidence
- Tool call args snapshot:
- MCP result JSON snapshot:
- Assistant final output snapshot:
- Console/runtime snapshot:

## Pass/Fail Rule
Scenario passes only when all checks are pass.
