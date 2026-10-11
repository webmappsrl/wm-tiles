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
# I punti dei cartellini entrano nello stesso layer `roadslz`, marcati
# `scudo=1`; i layer delle strade escludono `scudo`.
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

# I numeri delle strade per i cartellini: OpenMapTiles a z11-z12 non li porta
# (a z11 solo le autostrade, e senza `ref`), mentre il riferimento li mostra
# da z10 (autostrade), z11 (superstrade e primarie) e z12 (secondarie). Layer
# a parte e senza scarti per densita': un cartellino perso e' un buco visibile.
echo "== estraggo i numeri delle strade"
docker run --rm --platform linux/arm64 -v "$PWD":/w -v "$WORK":/out \
  --entrypoint ogr2ogr ghcr.io/osgeo/gdal:ubuntu-small-latest \
  -f GeoJSONSeq -t_srs EPSG:4326 -spat "$W" "$S" "$E" "$N" \
  -lco COORDINATE_PRECISION=6 \
  -sql "SELECT highway AS class, hstore_get_value(other_tags,'ref') AS ref, 1 AS scudo \
        FROM lines \
        WHERE highway IN ('motorway','trunk','primary','secondary') \
          AND hstore_get_value(other_tags,'ref') IS NOT NULL" \
  /out/ref.geojsonl "/w/$PBF"
wc -l < "$WORK/ref.geojsonl" | awk '{print "   "$1" tratti numerati"}'
# Punti, non linee: ol-mapbox-style 11 piazza l'icona su una linea solo se
# occupa piu' di 150 pixel, e alle scale basse le vie OSM sono lunghe pochi
# pixel. Il centro di ogni via, a 250 pixel dagli altri con lo stesso numero
# per ogni livello (pipeline/punti-cartellini.py).
# I cartellini arrivano a z12 (le secondarie hanno il numero solo li'), un
# livello oltre le strade: la soglia di ogni punto e' nel dato e vale
# esattamente solo se il livello ha tile proprie.
python3 pipeline/punti-cartellini.py "$WORK/ref.geojsonl" "$WORK/ref-punti.geojsonl" 10 12
tippecanoe -o "$WORK/ref.mbtiles" --force -l roadslz -Z10 -z12 \
  --no-feature-limit --no-tile-size-limit "$WORK/ref-punti.geojsonl" -q
tile-join -o "$WORK/tutto.mbtiles" --force -q --no-tile-size-limit "$WORK/r.mbtiles" "$WORK/ref.mbtiles"

pmtiles convert "$WORK/tutto.mbtiles" "$OUT"
echo "== fatto: $OUT ($(du -h "$OUT" | cut -f1))"
