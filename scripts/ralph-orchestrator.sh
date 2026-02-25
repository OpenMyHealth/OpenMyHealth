#!/usr/bin/env bash
set -euo pipefail

echo "[ralph-orchestrator] running full local QA"
pnpm loop:gates
