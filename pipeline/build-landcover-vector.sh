#!/usr/bin/env bash
set -euo pipefail
# Uso suolo VETTORIALE: da ESA WorldCover (raster 10 m) a poligoni con la
# classe come attributo, cosi' lo stile decide i colori e non sgrana a nessuno
# zoom. Le classi WorldCover sono tradotte nei `coduso` di webmapp.mss.
#
# Uso: build-landcover-vector.sh <out-geojsonl>
OUT="${1:?out-geojsonl}"
cd /work
test -f lc3857.tif || { echo "!! lc3857.tif assente (build-landcover.sh)" >&2; exit 1; }

echo "== riduco la risoluzione a 20 m: a 10 m i poligoni sarebbero milioni"
gdalwarp -overwrite -q -tr 20 20 -r mode lc3857.tif lc20.tif

echo "== poligonizzo"
gdal_polygonize.py -q -8 lc20.tif -f GPKG lc_poly.gpkg lc class

echo "== semplifico, riproietto, traduco le classi in coduso"
rm -f "$OUT"
ogr2ogr -f GeoJSONSeq "$OUT" lc_poly.gpkg \
  -t_srs EPSG:4326 -simplify 12 -lco COORDINATE_PRECISION=5 \
  -sql @/pipeline/landcover.sql
echo "== poligoni: $(wc -l < "$OUT")"
