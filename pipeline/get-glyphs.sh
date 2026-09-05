#!/usr/bin/env bash
set -euo pipefail
# Glifi PBF per MapLibre. Non sono versionati (circa 100 MB): si riscaricano.
# Fonte: openmaptiles/fonts, licenza dei font rispettiva (Noto = SIL OFL).
OUT="${1:-style/glyphs}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "== scarico i glifi OpenMapTiles v2.0"
curl -sSL -o "$TMP/fonts.zip" \
  "https://github.com/openmaptiles/fonts/releases/download/v2.0/v2.0.zip"

mkdir -p "$OUT"
for F in "Noto Sans Regular" "Noto Sans Bold" "Noto Sans Italic"; do
  unzip -q -o "$TMP/fonts.zip" "$F/*" -d "$OUT/"
  echo "   $F"
done
echo "== glifi in $OUT ($(du -sh "$OUT" | cut -f1))"
