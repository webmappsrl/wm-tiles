#!/usr/bin/env bash
set -euo pipefail
# Toponimi minori e sorgenti da OSM.
#
# Lo schema OpenMapTiles filtra per rango e lascia fuori localita', case
# sparse, fonti e sorgenti che nel riferimento sono presenti a z14. Qui si
# leggono direttamente dal .osm.pbf con il driver OSM di GDAL.
#
# Uso: build-places.sh <pbf> <west> <south> <east> <north> <out-geojsonl>
PBF="${1:?}"; W="${2:?}"; S="${3:?}"; E="${4:?}"; N="${5:?}"; OUT="${6:?}"
rm -f "$OUT"

ogr2ogr -f GeoJSONSeq "$OUT" "$PBF" \
  -spat "$W" "$S" "$E" "$N" \
  -lco COORDINATE_PRECISION=6 \
  -sql @/pipeline/places.sql

echo "== toponimi estratti: $(wc -l < "$OUT")"
