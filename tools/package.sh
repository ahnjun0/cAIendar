#!/usr/bin/env bash
# Chrome Web Store 제출용 zip 만들기. 개발 파일(test/scripts/tools/문서/스토어 이미지)은 뺀다.
#   ./tools/package.sh   →  dist/caiendar-v<버전>.zip
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./manifest.json').version")
OUT="dist/caiendar-v${VERSION}.zip"

echo "테스트 먼저"
npm test >/dev/null

rm -rf dist
mkdir -p dist
zip -qr "$OUT" \
  manifest.json \
  icons \
  src \
  -x 'src/**/.DS_Store' -x '.DS_Store'

echo "만들어짐: $OUT ($(du -h "$OUT" | cut -f1))"
unzip -l "$OUT" | tail -1
