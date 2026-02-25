#!/usr/bin/env bash
set -euo pipefail

pnpm type-check
pnpm lint
pnpm test
pnpm build
pnpm validate:dist
