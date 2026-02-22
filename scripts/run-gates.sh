#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[gate] type-check"
pnpm type-check

echo "[gate] lint"
pnpm lint

echo "[gate] test"
pnpm test

echo "[gate] build"
pnpm build

echo "[gate] all passed"
