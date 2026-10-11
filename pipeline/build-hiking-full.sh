#!/usr/bin/env bash
set -euo pipefail
# Percorsi escursionistici numerati: dal PBF all'archivio PMTiles.
#
# `cai_scale` serve allo stile come in hiking_trails.mss: E ed EE tratteggiati,
# EEA a puntini, gli altri continui.
#
# `build-hiking.sh` si ferma al GeoJSONSeq e usa ogr2ogr, che in locale non
# c'e': gira nel container GDAL. Qui la catena e' completa.
#
# Uso: build-hiking-full.sh <pbf> <W> <S> <E> <N> <out.pmtiles> [zmin] [zmax]
PBF="${1:?}"; W="${2:?}"; S="${3:?}"; E="${4:?}"; N="${5:?}"; OUT="${6:?}"
ZMIN="${7:-10}"; ZMAX="${8:-14}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

echo "== estraggo le relazioni route=hiking"
docker run --rm --platform linux/arm64 -v "$PWD":/w -v "$WORK":/out \
  --entrypoint ogr2ogr ghcr.io/osgeo/gdal:ubuntu-small-latest \
  -f GeoJSONSeq /out/hiking.geojsonl "/w/$PBF" \
  -spat "$W" "$S" "$E" "$N" -lco COORDINATE_PRECISION=6 \
  -sql "SELECT osm_id, name,
               hstore_get_value(other_tags, 'ref')         AS ref,
               hstore_get_value(other_tags, 'network')     AS network,
               hstore_get_value(other_tags, 'osmc:symbol') AS osmc_symbol,
               hstore_get_value(other_tags, 'operator')    AS operator,
               hstore_get_value(other_tags, 'cai_scale')   AS cai_scale
        FROM multilinestrings
        WHERE type = 'route'
          AND hstore_get_value(other_tags, 'route') = 'hiking'"
echo "   $(wc -l < "$WORK/hiking.geojsonl") relazioni"

echo "== tiles z${ZMIN}-${ZMAX}"
tippecanoe -o "$WORK/h.mbtiles" --force -l hiking -Z"$ZMIN" -z"$ZMAX" \
  --no-feature-limit --no-tile-size-limit --no-simplification-of-shared-nodes \
  "$WORK/hiking.geojsonl" -q
pmtiles convert "$WORK/h.mbtiles" "$OUT"
echo "== fatto: $OUT ($(du -h "$OUT" | cut -f1))"
