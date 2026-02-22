#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-builder}"
MAX_ITERS="${MAX_ITERS:-0}"
SLEEP_SECONDS="${SLEEP_SECONDS:-2}"
LOOP_DIR="${ROOT_DIR}/.loop"
PROMPT_FILE="${ROOT_DIR}/ralph/prompts/${MODE}.md"
RUN_GATES="${RUN_GATES:-true}"
RUN_REVIEW="${RUN_REVIEW:-true}"
AUTO_GIT="${AUTO_GIT:-false}"

mkdir -p "$LOOP_DIR"

if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "prompt file not found: $PROMPT_FILE"
  exit 1
fi

if ! command -v codex >/dev/null 2>&1; then
  echo "codex CLI not found"
  exit 1
fi

iteration=1
while :; do
  if [[ "$MAX_ITERS" != "0" && "$iteration" -gt "$MAX_ITERS" ]]; then
    echo "max iterations reached: $MAX_ITERS"
    exit 0
  fi

  ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  log_path="${LOOP_DIR}/${MODE}-${iteration}.jsonl"

  cat > "${LOOP_DIR}/loop_state.json" <<STATE
{"mode":"${MODE}","iteration":${iteration},"startedAt":"${ts}","status":"running"}
STATE

  echo "[loop][$MODE][$iteration] codex exec"
  codex exec \
    --cd "$ROOT_DIR" \
    --json \
    "$(cat "$PROMPT_FILE")" | tee "$log_path"

  if [[ "$RUN_GATES" == "true" ]]; then
    echo "[loop][$MODE][$iteration] gates"
    if ! bash "${ROOT_DIR}/scripts/run-gates.sh"; then
      cat > "${LOOP_DIR}/loop_state.json" <<STATE
{"mode":"${MODE}","iteration":${iteration},"endedAt":"$(date -u +"%Y-%m-%dT%H:%M:%SZ")","status":"failed-gates"}
STATE
      echo "gates failed"
      exit 1
    fi
  fi

  if [[ "$RUN_REVIEW" == "true" ]]; then
    echo "[loop][$MODE][$iteration] codex review"
    codex review --uncommitted "Find correctness, regression, security, and missing test risks." || true
  fi

  if [[ "$AUTO_GIT" == "true" ]]; then
    if [[ -n "$(git status --porcelain)" ]]; then
      git add -A
      git commit -m "chore: openchart ${MODE} loop iteration ${iteration}" || true
      git push || true
    fi
  fi

  cat > "${LOOP_DIR}/loop_state.json" <<STATE
{"mode":"${MODE}","iteration":${iteration},"endedAt":"$(date -u +"%Y-%m-%dT%H:%M:%SZ")","status":"passed"}
STATE

  echo "[loop][$MODE][$iteration] done"
  iteration=$((iteration + 1))
  sleep "$SLEEP_SECONDS"
done
