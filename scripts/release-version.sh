#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INPUT_VERSION="${1:-}"
TAG_RELEASE="${TAG_RELEASE:-false}"

if [[ -z "$INPUT_VERSION" ]]; then
  echo "usage: scripts/release-version.sh <version>"
  echo "example: scripts/release-version.sh 0.2.0"
  exit 1
fi

VERSION="${INPUT_VERSION#v}"
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "invalid semver: $INPUT_VERSION"
  exit 1
fi

cd "$ROOT_DIR"

node -e '
  const fs = require("fs");
  const version = process.argv[1];
  const packagePath = "package.json";
  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  pkg.version = version;
  fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + "\n");
' "$VERSION"

echo "[release] version set to $VERSION"

pnpm build

mkdir -p artifacts
ZIP_PATH="artifacts/openchart-v${VERSION}.zip"
SHA_PATH="${ZIP_PATH}.sha256"

rm -f "$ZIP_PATH" "$SHA_PATH"
(
  cd dist
  zip -rq "../$ZIP_PATH" .
)

shasum -a 256 "$ZIP_PATH" > "$SHA_PATH"

echo "[release] artifact: $ZIP_PATH"
echo "[release] checksum: $SHA_PATH"

if [[ "$TAG_RELEASE" == "true" ]]; then
  git add package.json pnpm-lock.yaml
  git commit -m "chore: openchart v${VERSION} 릴리즈 버전 반영" || true
  git tag "v${VERSION}" -f
  echo "[release] git tag updated: v${VERSION}"
fi
