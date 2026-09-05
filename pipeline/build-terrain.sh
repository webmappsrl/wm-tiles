#!/usr/bin/env bash
set -euo pipefail
# DEM in formato Terrarium: le quote codificate nei canali RGB.
#
#   elevation = (R * 256 + G + B/256) - 32768
#
# Il renderer lo consuma come sorgente `raster-dem` e calcola l'ombreggiatura
# sulla GPU per pixel dello schermo: nessuna immagine precotta, e lo stile
# controlla intensita' e direzione della luce. Funziona sia in MapLibre
# (layer `hillshade`) sia in OpenLayers via ol-mapbox-style.
#
# ATTENZIONE al ricampionamento. I canali RGB codificano un numero, non un
# colore: interpolarli falsifica le quote, quindi il tiling usa `near`. Ma
# tilare con `near` un DEM a passo grosso fa nascere le tile di zoom alto
# dall'overzoom di pochi pixel, e l'ombreggiatura calcolata su quei gradini
# mostra un pattern a blocchi con bordi netti sui confini di tile.
# La soluzione e' interpolare il DEM in float PRIMA della codifica, e farlo
# con CUBICSPLINE, non bilinear. L'ombreggiatura non dipende dalla quota ma
# dalla sua DERIVATA: l'interpolazione bilineare rende continua la quota ma
# lascia la pendenza costante a tratti, con un salto sul bordo di ogni pixel
# del DEM originale, e il risultato e' un reticolo regolare ben visibile ai
# livelli alti. Lo spline cubico rende continua anche la derivata prima.
# Misurato con tools/shade-grid-test.mjs: a z17 l'indice di reticolo passa da
# 183 a 4,9, a z16 da 7,0 a 3,2.
#
# Uso: build-terrain.sh <out-dir> [zoom-min] [zoom-max] [passo-metri]
OUT="${1:?out-dir}"; ZMIN="${2:-8}"; ZMAX="${3:-15}"; STEP="${4:-4}"
cd /work
test -f dem3857.tif || { echo "!! dem3857.tif assente (build-dem-mosaic.sh)" >&2; exit 1; }

echo "== ricampiono il DEM a ${STEP} m (cubicspline), in float"
gdalwarp -overwrite -q -tr "$STEP" "$STEP" -r cubicspline -multi \
  -co COMPRESS=DEFLATE -co TILED=YES dem3857.tif dem_fine.tif
gdalinfo dem_fine.tif | grep -E "Size is|Pixel Size" | sed 's/^/   /'

echo "== codifico le quote in RGB (Terrarium)"
python3 /pipeline/encode-terrarium.py dem_fine.tif terrain.tif

echo "== tiles (resampling near: obbligatorio su quote codificate)"
rm -rf "${OUT}/terrain"
gdal2tiles.py --xyz --zoom="${ZMIN}-${ZMAX}" --resampling=near --processes=4 \
  --tiledriver=PNG --webviewer=none -q terrain.tif "${OUT}/terrain"
echo "== fatto: $(find "${OUT}/terrain" -name '*.png' | wc -l) tile"
