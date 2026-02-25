#!/usr/bin/env bash
set -euo pipefail

if [[ $# -gt 0 ]]; then
  target="$1"
  if [[ ! -f "$target" ]]; then
    echo "target file not found: $target" >&2
    exit 1
  fi
  shasum -a 256 "$target"
  exit 0
fi

if [[ ! -d dist ]]; then
  echo "dist directory not found" >&2
  exit 1
fi

find dist -type f -print0 | sort -z | xargs -0 shasum -a 256
