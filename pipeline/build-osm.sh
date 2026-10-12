#!/usr/bin/env bash
set -euo pipefail
# --transportation_z13_paths: TGen a z13 disegna tutte le piste e i sentieri;
# planetiler di serie a z13 scarta i tratti corti (7 piste in 13/4337/2985
# contro la rete fitta del PNG). Trovato dalla revisione, 12 ottobre 2026.
# Tile vettoriali OpenStreetMap con planetiler, schema OpenMapTiles.
#
# Lo script mancava dal repo pur essendo citato in CLAUDE.md: il primo
# archivio era stato prodotto a mano. Qui il comando e' fissato, cosi' una
# rigenerazione e' ripetibile.
#
# `--download` NON serve: le sorgenti ausiliarie (lakelines, water polygons,
# natural earth) stanno gia' in data/planetiler-sources dopo il primo giro.
#
# Memoria e file temporanei si regolano con l'ambiente: per l'Italia intera
# servono piu' dei 6 GB delle celle, e i temporanei vanno su un disco veloce.
#   PLANETILER_XMX=16g PLANETILER_TMP=/var/tmp/planetiler build-osm.sh ...
#
# Uso: build-osm.sh <in.pbf> <out-dir> [maxzoom]
IN="${1:?in.pbf}"; OUT="${2:?out-dir}"; ZMAX="${3:-14}"
# planetiler cancella la sua cartella temporanea all'inizio e alla fine: deve
# essere una sottocartella del mount, non il mount stesso ("Device or resource busy")
TMP="${PLANETILER_TMP:-$PWD/data/planetiler-tmp}"
mkdir -p "$OUT" data/planetiler-sources "$TMP"

docker run --rm \
  -v "$PWD/data":/data \
  -v "$TMP":/planetiler-lavoro \
  -e JAVA_TOOL_OPTIONS="-Xmx${PLANETILER_XMX:-6g}" \
  ghcr.io/onthegomap/planetiler:latest \
  --osm-path="/data/${IN#data/}" \
  --output="/data/${OUT#data/}/osm.pmtiles" \
  --maxzoom="$ZMAX" \
  --transportation_z13_paths=true \
  --download \
  --tmpdir=/planetiler-lavoro/tmp \
  --data-dir=/data/planetiler-sources \
  --force

ls -la "$OUT/osm.pmtiles" | awk '{printf "== fatto: %s (%.1f MB)\n", $9, $5/1048576}'
