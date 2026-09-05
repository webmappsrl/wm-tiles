#!/usr/bin/env bash
set -euo pipefail
# Percorsi escursionistici numerati dalle relazioni OSM `route=hiking`.
#
# Lo schema OpenMapTiles non estrae le relazioni di percorso, quindi i numeri
# dei sentieri (639, 00, 643A…) non sono nelle tile prodotte da planetiler.
# Qui si legge il .osm.pbf con il driver OSM di GDAL, che assembla le relazioni
# nel layer `multilinestrings`, e si tiene `ref`, `name`, `network` e `osmc:symbol`.
#
# Uso: build-hiking.sh <pbf> <west> <south> <east> <north> <out-geojsonl>
PBF="${1:?}"; W="${2:?}"; S="${3:?}"; E="${4:?}"; N="${5:?}"; OUT="${6:?}"

ogr2ogr -f GeoJSONSeq "$OUT" "$PBF" \
  -spat "$W" "$S" "$E" "$N" \
  -lco COORDINATE_PRECISION=6 \
  -sql "SELECT osm_id,
               name,
               hstore_get_value(other_tags, 'ref')         AS ref,
               hstore_get_value(other_tags, 'network')     AS network,
               hstore_get_value(other_tags, 'osmc:symbol') AS osmc_symbol,
               hstore_get_value(other_tags, 'operator')    AS operator
        FROM multilinestrings
        WHERE type = 'route'
          AND hstore_get_value(other_tags, 'route') = 'hiking'"

echo "== relazioni estratte: $(wc -l < "$OUT")"
head -1 "$OUT" | python3 -c "import json,sys; print('   esempio:', json.load(sys.stdin)['properties'])" 2>/dev/null || true
