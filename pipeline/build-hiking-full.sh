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

# I numeri dei sentieri come punti ruotati posizionati come Mapnik
# (punti-lungo-linee.py): lungo la linea OpenLayers prova posizioni fisse e ne
# scartava molti ("489", "488" in 16/34660/23411, giro italia1). Dimensioni,
# spaziature (Mapnik: 400/300/250 px) e spostamento sopra la linea sono quelli
# gia' tarati sul layer hiking-ref; da z14, quindi l'archivio arriva a z16.
PL="python3 -I $(dirname "$0")/punti-lungo-linee.py $WORK/hiking.geojsonl"
GL="--glifi $(dirname "$0")/../style/glifi-larghezze.json B"
$PL "$WORK/r14.geojsonl" --testo ref --zoom 14-14 --spaziatura 400 --dimensione 9 --dy -3 --angolo 60 $GL
$PL "$WORK/r15.geojsonl" --testo ref --zoom 15-15 --spaziatura 300 --dimensione 10.5 --dy -3.5 --angolo 60 $GL
$PL "$WORK/r16.geojsonl" --testo ref --zoom 16-16 --spaziatura 250 --dimensione 12 --dy -4 --angolo 60 $GL
cat "$WORK"/r1[456].geojsonl > "$WORK/numeri.geojsonl"

echo "== tiles z${ZMIN}-${ZMAX}"
tippecanoe -t "${TMPDIR:-/tmp}" -o "$WORK/h.mbtiles" --force -Z"$ZMIN" -z"$ZMAX" -r1 \
  --no-feature-limit --no-tile-size-limit --no-simplification-of-shared-nodes \
  -L hiking:"$WORK/hiking.geojsonl" -L hiking_ref:"$WORK/numeri.geojsonl" -q
pmtiles convert "$WORK/h.mbtiles" "$OUT"
echo "== fatto: $OUT ($(du -h "$OUT" | cut -f1))"
