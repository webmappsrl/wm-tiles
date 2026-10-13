"""I nomi dei punti di interesse, come li scrive TGen (text-point e text-poly).

Per ogni oggetto con nome si calcola `feature` con la COALESCE dei due layer
di TGen (style/testi-coalesce.json, letta dal .mml da coalesce-testi.py) e,
livello per livello da z10 a z16, la prima regola di project.xml che
corrisponde (style/testi-regole.json, regole-testi.py): dimensione, colore,
carattere, alone, larghezza a capo, spostamento verticale. Le soglie di
superficie (`way_pixels`) cambiano da un livello all'altro, e con loro la
dimensione: per questo si scrive UN PUNTO PER LIVELLO, con minzoom = maxzoom
= livello e lo stile di quel livello nelle proprieta'. Lo stile non ha
espressioni di zoom (ol-mapbox-style le valuta sfasate di uno) e lo
spostamento `dy` (il nome sotto l'icona) e' gia' nella posizione del punto.

Le classi che hanno gia' un nome da un altro layer (cime, passi, sorgenti,
rifugi, aeroporti, laghi, boschi, parchi) si saltano.

Mancavano tutti: "Tower Parking", "Polo Ospedaliero Santa Chiara", "ex campo
da golf"... (13 ottobre 2026).

Gira nell'immagine GDAL. Uso:
  python3 build-testi.py <pbf> <W> <S> <E> <N> <coalesce.json> <regole.json> <out.geojsonl>
"""
import json
import re
import sys

from osgeo import gdal, ogr, osr

ogr.UseExceptions()
pbf, W, S, E, N = sys.argv[1], *map(float, sys.argv[2:6])
COALESCE = json.load(open(sys.argv[6]))
REGOLE = json.load(open(sys.argv[7]))
out = sys.argv[8]
for lista in REGOLE.values():
    for r in lista:
        r['f'] = compile(r['filtro'], r['filtro'], 'eval')

GIA = {'natural_peak', 'natural_volcano', 'natural_saddle', 'natural_spring', 'natural_cave_entrance',
       'tourism_alpine_hut', 'tourism_wilderness_hut', 'aeroway_aerodrome', 'natural_water', 'natural_bay',
       'landuse_reservoir', 'landuse_basin', 'natural_wood', 'landuse_forest', 'boundary_national_park',
       'leisure_nature_reserve'}
ZMIN, ZMAX = 10, 16
MONDO = 2 * 20037508.342789244
PIXEL = lambda z: MONDO / (256 * 2 ** z)  # metri per pixel a z
HSTORE = re.compile(r'"((?:[^"\\]|\\.)*)"=>"((?:[^"\\]|\\.)*)"')


def feature(t, clausole):
    g = t.get
    for c in clausole:
        tp = c['tipo']
        if tp == 'in':
            if g(c['col']) in c['valori']:
                return c['pre'] + g(c['col'])
        elif tp == 'in_fuori_tetto':
            if g(c['col']) in c['valori'] and g('location') not in ('roof', 'rooftop'):
                return c['pre'] + g(c['col'])
        elif tp == 'shop':
            s = g('shop')
            if s in c['valori']:
                return c['pre'] + s
            if s is not None and s not in c['esclusi']:
                return c['pre'] + 'other'
        elif tp == 'office':
            o = g('office')
            if o is not None and o not in c['esclusi']:
                return 'office'
        elif tp == 'historic':
            if g('historic') in c['valori']:
                return 'historic_' + g('historic') + ('_plaque' if g('memorial') == 'plaque' else '')
    return None


def numero(x):
    return float(x) if isinstance(x, str) and re.fullmatch(r'-?\d+(\.\d+)?', x) else x


def tags_di(f):
    t = {}
    for i in range(f.GetFieldCount()):
        nome, val = f.GetFieldDefnRef(i).GetName(), f.GetField(i)
        if val is None:
            continue
        if nome == 'other_tags':
            t.update({k.replace('\\"', '"'): v.replace('\\"', '"') for k, v in HSTORE.findall(val)})
        else:
            t[nome] = val
    return t


wgs = osr.SpatialReference(); wgs.ImportFromEPSG(4326); wgs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
merc = osr.SpatialReference(); merc.ImportFromEPSG(3857); merc.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
a_merc = osr.CoordinateTransformation(wgs, merc)
a_wgs = osr.CoordinateTransformation(merc, wgs)

ds = gdal.OpenEx(pbf, gdal.OF_VECTOR, open_options=['INTERLEAVED_READING=YES'])
LAYER = {'points': 'punti', 'multipolygons': 'aree'}
for i in range(ds.GetLayerCount()):
    lay = ds.GetLayer(i)
    lay.SetAttributeFilter('name IS NOT NULL' if lay.GetName() in LAYER else 'osm_id IS NULL')

uscita, conteggi = [], {}
while True:
    f, lay = ds.GetNextFeature()
    if f is None:
        break
    tipo = LAYER.get(lay.GetName())
    if not tipo:
        continue
    g = f.GetGeometryRef()
    if g is None:
        continue
    x0, x1, y0, y1 = g.GetEnvelope()
    if x1 < W or x0 > E or y1 < S or y0 > N:
        continue
    t = tags_di(f)
    feat = feature(t, COALESCE[tipo])
    if not feat or feat in GIA:
        continue
    area = None
    try:
        if tipo == 'aree':
            gm = g.Clone(); gm.Transform(a_merc); area = gm.Area()
            g = g.PointOnSurface()
    except RuntimeError:
        continue
    if g is None or g.IsEmpty():
        continue
    x, y, _ = a_merc.TransformPoint(g.GetX(), g.GetY())
    base = {'feature': feat, 'name': t['name'], 'access': t.get('access'), 'icao': t.get('icao'),
            'iata': t.get('iata'), 'is_building': 'no' if t.get('building') in (None, 'no') else 'yes',
            'height': numero(t.get('height')), 'way_area': area}
    for z in range(ZMIN, ZMAX + 1):
        p = dict(base, way_pixels=area / PIXEL(z) ** 2 if area is not None else None)
        v = lambda k, p=p: '' if p.get(k) is None else numero(p.get(k))
        regola = None
        for r in REGOLE[tipo]:
            if r['da'] <= z <= r['a']:
                try:
                    if eval(r['f'], {'v': v}):
                        regola = r
                        break
                except TypeError:
                    continue
        if regola is None:
            continue
        # dy di Mapnik: il nome sotto (o sopra) il punto di tanti pixel
        lon, lat, _ = a_wgs.TransformPoint(x, y - regola['dy'] * PIXEL(z))
        dim = regola['dim']
        uscita.append((area or 0, z, {
            'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [round(lon, 7), round(lat, 7)]},
            'properties': {
                'name': t['name'], 'dim': dim, 'col': regola['colore'],
                'f': {'Noto Sans Italic': 'I', 'Noto Sans Bold': 'B'}.get(regola['font'], 'R'),
                # Mapnik va a capo DOPO aver superato wrap-width (la riga puo'
                # sforare di una parola), OpenLayers PRIMA: 1,5 volte la
                # larghezza da' le stesse righe ("ex campo / da golf")
                'h': regola['aloneR'], 'w': round(1.5 * regola['acapo'] / dim, 2) if regola['acapo'] else 10,
                'a': 't' if regola['dy'] > 0 else 'b' if regola['dy'] < 0 else 'c',
            },
            'tippecanoe': {'minzoom': z, 'maxzoom': z},
        }))
        conteggi[feat] = conteggi.get(feat, 0) + 1

# come TGen: le aree piu' grandi prima (ORDER BY way_area DESC); i punti dopo
uscita.sort(key=lambda u: (u[1], -u[0]))
with open(out, 'w') as o:
    for _, _, u in uscita:
        o.write(json.dumps(u, ensure_ascii=False, separators=(',', ':')) + '\n')
print(f'   {len(uscita)} nomi (un punto per livello)', file=sys.stderr)
for k, n in sorted(conteggi.items(), key=lambda kv: -kv[1])[:15]:
    print(f'     {n:7d}  {k}', file=sys.stderr)
