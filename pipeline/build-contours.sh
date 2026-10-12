#!/usr/bin/env bash
set -euo pipefail
# Curve di livello -> vector tiles PMTiles, con equidistanza per fascia di zoom.
# Prerequisiti locali: tippecanoe, pmtiles. La riproiezione usa GDAL in container.
# Uso: build-contours.sh <dem-dir> <out-pmtiles>
IN="${1:?dir con i contour_*.geojson in EPSG:3857}"
OUT="${2:?file pmtiles di destinazione}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 1. da EPSG:3857 a 4326, semplificate e con precisione ridotta:
#    un GeoJSON di curve non semplificato e' decine di MB e non serve a nessuno
for I in 100 50 25 10; do
  echo "== riproietto e semplifico contour ${I}m"
  docker run --rm -v "$PWD":/w -v "$WORK":/out \
    --entrypoint ogr2ogr ghcr.io/osgeo/gdal:ubuntu-small-latest \
    -f GeoJSONSeq -t_srs EPSG:4326 -simplify 3 \
    -lco COORDINATE_PRECISION=5 \
    "/out/c${I}.geojsonl" "/w/${IN}/contour_${I}.geojson"
  ls -la "$WORK/c${I}.geojsonl" | awk '{print "   "$5" byte"}'
done

# 2. una fascia di zoom per equidistanza: curve dense a scala piccola
#    sarebbero illeggibili e pesantissime
# Equidistanza dimezzata rispetto alla prima versione: 100 m a scala piccola,
# 50 m a media, 25 m al massimo dettaglio — il riferimento raster ha questa
# densita', con l'indice ogni 5 intervalli.
tippecanoe -o "$WORK/c100.mbtiles" --force -l contour -Z10 -z11 \
  --no-feature-limit --no-tile-size-limit --no-simplification-of-shared-nodes \
  "$WORK/c100.geojsonl" -q
tippecanoe -o "$WORK/c50.mbtiles" --force -l contour -Z12 -z13 \
  --no-feature-limit --no-tile-size-limit --no-simplification-of-shared-nodes \
  "$WORK/c50.geojsonl" -q
tippecanoe -o "$WORK/c25.mbtiles" --force -l contour -Z14 -z14 \
  --no-feature-limit --no-tile-size-limit --no-simplification-of-shared-nodes \
  "$WORK/c25.geojsonl" -q
# 10 m solo al massimo dettaglio: possibile perche' il mosaico ha un DTM a 5 m
tippecanoe -o "$WORK/c10.mbtiles" --force -l contour -Z15 -z15 \
  --no-feature-limit --no-tile-size-limit --no-simplification-of-shared-nodes \
  "$WORK/c10.geojsonl" -q

tile-join -o "$WORK/contours.mbtiles" --force \
  "$WORK/c100.mbtiles" "$WORK/c50.mbtiles" "$WORK/c25.mbtiles" "$WORK/c10.mbtiles" -q

# 3. mbtiles -> pmtiles, il formato che il servizio legge
pmtiles convert "$WORK/contours.mbtiles" "$OUT"
echo "== fatto: $OUT ($(du -h "$OUT" | cut -f1))"
pmtiles show "$OUT" | head -12
