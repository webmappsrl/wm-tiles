#!/usr/bin/env bash
set -euo pipefail
# Strade per i livelli di zoom bassi, dove lo schema OpenMapTiles non le porta.
#
# Il riferimento rende da un database completo e a z10 disegna una rete fitta:
# strade secondarie, comunali, piste e sentieri. Lo schema OpenMapTiles filtra
# per zoom e sulla stessa area porta 8 primary + 1 secondary a z10, contro 28
# secondary + 76 tertiary + 214 minor a z12. Non e' correggibile con lo stile:
# i dati non ci sono.
#
# Qui le strade si estraggono dal PBF con il driver OSM di GDAL e si tilano con
# tippecanoe, che rispetta i livelli richiesti. L'archivio serve SOLO le fasce
# basse: da z12 in poi bastano quelle di OpenMapTiles.
#
# Uso: build-roads-lowzoom.sh <pbf> <W> <S> <E> <N> <out.pmtiles> [zmin] [zmax]
PBF="${1:?pbf}"; W="${2:?W}"; S="${3:?S}"; E="${4:?E}"; N="${5:?N}"; OUT="${6:?out}"
ZMIN="${7:-8}"; ZMAX="${8:-11}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

echo "== estraggo le strade da $PBF"
docker run --rm --platform linux/arm64 -v "$PWD":/w -v "$WORK":/out \
  --entrypoint ogr2ogr ghcr.io/osgeo/gdal:ubuntu-small-latest \
  -f GeoJSONSeq -t_srs EPSG:4326 -spat "$W" "$S" "$E" "$N" \
  -lco COORDINATE_PRECISION=6 \
  -sql "SELECT highway AS class, name, hstore_get_value(other_tags,'ref') AS ref \
        FROM lines \
        WHERE highway IN ('secondary','tertiary','unclassified','residential', \
                          'track','path','footway','service','living_street')" \
  /out/roads.geojsonl "/w/$PBF"
wc -l < "$WORK/roads.geojsonl" | awk '{print "   "$1" strade"}'

echo "== tiles z${ZMIN}-${ZMAX}"
# --drop-densest-as-needed evita tile enormi ai livelli bassi mantenendo la
# trama della rete, che e' cio' che conta a quelle scale
tippecanoe -o "$WORK/r.mbtiles" --force -l roadslz -Z"$ZMIN" -z"$ZMAX" \
  --drop-densest-as-needed --no-simplification-of-shared-nodes \
  --simplification=4 "$WORK/roads.geojsonl" -q

pmtiles convert "$WORK/r.mbtiles" "$OUT"
echo "== fatto: $OUT ($(du -h "$OUT" | cut -f1))"
