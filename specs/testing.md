# Testing Spec

## Unit
- Context normalization and summary generation.
- Provider detection and draft insertion behavior.
- HIRA HTML parser robustness for numeric/empty fields.

## Integration
- Background message handlers with mocked chrome runtime.
- Sidepanel build/insert flow with fake runtime responses.

## Release Gate
- `pnpm loop:gates` must pass before release candidate.
