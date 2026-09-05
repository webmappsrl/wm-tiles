#!/usr/bin/env bash
set -euo pipefail
# Uso suolo da ESA WorldCover 2021 (10 m, S3 pubblico) reso come tile raster
# colorate con la palette della carta Webmapp.
#
# Compromesso dichiarato: i colori sono cotti nelle tile, quindi questo layer
# non e' personalizzabile per app come lo sono i layer vettoriali. Per l'uso
# suolo e' accettabile (e' uno sfondo areale continuo, come l'hillshade); se
# servisse la personalizzazione va poligonizzato e servito come vector tiles.
#
# Uso: build-landcover.sh <west> <south> <east> <north> <out-dir>
W="${1:?}"; S="${2:?}"; E="${3:?}"; N="${4:?}"; OUT="${5:?}"
cd /work

echo "== mosaico e ritaglio"
gdalbuildvrt -overwrite -q lc.vrt landcover-src/*.tif
gdalwarp -overwrite -q -t_srs EPSG:3857 -r near -multi \
  -te_srs EPSG:4326 -te "$W" "$S" "$E" "$N" \
  -co COMPRESS=DEFLATE lc.vrt lc3857.tif
gdalinfo lc3857.tif | grep -E "Size is|Pixel Size"

echo "== applico la palette"
gdaldem color-relief -q -alpha -exact_color_entry \
  lc3857.tif /pipeline/landcover-palette.txt lc_rgba.tif

echo "== tiles"
rm -rf "${OUT}/landcover"
gdal2tiles.py --xyz --zoom=8-15 --resampling=average --processes=4 \
  --tiledriver=PNG --webviewer=none -q lc_rgba.tif "${OUT}/landcover"
echo "== fatto: $(find "${OUT}/landcover" -name '*.png' | wc -l) tile"
