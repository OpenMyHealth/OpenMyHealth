#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if git ls-files | rg -i '(^|/)sample[1-4]\.json$|(^|/)phr/' >/dev/null; then
  echo "[check:no-phr] blocked: tracked PHR sample files or PHR directory found" >&2
  git ls-files | rg -i '(^|/)sample[1-4]\.json$|(^|/)phr/' >&2
  exit 1
fi

echo "[check:no-phr] ok"
