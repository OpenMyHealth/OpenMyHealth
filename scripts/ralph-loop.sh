#!/usr/bin/env bash
set -euo pipefail

ROLE="${1:-unknown}"
echo "[ralph-loop] role=${ROLE}"
pnpm loop:gates
