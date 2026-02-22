# fix_plan.md

## P0
- [ ] Implement real browser-side HIRA auth/session flow (SMS + captcha manual entry) to produce `Hira5ySubmitResponse` without server dependency.
- [ ] Add encrypted local storage vault (AES-GCM via WebCrypto) for normalized records.
- [ ] Add provider contract tests with representative DOM fixtures for ChatGPT/Gemini/Claude.

## P1
- [ ] Add sidepanel import flow with JSON schema validation and friendly error diagnostics.
- [ ] Add timeline compaction and token budget controls for long histories.
- [ ] Add telemetry opt-in with strict no-PII policy.

## P2
- [ ] Add release automation script for version bump + dist checksum.
- [ ] Add i18n scaffolding for Korean/English copy.
- [ ] Add visual regression tests for sidepanel UI.
