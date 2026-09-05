#!/usr/bin/env bash
set -euo pipefail
# Sfondo raster: uso suolo colorato con l'ombreggiatura e la pendenza GIA' FUSE.
#
# Perche' fondere invece di sovrapporre: Mapnik compone hillshade e slope con
# `comp-op: multiply` / `overlay`, che MapLibre non ha. Riprodurli come layer
# neri con alpha non funziona perche' gdal2tiles sovrascrive il canale alpha
# (lo usa come maschera dei pixel validi, non come trasparenza). Fondendo in
# generazione il risultato e' identico a Mapnik e serve un solo layer raster.
#
#   out = landcover * (1 - k_hs * (1 - hs/255)) * (1 - k_sl * slope/45)
#
# k_hs e k_sl sono le opacita' di webmapp.mss: hs 0.18 (z<=13) / 0.30 (z>=14),
# slope 0.15 a z>=14. Si generano due varianti perche' i pesi cambiano per zoom.
#
# Uso: build-basemap-raster.sh <out-dir>
OUT="${1:?out-dir}"
cd /work
test -f lc_rgba.tif   || { echo "!! lc_rgba.tif assente (build-landcover.sh)" >&2; exit 1; }
test -f hillshade.tif || { echo "!! hillshade.tif assente (build-dem-mosaic.sh)" >&2; exit 1; }
test -f slope.tif     || { echo "!! slope.tif assente (build-slope.sh)" >&2; exit 1; }

echo "== allineo hillshade e slope alla griglia dell'uso suolo"
python3 - <<'PY'
from osgeo import gdal
gdal.UseExceptions()
ref = gdal.Open('lc_rgba.tif')
gt, prj, w, h = ref.GetGeoTransform(), ref.GetProjection(), ref.RasterXSize, ref.RasterYSize
te = [gt[0], gt[3] + gt[5] * h, gt[0] + gt[1] * w, gt[3]]
for src, dst in (('hillshade.tif', 'hs_al.tif'), ('slope.tif', 'sl_al.tif')):
    gdal.Warp(dst, src, width=w, height=h, outputBounds=te, dstSRS=prj,
              resampleAlg='bilinear', creationOptions=['COMPRESS=DEFLATE'])
    print(f'   {dst}: {w}x{h}')
PY

echo "== fondo (due varianti: zoom basso e zoom alto)"
python3 - <<'PY'
from osgeo import gdal
import numpy as np
gdal.UseExceptions()

lc = gdal.Open('lc_rgba.tif')
rgb = [lc.GetRasterBand(i).ReadAsArray().astype(np.float32) for i in (1, 2, 3)]
# I dataset vanno tenuti in una variabile: in catena GDAL li garbage-collecta
# prima della lettura e ReadAsArray fallisce con un TypeError sulla banda.
ds_hs = gdal.Open('hs_al.tif')
ds_sl = gdal.Open('sl_al.tif')
hs = ds_hs.GetRasterBand(1).ReadAsArray().astype(np.float32) / 255.0
sl = np.clip(ds_sl.GetRasterBand(1).ReadAsArray().astype(np.float32) / 45.0, 0, 1)
h, w = hs.shape

def write(path, k_hs, k_sl):
    shade = (1.0 - k_hs * (1.0 - hs)) * (1.0 - k_sl * sl)
    drv = gdal.GetDriverByName('GTiff')
    dst = drv.Create(path, w, h, 3, gdal.GDT_Byte,
                     options=['COMPRESS=DEFLATE', 'PHOTOMETRIC=RGB', 'TILED=YES'])
    dst.SetGeoTransform(lc.GetGeoTransform())
    dst.SetProjection(lc.GetProjection())
    for i in range(3):
        band = np.clip(rgb[i] * shade, 0, 255).astype(np.uint8)
        dst.GetRasterBand(i + 1).WriteArray(band)
    dst.FlushCache()
    print(f'   {path}: hs={k_hs} slope={k_sl}, luminosita media {shade.mean():.3f}')

write('base_lo.tif', 0.18, 0.0)   # z8-13:  hs25m 0.18, nessuna pendenza
write('base_hi.tif', 0.30, 0.15)  # z14+:   hs10m 0.30 + slope10m 0.15
PY

echo "== tiles"
rm -rf "${OUT}/base"
gdal2tiles.py --xyz --zoom=8-13 --resampling=average --processes=4 \
  --tiledriver=PNG --webviewer=none -q base_lo.tif "${OUT}/base"
gdal2tiles.py --xyz --zoom=14-15 --resampling=average --processes=4 \
  --tiledriver=PNG --webviewer=none -q base_hi.tif "${OUT}/base"
echo "== fatto: $(find "${OUT}/base" -name '*.png' | wc -l) tile"
