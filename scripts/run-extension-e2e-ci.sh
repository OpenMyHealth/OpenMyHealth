#!/usr/bin/env bash
set -euo pipefail

if command -v xvfb-run >/dev/null 2>&1; then
  xvfb-run -a pnpm test:e2e:extension
else
  pnpm test:e2e:extension
fi
