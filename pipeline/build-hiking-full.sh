#!/usr/bin/env bash
set -euo pipefail
# Percorsi escursionistici numerati: dal PBF all'archivio PMTiles.
#
# `cai_scale` serve allo stile come in hiking_trails.mss: E ed EE tratteggiati,
# EEA a puntini, gli altri continui.
#
# Solo i sentieri CAI rilevati, come hiking_trails e hiking_trails_labels del
# project.mml di TGen: `cai_scale` presente e `source` che contiene
# `survey:CAI`. Senza questo filtro il locale disegnava anche la Via
# Francigena, i percorsi IBI e ogni altra relazione escursionistica, e la
# revisione li segnalava da z14 a z16 (12 ottobre 2026).
#
# `build-hiking.sh` si ferma al GeoJSONSeq e usa ogr2ogr, che in locale non
# c'e': gira nel container GDAL. Qui la catena e' completa.
#
# Uso: build-hiking-full.sh <pbf> <W> <S> <E> <N> <out.pmtiles> [zmin] [zmax]
PBF="${1:?}"; W="${2:?}"; S="${3:?}"; E="${4:?}"; N="${5:?}"; OUT="${6:?}"
ZMIN="${7:-10}"; ZMAX="${8:-14}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

echo "== estraggo le relazioni route=hiking"
docker run --rm -v "$PWD":/w -v "$WORK":/out \
  --entrypoint ogr2ogr ghcr.io/osgeo/gdal:ubuntu-small-latest \
  -f GeoJSONSeq /out/hiking.geojsonl "/w/$PBF" \
  -oo CONFIG_FILE=/w/pipeline/osmconf-con-source.ini \
  -spat "$W" "$S" "$E" "$N" -lco COORDINATE_PRECISION=6 \
  -sql "SELECT osm_id, name,
               hstore_get_value(other_tags, 'ref')         AS ref,
               hstore_get_value(other_tags, 'network')     AS network,
               hstore_get_value(other_tags, 'osmc:symbol') AS osmc_symbol,
               hstore_get_value(other_tags, 'operator')    AS operator,
               hstore_get_value(other_tags, 'cai_scale')   AS cai_scale
        FROM multilinestrings
        WHERE type = 'route'
          AND hstore_get_value(other_tags, 'route') = 'hiking'
          AND hstore_get_value(other_tags, 'cai_scale') IS NOT NULL
          AND hstore_get_value(other_tags, 'source') LIKE '%survey:CAI%'"
echo "   $(wc -l < "$WORK/hiking.geojsonl") relazioni"

echo "== tiles z${ZMIN}-${ZMAX}"
tippecanoe -t "${TMPDIR:-/tmp}" -o "$WORK/h.mbtiles" --force -l hiking -Z"$ZMIN" -z"$ZMAX" \
  --no-feature-limit --no-tile-size-limit --no-simplification-of-shared-nodes \
  "$WORK/hiking.geojsonl" -q
pmtiles convert "$WORK/h.mbtiles" "$OUT"
echo "== fatto: $OUT ($(du -h "$OUT" | cut -f1))"
