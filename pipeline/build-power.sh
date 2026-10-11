#!/usr/bin/env bash
set -euo pipefail
# Linee elettriche, tralicci e pali dal PBF all'archivio PMTiles.
#
# TGen li disegna da z14 (power.mss di openstreetmap-carto); lo schema
# OpenMapTiles non li porta, quindi si estraggono a parte come i POI. I cavi
# entrano solo se fuori terra, come nel project.mml.
#
# Uso: build-power.sh <pbf> <W> <S> <E> <N> <out.pmtiles>
PBF="${1:?}"; W="${2:?}"; S="${3:?}"; E="${4:?}"; N="${5:?}"; OUT="${6:?}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

for L in linee punti; do
  echo "== estraggo power: $L"
  docker run --rm -v "$PWD":/w -v "$WORK":/out \
    --entrypoint ogr2ogr ghcr.io/osgeo/gdal:ubuntu-small-latest \
    -f GeoJSONSeq "/out/$L.geojsonl" "/w/$PBF" \
    -spat "$W" "$S" "$E" "$N" -lco COORDINATE_PRECISION=6 \
    -sql "@/w/pipeline/power-$L.sql"
  echo "   $(wc -l < "$WORK/$L.geojsonl" | tr -d ' ') elementi"
done

# Un archivio, due layer. Solo z14, il livello da cui TGen li disegna: oltre
# il client li ingrandisce. Nessun limite: un traliccio perso e' un buco
# nella linea.
tippecanoe -o "$WORK/power.mbtiles" --force -q -Z14 -z14 \
  --no-feature-limit --no-tile-size-limit \
  -L "power_line:$WORK/linee.geojsonl" -L "power_point:$WORK/punti.geojsonl"
pmtiles convert "$WORK/power.mbtiles" "$OUT"
ls -la "$OUT" | awk '{printf "== fatto: %s (%.1f MB)\n", $9, $5/1048576}'
