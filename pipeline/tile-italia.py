"""Quali tile PNG rendere per l'Italia: quelle che TGen ha generato e che
toccano l'Italia.

TGen ha generato a mano, cella per cella (un grado), e lo ha scritto
nell'inventario grid_1x1: da z13 a z16 si rendono le tile delle celle che TGen
ha generato a quel livello. I livelli fino a z12 sono del 2018 e coprono tutto:
si rendono tutte le tile che toccano l'Italia. Le zone estere generate da TGen
non interessano (stato.md), e nelle celle di confine si rende solo cio' che
tocca l'Italia: fuori i nostri dati non ci sono (uso suolo, quote), e una tile
estera rifatta peggiorerebbe.

L'Italia e' il confine OSM di Italia, San Marino e Vaticano, con le acque
territoriali: le tile di mare vicino alla costa si rifanno come la costa.
Per ogni livello il confine si disegna su una griglia in cui un pixel e' una
tile, con ALL_TOUCHED: entra ogni tile che il confine tocca, anche di poco.

Gira nell'immagine GDAL (serve osgeo). Uso:
  python3 tile-italia.py <confine.geojsonl> <grid_1x1.jsonl> <zoom-min> <zoom-max> > tile.txt
"""
import json
import math
import sys

from osgeo import gdal, ogr, osr

gdal.UseExceptions()
ogr.UseExceptions()

confine, griglia, zmin, zmax = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
MONDO = 20037508.342789244

# il confine in EPSG:3857, in un layer in memoria
wgs = osr.SpatialReference(); wgs.ImportFromEPSG(4326)
wgs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
merc = osr.SpatialReference(); merc.ImportFromEPSG(3857)
trasf = osr.CoordinateTransformation(wgs, merc)
# "MEM" da GDAL 3.11, "Memory" prima
mem = (ogr.GetDriverByName("MEM") or ogr.GetDriverByName("Memory")).CreateDataSource("confine")
strato = mem.CreateLayer("confine", merc, ogr.wkbMultiPolygon)
for riga in open(confine):
    f = json.loads(riga.lstrip("\x1e"))
    g = ogr.CreateGeometryFromJson(json.dumps(f["geometry"]))
    g.Transform(trasf)
    e = ogr.Feature(strato.GetLayerDefn())
    e.SetGeometry(g)
    strato.CreateFeature(e)
x0, x1, y0, y1 = strato.GetExtent()

# le celle di un grado che TGen ha generato, livello per livello
generate = {}
for riga in open(griglia):
    c = json.loads(riga)
    for z in range(13, 21):
        if c.get(f"z{z}"):
            generate.setdefault(z, set()).add((int(round(c["left"])), int(round(c["bottom"]))))


def lon(x, z):
    return x / 2 ** z * 360 - 180


def lat(y, z):
    return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / 2 ** z))))


totale = 0
for z in range(zmin, zmax + 1):
    passo = 2 * MONDO / 2 ** z
    tx0, tx1 = int((x0 + MONDO) // passo), int((x1 + MONDO) // passo)
    ty0, ty1 = int((MONDO - y1) // passo), int((MONDO - y0) // passo)
    w, h = tx1 - tx0 + 1, ty1 - ty0 + 1
    r = gdal.GetDriverByName("MEM").Create("", w, h, 1, gdal.GDT_Byte)
    r.SetGeoTransform((-MONDO + tx0 * passo, passo, 0, MONDO - ty0 * passo, 0, -passo))
    r.SetProjection(merc.ExportToWkt())
    gdal.RasterizeLayer(r, [1], strato, burn_values=[1], options=["ALL_TOUCHED=TRUE"])
    a = r.GetRasterBand(1).ReadAsArray()
    n = 0
    for j in range(h):
        for i in range(w):
            if not a[j, i]:
                continue
            x, y = tx0 + i, ty0 + j
            if z >= 13:
                # la tile entra se tocca almeno una cella che TGen ha generato a questo livello
                celle = generate.get(z, set())
                lo0, lo1 = math.floor(lon(x, z)), math.floor(lon(x + 1, z) - 1e-9)
                la0, la1 = math.floor(lat(y + 1, z)), math.floor(lat(y, z) - 1e-9)
                if not any((cx, cy) in celle for cx in range(lo0, lo1 + 1) for cy in range(la0, la1 + 1)):
                    continue
            print(f"{z}/{x}/{y}")
            n += 1
    totale += n
    print(f"z{z}: {n} tile", file=sys.stderr)
print(f"in tutto: {totale} tile", file=sys.stderr)
