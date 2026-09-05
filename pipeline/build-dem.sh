#!/usr/bin/env bash
set -euo pipefail
# Rilievo per l'area demo: hillshade (tiles raster) e curve di livello (GeoJSON).
#
# DEM: Copernicus GLO-30 (30 m), COG pubblici su S3, nessuna registrazione.
#      Attribuzione: © DLR e/o © ESA — Copernicus DEM.
#      In produzione i DEM Webmapp su TGen (2/5/10 m dove disponibili) sono
#      migliori: questa e' la variante che si puo' costruire senza accessi.
#
# Uso: build-dem.sh <west> <south> <east> <north> <out-dir>

W="${1:?west}"; S="${2:?south}"; E="${3:?east}"; N="${4:?north}"
OUT="${5:?out-dir}"
ZMIN=8; ZMAX=13

mkdir -p "$OUT" /work/dem-src
cd /work

# 1. riquadri Copernicus necessari (1x1 grado)
for LAT in $(seq "${S%.*}" "${N%.*}"); do
  for LON in $(seq "${W%.*}" "${E%.*}"); do
    T=$(printf "N%02d_00_E%03d" "$LAT" "$LON")
    F="dem-src/Copernicus_DSM_COG_10_${T}_00_DEM.tif"
    if [ ! -f "$F" ]; then
      echo "== scarico $T"
      # curl non c'e' nell'immagine GDAL: si usa python, che c'e' sempre
      python3 -c "
import sys, urllib.request
url, dst = sys.argv[1], sys.argv[2]
try:
    urllib.request.urlretrieve(url, dst)
    print('   scaricato')
except Exception as e:
    print('   riquadro non disponibile (mare o fuori copertura):', e)
    sys.exit(0)
" "https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_${T}_00_DEM/Copernicus_DSM_COG_10_${T}_00_DEM.tif" "$F"
    fi
  done
done

# 2. mosaico e riproiezione in Web Mercator, ritagliato al bbox
gdalbuildvrt -overwrite dem.vrt dem-src/*.tif
gdalwarp -overwrite -t_srs EPSG:3857 -r bilinear -multi \
  -te_srs EPSG:4326 -te "$W" "$S" "$E" "$N" \
  -co COMPRESS=DEFLATE dem.vrt dem3857.tif

# 3. hillshade: -z 1.5 attenua l'effetto, il riferimento raster e' tenue
gdaldem hillshade -z 1.5 -az 315 -alt 45 -compute_edges -co COMPRESS=DEFLATE \
  dem3857.tif hillshade.tif

# 255 = pianura piatta: va reso trasparente, altrimenti l'hillshade
# spegne i colori dello sfondo dove non c'e' rilievo.
gdal_translate -a_nodata 255 hillshade.tif hillshade_nd.tif

gdal2tiles.py --xyz --zoom="${ZMIN}-${ZMAX}" --resampling=average \
  --processes=4 --tiledriver=PNG --webviewer=none \
  hillshade_nd.tif "${OUT}/hillshade"

# 4. curve di livello: equidistanza per fascia di zoom
#    (in produzione diventano vector tiles; qui GeoJSON, l'area e' piccola)
for I in 100 50 25; do
  gdal_contour -a ele -i "$I" -f GeoJSON dem3857.tif "contour_${I}.geojson" -q
  # marca le curve indice (multipli di 5 intervalli): lo stile le disegna
  # piu' spesse e con la quota
  python3 - "contour_${I}.geojson" "$I" "${OUT}/contour_${I}.geojson" <<'PY'
import json, sys
src, step, dst = sys.argv[1], int(sys.argv[2]), sys.argv[3]
g = json.load(open(src))
for f in g['features']:
    ele = f['properties'].get('ele') or 0
    f['properties']['index'] = 1 if (ele % (step * 5) == 0) else 0
    f['properties']['ele'] = int(ele)
json.dump(g, open(dst, 'w'))
print(f"  contour {step}m: {len(g['features'])} linee -> {dst}")
PY
done

echo "== fatto:"
du -sh "${OUT}"/hillshade "${OUT}"/contour_*.geojson
