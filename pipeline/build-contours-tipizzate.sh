#!/usr/bin/env bash
set -euo pipefail
# Curve di livello con la STESSA struttura di quelle di TGen.
#
# `contours-tgen.pmtiles` (importato) porta `quota` e `type`, dove `type`
# distingue le direttrici dalle secondarie: `cp50`/`cs50` a z13, `cp25`/`cs25`
# da z14. Lo stile ci si appoggia per larghezza ed etichette, quindi curve
# generate senza quei campi fanno sparire le direttrici.
#
# Qui si generano dal nostro DEM con la stessa convenzione, cosi' coprono
# qualunque area senza dipendere da un'importazione.
#
# Uso: build-contours-tipizzate.sh <dem.tif> <out.pmtiles>
DEM="${1:?dem.tif}"; OUT="${2:?out.pmtiles}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

for I in 50 25; do
  echo "== curve ogni ${I} m"
  docker run --rm -v "$PWD":/w -v "$WORK":/out \
    --entrypoint bash ghcr.io/osgeo/gdal:ubuntu-small-latest -c "
      gdal_contour -a quota -i $I -f GeoJSONSeq -q /w/${DEM#./} /out/c${I}.geojsonl
    "
  # `type`: cp = direttrice (ogni 100 m, quella che porta l'etichetta), cs = secondaria
  jq -c --arg i "$I" '
    .properties.quota = (.properties.quota | floor)
    | .properties.type = (if (.properties.quota % 100) == 0 then "cp" else "cs" end) + $i
  ' "$WORK/c${I}.geojsonl" > "$WORK/t${I}.geojsonl"
  echo "   $(wc -l < "$WORK/t${I}.geojsonl") linee"
done

# z13 usa le 50 m, z14+ le 25 m: due sorgenti nello stesso layer, ciascuna
# sulla propria fascia, come i tre layer contourlines_* del riferimento
echo "== tiles"
tippecanoe -o "$WORK/c.mbtiles" -l contour \
  -Z 10 -z 13 --drop-densest-as-needed --force -q "$WORK/t50.geojsonl"
tippecanoe -o "$WORK/c2.mbtiles" -l contour \
  -Z 14 -z 15 --drop-densest-as-needed --force -q "$WORK/t25.geojsonl"
tile-join -o "$WORK/tutte.mbtiles" --force -q "$WORK/c.mbtiles" "$WORK/c2.mbtiles"
pmtiles convert "$WORK/tutte.mbtiles" "$OUT"
ls -la "$OUT" | awk '{printf "== fatto: %s (%.1f MB)\n", $9, $5/1048576}'
