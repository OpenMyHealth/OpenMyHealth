#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  VERSION="v$(node -p "require('./package.json').version")"
fi

if ! [[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "invalid version format: $VERSION" >&2
  exit 1
fi

ZIP_NAME="openmyhealth-${VERSION}.zip"
SHA_NAME="${ZIP_NAME}.sha256"

pnpm loop:full
pnpm test:e2e:extension:ci

rm -f "$ZIP_NAME" "$SHA_NAME"
(
  cd dist
  zip -r "../${ZIP_NAME}" . >/dev/null
)

shasum -a 256 "$ZIP_NAME" > "$SHA_NAME"
pnpm release:verify-checksum "$ZIP_NAME"

echo "release dry-run complete"
echo "artifact: $ZIP_NAME"
echo "checksum: $SHA_NAME"
