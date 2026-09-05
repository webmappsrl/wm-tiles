#!/usr/bin/env bash
set -euo pipefail
# Strato di pendenza: in webmapp.mss e' `#slope10m [zoom>=14]` con
# raster-opacity 0.15 e comp-op **overlay**. Overlay non esiste in MapLibre;
# la componente utile e' lo scurimento dei versanti ripidi, quindi si rende
# come nero con alpha proporzionale alla pendenza (come per l'hillshade
# moltiplicativo): le zone pianeggianti restano trasparenti.
#
# Uso: build-slope.sh <out-dir> [zoom-min] [zoom-max]
OUT="${1:?out-dir}"; ZMIN="${2:-13}"; ZMAX="${3:-15}"
cd /work
test -f dem3857.tif || { echo "!! dem3857.tif assente" >&2; exit 1; }

echo "== pendenza in gradi"
gdaldem slope -q -co COMPRESS=DEFLATE dem3857.tif slope.tif

echo "== compongo RGBA: nero con alpha proporzionale alla pendenza"
python3 - <<'PY'
from osgeo import gdal
import numpy as np
gdal.UseExceptions()
src = gdal.Open('slope.tif')
sl = src.GetRasterBand(1).ReadAsArray().astype(np.float32)
h, w = sl.shape
# 0 gradi -> trasparente; 45 gradi e oltre -> alpha piena.
# Il fattore finale e' l'opacita' del layer (0.15), qui si normalizza solo.
alpha = np.clip(sl / 45.0, 0, 1)
alpha = (alpha * 255).astype(np.uint8)
black = np.zeros((h, w), dtype=np.uint8)
drv = gdal.GetDriverByName('GTiff')
dst = drv.Create('slope_mul.tif', w, h, 4, gdal.GDT_Byte,
                 options=['COMPRESS=DEFLATE', 'PHOTOMETRIC=RGB', 'ALPHA=YES'])
dst.SetGeoTransform(src.GetGeoTransform()); dst.SetProjection(src.GetProjection())
for i in (1, 2, 3):
    dst.GetRasterBand(i).WriteArray(black)
    dst.GetRasterBand(i).SetColorInterpretation(
        [gdal.GCI_RedBand, gdal.GCI_GreenBand, gdal.GCI_BlueBand][i - 1])
dst.GetRasterBand(4).WriteArray(alpha)
# Senza dichiarare la banda come alpha, gdal2tiles la tratta come un colore
# e produce tile NERE OPACHE: il layer non moltiplica l'ombra, spalma nero.
dst.GetRasterBand(4).SetColorInterpretation(gdal.GCI_AlphaBand)
dst.FlushCache()
print(f"   pendenza max {sl.max():.1f} gradi, alpha media {alpha.mean():.1f}")
PY

rm -rf "${OUT}/slope"
gdal2tiles.py --xyz --zoom="${ZMIN}-${ZMAX}" --resampling=average --processes=4 \
  --tiledriver=PNG --webviewer=none -q slope_mul.tif "${OUT}/slope"
echo "== fatto: $(find "${OUT}/slope" -name '*.png' | wc -l) tile"
