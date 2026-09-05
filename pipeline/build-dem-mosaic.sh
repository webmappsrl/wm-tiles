#!/usr/bin/env bash
set -euo pipefail
# Mosaico multi-DEM: i DEM ad alta risoluzione hanno priorita' su quelli a
# risoluzione grossolana, che restano come riempimento. In gdalbuildvrt vince
# l'ULTIMO file dell'elenco, quindi l'ordine e' dal peggiore al migliore.
#
# Uso: build-dem-mosaic.sh <west> <south> <east> <north> <out-dir>
W="${1:?}"; S="${2:?}"; E="${3:?}"; N="${4:?}"; OUT="${5:?}"
cd /work

# Il mosaico va costruito in un CRS OMOGENEO: gdalbuildvrt scarta in silenzio
# i file con proiezione diversa dal primo. I DEM Copernicus sono in WGS 84,
# quindi si porta tutto in WGS 84 e si riproietta solo il risultato finale.
echo "== riproietto i DEM ad alta risoluzione in EPSG:4326 (come la base)"
HR_WARPED=()
shopt -s nullglob
for F in dem-hr/*.tif; do
  case "$F" in *_4326.tif|*_3857.tif) continue;; esac
  B="$(basename "$F" .tif)"
  gdalwarp -overwrite -q -t_srs EPSG:4326 -r bilinear \
    -co COMPRESS=DEFLATE "$F" "dem-hr/${B}_4326.tif" 2>/dev/null || continue
  HR_WARPED+=("dem-hr/${B}_4326.tif")
  gdalinfo "dem-hr/${B}_4326.tif" | grep "Pixel Size" | sed 's/^/   /'
done

echo "== mosaico: 30 m di base + ${#HR_WARPED[@]} riquadri ad alta risoluzione"
# `-r cubicspline` NON e' un dettaglio: con `-resolution highest` il VRT
# assume la risoluzione del riquadro piu' fine (5 m) e ricampiona il DEM di
# base a 30 m col default `nearest`, duplicando ogni pixel 5-6 volte. Le quote
# escono a gradini, e l'ombreggiatura — che dipende dalla DERIVATA della
# quota, non dalla quota — trasforma quei gradini in un reticolo fitto ben
# visibile da z13 in su. Il `-r bilinear` del gdalwarp successivo arriva
# troppo tardi: i gradini sono gia' dentro il VRT.
gdalbuildvrt -overwrite -resolution highest -r cubicspline \
  dem_mosaic.vrt dem-src/*.tif "${HR_WARPED[@]}"

gdalwarp -overwrite -q -t_srs EPSG:3857 -r cubicspline -multi \
  -te_srs EPSG:4326 -te "$W" "$S" "$E" "$N" \
  -co COMPRESS=DEFLATE dem_mosaic.vrt dem3857.tif
gdalinfo dem3857.tif | grep -E "Size is|Pixel Size"

echo "== hillshade"
gdaldem hillshade -z 1.4 -az 315 -alt 45 -compute_edges -q \
  -co COMPRESS=DEFLATE dem3857.tif hillshade.tif
gdal_translate -q -a_nodata 255 hillshade.tif hillshade_nd.tif
rm -rf "${OUT}/hillshade"
gdal2tiles.py --xyz --zoom=8-15 --resampling=average --processes=4 \
  --tiledriver=PNG --webviewer=none -q hillshade_nd.tif "${OUT}/hillshade"

echo "== curve di livello"
for I in 100 50 25 10; do
  gdal_contour -a ele -i "$I" -f GeoJSON dem3857.tif "${OUT}/contour_${I}.geojson" -q
  python3 -c "
import json, sys
src, step = sys.argv[1], int(sys.argv[2])
g = json.load(open(src))
for f in g['features']:
    ele = int(f['properties'].get('ele') or 0)
    f['properties']['ele'] = ele
    f['properties']['index'] = 1 if (ele % (step * 5) == 0) else 0
json.dump(g, open(src, 'w'))
n = len(g['features'])
print('   %dm: %d linee' % (step, n))
" "${OUT}/contour_${I}.geojson" "$I"
done
echo "== fatto"
