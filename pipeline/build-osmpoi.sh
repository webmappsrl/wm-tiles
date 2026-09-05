#!/usr/bin/env bash
set -euo pipefail
# POI puntuali dal PBF all'archivio PMTiles.
#
# Lo script mancava: il primo archivio era stato prodotto a mano, e senza di
# esso una rigenerazione su un'area nuova non era ripetibile.
#
# Uso: build-osmpoi.sh <pbf> <W> <S> <E> <N> <out.pmtiles> [zmin] [zmax]
PBF="${1:?}"; W="${2:?}"; S="${3:?}"; E="${4:?}"; N="${5:?}"; OUT="${6:?}"
ZMIN="${7:-11}"; ZMAX="${8:-14}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

echo "== estraggo i POI"
docker run --rm -v "$PWD":/w -v "$WORK":/out \
  --entrypoint ogr2ogr ghcr.io/osgeo/gdal:ubuntu-small-latest \
  -f GeoJSONSeq /out/poi.geojsonl "/w/$PBF" \
  -spat "$W" "$S" "$E" "$N" -lco COORDINATE_PRECISION=6 \
  -sql @/w/pipeline/osmpoi.sql
echo "   $(wc -l < "$WORK/poi.geojsonl") punti"

# `kind` si compone qui: OGRSQL non ha COALESCE
jq -c '.properties |= (
   {name: .name, kind: (.t_natural // .t_tourism // .t_amenity // (if .t_pass == "yes" then "mountain_pass" else null end)), ele: .ele}
   | with_entries(select(.value != null))
 )' "$WORK/poi.geojsonl" > "$WORK/poi2.geojsonl"
mv "$WORK/poi2.geojsonl" "$WORK/poi.geojsonl"

echo "== tiles z${ZMIN}-${ZMAX}"
tippecanoe -o "$WORK/osmpoi.mbtiles" -l osmpoi \
  -Z "$ZMIN" -z "$ZMAX" --drop-densest-as-needed --force -q \
  "$WORK/poi.geojsonl"
pmtiles convert "$WORK/osmpoi.mbtiles" "$OUT"
ls -la "$OUT" | awk '{printf "== fatto: %s (%.1f MB)\n", $9, $5/1048576}'
