#!/usr/bin/env bash
set -euo pipefail
# Tile Terrarium allineate alla risoluzione del livello di zoom MASSIMO.
#
# Le quote sono numeri codificati nei canali RGB, quindi il tiling deve usare
# `near`: interpolare i canali falsa il dato (il canale B avvolge ogni metro).
# Ma `near` su un DEM piu' grosso della tile produce gradini, e la pendenza
# calcolata su gradini vale zero dentro il blocco ed esplode sui bordi: da qui
# il reticolo visibile nell'ombreggiatura ai livelli alti.
#
# La cura ha due parti.
#
# 1. Interpolare in FLOAT prima di codificare, alla risoluzione esatta del
#    livello massimo richiesto (156543.03 / 2^z metri per pixel), cosi' il
#    tiling e' 1:1 e non resta aliasing.
#
# 2. Interpolare con CUBICSPLINE, non bilinear. E' il punto decisivo:
#    l'ombreggiatura non dipende dalla quota ma dalla sua DERIVATA, e
#    l'interpolazione bilineare rende continua la quota lasciando la pendenza
#    costante a tratti, con un salto sul bordo di ogni pixel del DEM
#    originale. Il risultato e' un reticolo regolare, tanto piu' largo quanto
#    piu' grossolano e' il DEM di partenza. Lo spline cubico rende continua
#    anche la derivata prima e il reticolo sparisce.
#
# Uso: build-terrain-zoom.sh <out-dir> <zoom-min> <zoom-max> [W S E N]
OUT="${1:?out-dir}"; ZMIN="${2:?zoom-min}"; ZMAX="${3:?zoom-max}"
cd /work
test -f dem3857.tif || { echo "!! dem3857.tif assente (build-dem-mosaic.sh)" >&2; exit 1; }

# Ogni livello ha il SUO ricampionamento. gdal2tiles costruisce i livelli
# sotto quello massimo decimando con `near` (un pixel ogni quattro): e'
# aliasing, e ricrea il reticolo che il cubicspline aveva tolto. Generare
# ciascun livello dal DEM in float alla risoluzione che gli compete costa
# qualche warp in piu' e li' il problema non si pone.
SRC=dem3857.tif
if [ $# -ge 7 ]; then
  W="$4"; S="$5"; E="$6"; N="$7"
  echo "== ritaglio ${W},${S},${E},${N}"
  gdalwarp -overwrite -q -t_srs EPSG:3857 -te_srs EPSG:4326 -te "$W" "$S" "$E" "$N" \
    -co COMPRESS=DEFLATE dem3857.tif dem_crop.tif
  SRC=dem_crop.tif
fi

rm -rf "${OUT}/terrain-nuovo"
for Z in $(seq "$ZMIN" "$ZMAX"); do
  STEP=$(python3 -c "print(156543.033928/(2**${Z}))")
  echo "== z${Z}: ${STEP} m/pixel (cubicspline, float)"
  gdalwarp -overwrite -q -tr "$STEP" "$STEP" -r cubicspline -multi \
    -co COMPRESS=DEFLATE -co TILED=YES -co BIGTIFF=IF_SAFER "$SRC" "dem_z${Z}.tif"
  python3 /pipeline/encode-terrarium.py "dem_z${Z}.tif" "terrain_z${Z}.tif"
  gdal2tiles.py --xyz --zoom="${Z}-${Z}" --resampling=near --processes=4 \
    --tiledriver=PNG --webviewer=none -q "terrain_z${Z}.tif" "${OUT}/terrain-nuovo"
  rm -f "dem_z${Z}.tif" "terrain_z${Z}.tif"
done
echo "== fatto: $(find "${OUT}/terrain-nuovo" -name '*.png' | wc -l) tile"
