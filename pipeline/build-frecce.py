"""Le frecce dei sensi unici, come le disegna TGen, in punti.

TGen le mette con un MarkersSymbolizer lungo la strada (roads-text-name e
paths-text-name, classe `directions`): da z16, una ogni 180 px, colore per
classe di strada, `oneway-reverse.svg` per oneway=-1; le rotatorie senza
oneway=no/reversible contano come senso unico. Mancavano del tutto (13 ottobre
2026, segnalate dall'utente).

Qui diventano PUNTI con la loro rotazione, non icone lungo la linea:
ol-mapbox-style mette un'icona su una linea solo se la linea supera i 150
pixel (CLAUDE.md), e le vie del centro sono quasi tutte piu' corte. Le
posizioni seguono la spaziatura di Mapnik a z16 (meta' passo, poi un passo; le
vie piu' corte di mezzo passo non ne hanno); da z17 si aggiungono quelle a
meta' strada, perche' a z17 i 180 px valgono la meta' dei metri.

Gira nell'immagine GDAL. Uso:
  python3 build-frecce.py <pbf> <W> <S> <E> <N> <frecce-colori.json> <out.geojsonl>
"""
import json
import math
import sys

from osgeo import gdal, ogr, osr

ogr.UseExceptions()
pbf, W, S, E, N, colori_json, out = sys.argv[1], *map(float, sys.argv[2:6]), sys.argv[6], sys.argv[7]

# colori da project.xml (stili roads-text-name-directions e paths-text-name),
# in style/frecce-colori.json: lo legge anche svg-amenity.mjs per lo sprite
COLORE = json.load(open(colori_json))['colori']
PASSO = 180 * 2 * 20037508.342789244 / (256 * 2 ** 16)  # 180 px a z16, in metri Web Mercator

HSTORE = __import__('re').compile(r'"((?:[^"\\]|\\.)*)"=>"((?:[^"\\]|\\.)*)"')

wgs = osr.SpatialReference(); wgs.ImportFromEPSG(4326); wgs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
merc = osr.SpatialReference(); merc.ImportFromEPSG(3857); merc.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
a_merc = osr.CoordinateTransformation(wgs, merc)
a_wgs = osr.CoordinateTransformation(merc, wgs)

# lettura interlacciata con i filtri in GDAL (CLAUDE.md: il driver OSM perde
# oggetti se si leggono i layer uno per volta)
ds = gdal.OpenEx(pbf, gdal.OF_VECTOR, open_options=['INTERLEAVED_READING=YES'])
for i in range(ds.GetLayerCount()):
    lay = ds.GetLayer(i)
    lay.SetAttributeFilter(
        "highway IS NOT NULL AND (other_tags LIKE '%\"oneway\"=>%' OR other_tags LIKE '%\"junction\"=>\"roundabout\"%')"
        if lay.GetName() == 'lines' else 'osm_id IS NULL')


def punti_lungo(xy, passo, inizio):
    """Punti ogni `passo` metri a partire da `inizio`, con la direzione del tratto."""
    lun = [math.dist(xy[k], xy[k + 1]) for k in range(len(xy) - 1)]
    tot = sum(lun)
    d = inizio
    k, base = 0, 0.0
    while d < tot:
        while k < len(lun) - 1 and base + lun[k] < d:
            base += lun[k]; k += 1
        if lun[k] == 0:
            d += passo; continue
        f = (d - base) / lun[k]
        (x0, y0), (x1, y1) = xy[k], xy[k + 1]
        yield x0 + f * (x1 - x0), y0 + f * (y1 - y0), x1 - x0, y1 - y0
        d += passo


uscita, n_vie = [], 0
while True:
    f, lay = ds.GetNextFeature()
    if f is None:
        break
    if lay.GetName() != 'lines':
        continue
    t = dict(HSTORE.findall(f.GetField('other_tags') or ''))
    hw = f.GetField('highway')
    ow = t.get('oneway')
    if ow not in ('yes', '-1'):
        ow = 'yes' if t.get('junction') == 'roundabout' and ow not in ('no', 'reversible') else None
    if not ow or hw not in COLORE:
        continue
    g = f.GetGeometryRef()
    x0, x1, y0, y1 = g.GetEnvelope()
    if x1 < W or x0 > E or y1 < S or y0 > N:
        continue
    colore = COLORE[hw]
    if hw in ('footway', 'path'):
        if t.get('horse') == 'designated': colore = '#6f6553'
        if t.get('bicycle') == 'designated': colore = '#4b4b4b'
    gm = g.Clone(); gm.Transform(a_merc)
    xy = [gm.GetPoint_2D(k) for k in range(gm.GetPointCount())]
    if len(xy) < 2:
        continue
    n_vie += 1
    # z16: a meta' passo dall'inizio, poi ogni passo, come Mapnik: una via piu'
    # corta di mezzo passo non ha frecce (con una freccia al centro di ogni via
    # corta gli spicchi delle rotatorie ne erano pieni, 16/34661/23903).
    # z17: a meta' fra quelle di z16
    serie = [(16, p) for p in punti_lungo(xy, PASSO, PASSO / 2)] + [(17, p) for p in punti_lungo(xy, PASSO, PASSO)]
    for z, (x, y, dx, dy) in serie:
        # angolo sullo schermo, in senso orario dall'est (la y dello schermo scende)
        rot = math.degrees(math.atan2(-dy, dx)) + (180 if ow == '-1' else 0)
        lon, lat, _ = a_wgs.TransformPoint(x, y)
        uscita.append({'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [round(lon, 7), round(lat, 7)]},
                       'properties': {'icona': 'tg-oneway-' + colore.lstrip('#'), 'rot': round(rot % 360, 1)},
                       'tippecanoe': {'minzoom': z}})

with open(out, 'w') as o:
    for u in uscita:
        o.write(json.dumps(u, separators=(',', ':')) + '\n')
print(f'   {n_vie} vie a senso unico, {len(uscita)} frecce', file=sys.stderr)
