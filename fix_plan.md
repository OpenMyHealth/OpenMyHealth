# fix_plan.md

## P0
- [x] Add browser SMS finalize flow (`encodeData` -> `tknSno` -> `Hira5ySubmitResponse`) without server dependency.
- [ ] Implement full browser-side NICE captcha + SMS code step to obtain `encodeData` automatically.
- [x] Add encrypted local storage vault (AES-GCM via WebCrypto) for normalized records.
- [x] Add provider contract tests with representative DOM fixtures for ChatGPT/Gemini/Claude.

## P1
- [x] Add sidepanel import flow with JSON schema validation and friendly error diagnostics.
- [x] Add timeline compaction and token budget controls for long histories.
- [x] Add telemetry opt-in with strict no-PII policy.

## P2
- [x] Add release automation script for version bump + dist checksum.
- [x] Add i18n scaffolding for Korean/English copy.
- [x] Add visual regression tests for sidepanel UI.
