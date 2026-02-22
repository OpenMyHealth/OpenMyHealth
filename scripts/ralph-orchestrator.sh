#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SLEEP_SECONDS="${SLEEP_SECONDS:-5}"

while :; do
  echo "[orchestrator] planner"
  MAX_ITERS=1 bash "$ROOT_DIR/scripts/ralph-loop.sh" planner

  echo "[orchestrator] builder"
  MAX_ITERS=1 bash "$ROOT_DIR/scripts/ralph-loop.sh" builder

  echo "[orchestrator] verifier"
  MAX_ITERS=1 bash "$ROOT_DIR/scripts/ralph-loop.sh" verifier

  echo "[orchestrator] release"
  MAX_ITERS=1 RUN_REVIEW=false bash "$ROOT_DIR/scripts/ralph-loop.sh" release

  sleep "$SLEEP_SECONDS"
done
