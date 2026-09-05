"""
Codifica un DEM in formato Terrarium: le quote nei canali RGB.

    elevation = (R * 256 + G + B/256) - 32768

Il renderer legge queste tile come sorgente `raster-dem` e calcola
l'ombreggiatura sulla GPU per pixel dello schermo — quindi il rilievo non e'
un'immagine precotta e non sgrana. Funziona in MapLibre (layer `hillshade`) e
in OpenLayers via ol-mapbox-style.

Elabora a blocchi di righe: un DEM a passo fine su un'area regionale supera
facilmente i 500 milioni di pixel, e caricarlo intero in float esaurisce la
memoria (il processo viene ucciso dal kernel).

Uso: encode-terrarium.py <dem-in.tif> <terrain-out.tif> [righe-per-blocco]
"""

import sys

import numpy as np
from osgeo import gdal

gdal.UseExceptions()

src_path, dst_path = sys.argv[1], sys.argv[2]
CHUNK = int(sys.argv[3]) if len(sys.argv) > 3 else 2048

ds = gdal.Open(src_path)
band = ds.GetRasterBand(1)
nodata = band.GetNoDataValue()
w, h = ds.RasterXSize, ds.RasterYSize

dst = gdal.GetDriverByName('GTiff').Create(
    dst_path, w, h, 3, gdal.GDT_Byte,
    options=['COMPRESS=DEFLATE', 'PHOTOMETRIC=RGB', 'TILED=YES', 'BIGTIFF=IF_SAFER'],
)
dst.SetGeoTransform(ds.GetGeoTransform())
dst.SetProjection(ds.GetProjection())

lo, hi = None, None
for y0 in range(0, h, CHUNK):
    rows = min(CHUNK, h - y0)
    ele = band.ReadAsArray(0, y0, w, rows).astype(np.float64)
    if nodata is not None:
        ele = np.where(ele == nodata, 0.0, ele)
    ele = np.nan_to_num(ele, nan=0.0)

    lo = ele.min() if lo is None else min(lo, ele.min())
    hi = ele.max() if hi is None else max(hi, ele.max())

    v = np.clip(ele + 32768.0, 0, 65535.99)
    r = np.floor(v / 256.0).astype(np.uint8)
    g = np.floor(v - r.astype(np.float64) * 256.0).astype(np.uint8)
    b = np.floor((v - np.floor(v)) * 256.0).astype(np.uint8)
    for i, arr in enumerate((r, g, b), start=1):
        dst.GetRasterBand(i).WriteArray(arr, 0, y0)
    del ele, v, r, g, b

dst.FlushCache()
print(f'   {w}x{h}, quote da {lo:.0f} a {hi:.0f} m ({(h + CHUNK - 1) // CHUNK} blocchi)')
