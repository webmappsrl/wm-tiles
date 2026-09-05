#!/usr/bin/env bash
set -euo pipefail
# Hillshade riprodotto come MOLTIPLICATIVO.
#
# Mapnik compone lo sfumo con `raster-comp-op: multiply`, che MapLibre non ha:
# sovrapporre l'immagine grigia in modalita' normale schiarisce dove il fondo e'
# scuro e appiattisce i colori. L'equivalenza esatta si ottiene generando
# un'immagine NERA il cui canale alpha e' l'intensita' dell'ombra:
#
#   multiply:  out = fondo * (hs/255)
#   nero su fondo con alpha a:  out = fondo * (1-a)
#   quindi:  a = 1 - hs/255   ->   alpha = 255 - hs
#
# Il risultato e' identico al moltiplicativo, con l'opacita' del layer che
# regola l'intensita' come in Mapnik.
#
# Uso: build-hillshade-multiply.sh <out-dir> [zoom-min] [zoom-max]
OUT="${1:?out-dir}"; ZMIN="${2:-8}"; ZMAX="${3:-15}"
cd /work

test -f hillshade.tif || { echo "!! hillshade.tif assente: eseguire prima build-dem-mosaic.sh" >&2; exit 1; }

echo "== compongo RGBA: nero con alpha = 255 - hillshade"
python3 - <<'PY'
from osgeo import gdal
import numpy as np
gdal.UseExceptions()

src = gdal.Open('hillshade.tif')
hs = src.GetRasterBand(1).ReadAsArray()
h, w = hs.shape

# alpha = intensita' dell'ombra. 255 (pieno sole) -> alpha 0 (trasparente)
alpha = (255 - hs.astype(np.int16)).clip(0, 255).astype(np.uint8)
black = np.zeros((h, w), dtype=np.uint8)

drv = gdal.GetDriverByName('GTiff')
dst = drv.Create('hillshade_mul.tif', w, h, 4, gdal.GDT_Byte,
                 options=['COMPRESS=DEFLATE', 'PHOTOMETRIC=RGB', 'ALPHA=YES'])
dst.SetGeoTransform(src.GetGeoTransform())
dst.SetProjection(src.GetProjection())
for i in (1, 2, 3):
    dst.GetRasterBand(i).WriteArray(black)
    dst.GetRasterBand(i).SetColorInterpretation(
        [gdal.GCI_RedBand, gdal.GCI_GreenBand, gdal.GCI_BlueBand][i - 1])
dst.GetRasterBand(4).WriteArray(alpha)
# Senza dichiarare la banda come alpha, gdal2tiles la tratta come un colore
# e produce tile NERE OPACHE: il layer non moltiplica l'ombra, spalma nero.
dst.GetRasterBand(4).SetColorInterpretation(gdal.GCI_AlphaBand)
dst.FlushCache()
print(f"   {w}x{h}, alpha min={alpha.min()} max={alpha.max()} media={alpha.mean():.1f}")
PY

echo "== tiles"
rm -rf "${OUT}/hillshade-mul"
gdal2tiles.py --xyz --zoom="${ZMIN}-${ZMAX}" --resampling=average --processes=4 \
  --tiledriver=PNG --webviewer=none -q hillshade_mul.tif "${OUT}/hillshade-mul"
echo "== fatto: $(find "${OUT}/hillshade-mul" -name '*.png' | wc -l) tile"
