"""Le icone dei punti di interesse, dal PBF, come le disegna TGen.

TGen prende le icone da tre layer del project.mml: amenity-points (punti),
amenity-points-poly (aree, con `way_pixels` = superficie in pixel al livello)
e amenity-low-priority. Qui si calcola `feature` con la stessa COALESCE delle
sue query e si valutano, livello per livello, le regole estratte da
project.xml (style/amenity-regole.json, pipeline/regole-amenity.py): il primo
livello in cui una regola corrisponde e' il livello d'ingresso dell'oggetto,
e l'icona e il colore sono quelli di quella regola. Le soglie stanno quindi nel
dato (`tippecanoe.minzoom`), come per i parchi: lo stile non ha filtri sullo
zoom.

Prima mancavano del tutto: chiese, biblioteche, cinema, golf, parcheggi e una
sessantina di classi (12 ottobre 2026).

Gira nell'immagine GDAL (serve osgeo). Uso:
  python3 build-amenity.py <pbf> <W> <S> <E> <N> <regole.json> <out.geojsonl>
"""
import json
import math
import re
import sys

from osgeo import gdal, ogr, osr

ogr.UseExceptions()
pbf, W, S, E, N, regole_json, out = sys.argv[1], *map(float, sys.argv[2:6]), sys.argv[6], sys.argv[7]
REGOLE = json.load(open(regole_json))
for lista in REGOLE.values():
    for r in lista:
        r['f'] = compile(r['filtro'], r['filtro'], 'eval')

# classi che hanno gia' un layer proprio nello stile: qui si saltano
GIA_DISEGNATE = {
    'aeroway_aerodrome', 'natural_peak', 'natural_volcano', 'natural_saddle', 'natural_spring',
    'natural_cave_entrance', 'tourism_alpine_hut', 'tourism_wilderness_hut', 'amenity_shelter',
    'highway_ford', 'man_made_cross', 'historic_wayside_cross', 'highway_bus_stop',
}
# il riferimento raster arriva a z16: oltre non c'e' da imitare (CLAUDE.md)
ZMIN, ZMAX = 10, 16
# superficie di un pixel al livello z, in m^2 di Web Mercator (pixel_width * pixel_height di Mapnik)
PIXEL2 = lambda z: (2 * 20037508.342789244 / (256 * 2 ** z)) ** 2

AMENITY = {'shelter', 'atm', 'bank', 'bar', 'bbq', 'bicycle_rental', 'bus_station', 'cafe', 'public_bath',
           'car_rental', 'car_wash', 'cinema', 'clinic', 'community_centre', 'fire_station', 'fountain',
           'fuel', 'hospital', 'ice_cream', 'embassy', 'library', 'courthouse', 'townhall', 'parking',
           'bicycle_parking', 'motorcycle_parking', 'pharmacy', 'doctors', 'dentist', 'place_of_worship',
           'police', 'post_box', 'post_office', 'pub', 'biergarten', 'recycling', 'restaurant', 'food_court',
           'fast_food', 'telephone', 'taxi', 'theatre', 'toilets', 'drinking_water',
           'prison', 'hunting_stand', 'nightclub', 'veterinary', 'social_facility',
           'charging_station', 'arts_centre', 'ferry_terminal', 'marketplace', 'shower', 'bbq',
           'nursing_home', 'childcare', 'driving_school'}
TOURISM = {'artwork', 'alpine_hut', 'camp_site', 'caravan_site', 'chalet', 'wilderness_hut', 'guest_house',
           'apartment', 'hostel', 'hotel', 'motel', 'information', 'museum', 'picnic_site'}
LEISURE_P = {'water_park', 'playground', 'miniature_golf', 'golf_course', 'picnic_table', 'slipway',
             'dog_park', 'fitness_centre', 'fitness_station', 'firepit', 'sauna', 'beach_resort'}
LEISURE_A = LEISURE_P - {'slipway', 'dog_park'}
MAN_MADE = {'mast', 'tower', 'water_tower', 'lighthouse', 'windmill', 'obelisk', 'communications_tower', 'chimney'}
HISTORIC = {'memorial', 'monument', 'archaeological_site', 'fort', 'castle', 'manor', 'city_gate'}
CHIUSO = {'no', 'vacant', 'closed', 'disused', 'empty'}


def feature(t, area):
    """La COALESCE di amenity-points (area=False) e amenity-points-poly (area=True)."""
    g = t.get
    fuori_tetto = g('location') not in ('roof', 'rooftop')
    if g('aeroway') in ('helipad', 'aerodrome'): return 'aeroway_' + g('aeroway')
    if g('tourism') in TOURISM: return 'tourism_' + g('tourism')
    if g('amenity') in AMENITY | ({'waste_disposal'} if area else set()): return 'amenity_' + g('amenity')
    if g('advertising') == 'column': return 'advertising_column'
    if not area and g('emergency') == 'phone': return 'emergency_phone'
    if g('shop') and g('shop') not in CHIUSO: return 'shop'
    if g('office') and g('office') not in CHIUSO: return 'office'
    if g('leisure') in (LEISURE_A if area else LEISURE_P): return 'leisure_' + g('leisure')
    if g('man_made') in MAN_MADE and fuori_tetto: return 'man_made_' + g('man_made')
    if g('natural') in ({'spring'} if area else {'peak', 'volcano', 'saddle', 'spring', 'cave_entrance'}):
        return 'natural_' + g('natural')
    if not area and g('waterway') == 'waterfall': return 'waterway_waterfall'
    if g('historic') in HISTORIC:
        return 'historic_' + g('historic') + ('_plaque' if g('memorial') == 'plaque' else '')
    if g('military') == 'bunker': return 'military_bunker'
    if g('highway') in ('bus_stop', 'elevator', 'traffic_signals'): return 'highway_' + g('highway')
    if not area and g('ford') in ('yes', 'stepping_stones'): return 'highway_ford'
    eolico = g('generator:source') == 'wind' or g('power_source') == 'wind'
    if g('power') == 'generator' and eolico: return 'power_generator'
    if g('tourism') == 'viewpoint': return 'tourism_viewpoint'
    if not area:
        if g('barrier') == 'toll_booth': return 'barrier_toll_booth'
        if g('man_made') == 'cross': return 'man_made_cross'
        if g('historic') in ('wayside_cross', 'wayside_shrine'): return 'historic_' + g('historic')
    return None


def feature_bassa(t):
    """La COALESCE di amenity-low-priority (parcheggi piccoli, croci, barriere)."""
    g = t.get
    if g('amenity') in ('parking', 'bicycle_parking', 'motorcycle_parking', 'bench', 'waste_basket', 'waste_disposal'):
        return 'amenity_' + g('amenity')
    if g('historic') in ('wayside_cross', 'wayside_shrine'): return 'historic_' + g('historic')
    if g('man_made') == 'cross': return 'man_made_cross'
    return None


def altezza(t, area):
    if not (t.get('man_made') in ('mast', 'tower', 'chimney') and t.get('location') not in ('roof', 'rooftop')):
        return None
    h = t.get('height') or ''
    m = re.match(r'^-?(\d{1,4}(\.\d+)?)$' if area else r'^(\d{1,3}(\.\d+)?)( m)?$', h)
    return float(m.group(1)) if m else None


def numero(x):
    return float(x) if isinstance(x, str) and re.fullmatch(r'-?\d+(\.\d+)?', x) else x


def prima_icona(props, liste):
    """Il primo livello con una regola che corrisponde, e quella regola."""
    for z in range(ZMIN, ZMAX + 1):
        p = dict(props)
        if p.get('area') is not None:
            p['way_pixels'] = p['area'] / PIXEL2(z)
        # un campo assente vale '' come in Mapnik: `[access] != ''` e' falso per
        # un parcheggio senza access, che TGen disegna pieno (con None la
        # regola dei privati scattava e il P usciva sbiadito, 15/17331/11949)
        def v(k, p=p):
            x = p.get(k)
            return '' if x is None else numero(x)
        for lista in liste:
            for r in REGOLE[lista]:
                if not (r['da'] <= z <= r['a']):
                    continue
                try:
                    if eval(r['f'], {'v': v}):
                        return z, r
                except TypeError:
                    continue  # confronto numerico con un campo assente: Mapnik lo da' falso
    return None, None


HSTORE = re.compile(r'"((?:[^"\\]|\\.)*)"=>"((?:[^"\\]|\\.)*)"')


def tags_di(f):
    t = {}
    for i in range(f.GetFieldCount()):
        nome = f.GetFieldDefnRef(i).GetName()
        val = f.GetField(i)
        if val is None:
            continue
        if nome == 'other_tags':
            t.update({k.replace('\\"', '"'): v.replace('\\"', '"') for k, v in HSTORE.findall(val)})
        else:
            t[nome] = val
    return t


wgs = osr.SpatialReference(); wgs.ImportFromEPSG(4326)
wgs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
merc = osr.SpatialReference(); merc.ImportFromEPSG(3857)
merc.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
a_merc = osr.CoordinateTransformation(wgs, merc)

# Lettura INTERLACCIATA: leggendo un layer per volta dallo stesso dataset il
# driver OSM accumula gli altri e, oltre una soglia, li perdeva in silenzio:
# sulle due celle 3.632 aree lette su decine di migliaia, 111 luoghi di culto
# invece di 2.421. Cosi' si scorre il file una volta sola, tutti i layer.
ds = gdal.OpenEx(pbf, gdal.OF_VECTOR, open_options=['INTERLEAVED_READING=YES'])
LAYER = {'points': False, 'multipolygons': True}
# Filtri dentro GDAL, in C: a Python arrivano solo gli oggetti che portano una
# delle chiavi che feature() e feature_bassa() guardano; linee e relazioni si
# scartano subito. Sull'Italia il passo girava oltre mezz'ora con Python che
# scorreva ogni strada. Le chiavi che nel driver OSM sono colonne si guardano
# come colonne, le altre in other_tags.
TAG = lambda k: f"other_tags LIKE '%\"{k}\"=>%'"
FILTRI = {
    'points': ' OR '.join(['man_made IS NOT NULL', 'highway IS NOT NULL', 'barrier IS NOT NULL'] + [TAG(k) for k in (
        'amenity', 'tourism', 'leisure', 'historic', 'natural', 'waterway', 'military', 'power', 'aeroway',
        'shop', 'office', 'advertising', 'emergency', 'ford', 'memorial')]),
    'multipolygons': ' OR '.join([f'{c} IS NOT NULL' for c in (
        'amenity', 'tourism', 'leisure', 'historic', 'man_made', 'military', 'natural', 'aeroway', 'shop', 'office')]
        + [TAG(k) for k in ('highway', 'power', 'advertising', 'memorial')]),
}
for i in range(ds.GetLayerCount()):
    lay = ds.GetLayer(i)
    lay.SetAttributeFilter(FILTRI.get(lay.GetName(), 'osm_id IS NULL'))
uscita = []
conteggi = {}
while True:
    f, lay = ds.GetNextFeature()
    if f is None:
        break
    if lay.GetName() not in LAYER:
        continue
    area = LAYER[lay.GetName()]
    if True:
        g0 = f.GetGeometryRef()
        if g0 is None:
            continue
        x0, x1, y0, y1 = g0.GetEnvelope()
        if x1 < W or x0 > E or y1 < S or y0 > N:
            continue
        t = tags_di(f)
        feat = feature(t, area)
        bassa = feature_bassa(t)
        if (not feat or feat in GIA_DISEGNATE) and not bassa:
            continue
        g = f.GetGeometryRef()
        if g is None:
            continue
        sup = None
        if area:
            # le aree tagliate al bordo dell'estratto possono avere anelli rotti:
            # si ripiega sul centroide, e se anche quello fallisce si salta
            try:
                gm = g.Clone(); gm.Transform(a_merc); sup = gm.Area()
                g = g.PointOnSurface()
            except RuntimeError:
                try:
                    g = g.Centroid()
                except RuntimeError:
                    continue
            if g is None or g.IsEmpty():
                continue
        props = {k: t.get(k) for k in ('access', 'religion', 'denomination', 'icao', 'iata', 'recycling_type',
                                      'tower:type', 'tower:construction', 'castle_type', 'information',
                                      'power_source', 'generator:source', 'name')}
        props['height'] = altezza(t, area)
        props['area'] = sup
        z, regola = None, None
        if feat and feat not in GIA_DISEGNATE:
            props['feature'] = feat
            z, regola = prima_icona(props, ['aree' if area else 'punti'])
        if regola is None and bassa and bassa not in GIA_DISEGNATE:
            props['feature'] = bassa
            z, regola = prima_icona(props, ['bassa'])
        if regola is None:
            continue
        x, y = g.GetX(), g.GetY()
        conteggi[props['feature']] = conteggi.get(props['feature'], 0) + 1
        uscita.append((sup or 0, {
            'type': 'Feature',
            'geometry': {'type': 'Point', 'coordinates': [round(x, 6), round(y, 6)]},
            'properties': {
                'feature': props['feature'],
                'icona': f"tg-{regola['icona']}-{regola['colore'].lstrip('#')}",
                'opaco': regola['opacita'],
                **({'name': t['name']} if t.get('name') else {}),
            },
            'tippecanoe': {'minzoom': z},
        }))

# come TGen: le aree piu' grandi prima (ORDER BY way_area DESC), poi i punti;
# a parita' di layer OpenLayers premia chi viene prima
uscita.sort(key=lambda u: -u[0])
with open(out, 'w') as o:
    for _, u in uscita:
        o.write(json.dumps(u, ensure_ascii=False, separators=(',', ':')) + '\n')
icone = sorted({u['properties']['icona'] for _, u in uscita})
print(f'   {len(uscita)} icone, {len(icone)} simboli diversi', file=sys.stderr)
for k, n in sorted(conteggi.items(), key=lambda kv: -kv[1]):
    print(f'     {n:7d}  {k}', file=sys.stderr)
json.dump(icone, open(out + '.icone.json', 'w'))
