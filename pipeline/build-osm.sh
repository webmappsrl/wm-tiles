#!/usr/bin/env bash
set -euo pipefail
# Tile vettoriali OpenStreetMap con planetiler, schema OpenMapTiles.
#
# Lo script mancava dal repo pur essendo citato in CLAUDE.md: il primo
# archivio era stato prodotto a mano. Qui il comando e' fissato, cosi' una
# rigenerazione e' ripetibile.
#
# `--download` NON serve: le sorgenti ausiliarie (lakelines, water polygons,
# natural earth) stanno gia' in data/planetiler-sources dopo il primo giro.
#
# Uso: build-osm.sh <in.pbf> <out-dir> [maxzoom]
IN="${1:?in.pbf}"; OUT="${2:?out-dir}"; ZMAX="${3:-14}"
mkdir -p "$OUT" data/planetiler-sources data/planetiler-tmp

docker run --rm \
  -v "$PWD/data":/data \
  -e JAVA_TOOL_OPTIONS=-Xmx6g \
  ghcr.io/onthegomap/planetiler:latest \
  --osm-path="/data/${IN#data/}" \
  --output="/data/${OUT#data/}/osm.pmtiles" \
  --maxzoom="$ZMAX" \
  --download \
  --tmpdir=/data/planetiler-tmp \
  --data-dir=/data/planetiler-sources \
  --force

ls -la "$OUT/osm.pmtiles" | awk '{printf "== fatto: %s (%.1f MB)\n", $9, $5/1048576}'
