# Contributing

## Development setup
```bash
pnpm install
pnpm loop:gates
```

## Branch and PR
- Use focused branches and one concern per PR.
- Include tests for behavior changes.
- Keep `fix_plan.md` updated when closing or adding roadmap items.

## Quality requirements
All PRs must pass:
- `pnpm type-check`
- `pnpm lint`
- `pnpm test`
- `pnpm build`

## Security and privacy
- Never include raw medical data in tests, docs, or issue attachments.
- Never add auto-send logic for chatbot messages.
