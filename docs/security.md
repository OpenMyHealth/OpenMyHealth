# OpenMyHealth Security Model

## Core Principles
- Local-first storage: health records are stored in browser local storage encrypted by AES-GCM.
- Explicit approval: only user-approved records are transformed into AI context.
- Minimum necessary context: search + ranking selects a small candidate set before approval.
- Sensitive token masking: common identifiers are redacted before context injection.
- Transparency log: every approved transfer is logged locally with timestamp/query/record count.

## Data Boundaries
- Stored locally (encrypted): normalized records, source sync state, transfer audit logs.
- Not stored by OpenMyHealth backend: raw PHR payloads from source pages.
- Sent to AI platform: only the approved, redacted context block.

## Threats Mitigated
- Over-sharing by default -> approval gate + minimal context generation
- Silent exfiltration -> explicit preview + local transfer audit log
- Accidental PII leakage -> redaction pass before insertion

## Out of Scope
- Compromised user browser profile or malicious local extensions
- Account compromise on AI provider side
