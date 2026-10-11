"""Da linee a punti: il punto a meta' lunghezza di ogni linea, con le stesse proprieta'.

Serve per i simboli che TGen mette su una linea (amenity-line: i guadi): un'icona
su una LineString in ol-mapbox-style compare solo se la linea supera i 150 pixel.

Uso: python3 centro-linee.py <in.geojsonl> <out.geojsonl>
"""
import json
import math
import sys


def dist(a, b):
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dp, dl = p2 - p1, math.radians(b[0] - a[0])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371000.0 * math.asin(math.sqrt(h))


def centro(c):
    tratti = [dist(c[i], c[i + 1]) for i in range(len(c) - 1)]
    meta, fatto = sum(tratti) / 2, 0.0
    for i, t in enumerate(tratti):
        if fatto + t >= meta and t > 0:
            f = (meta - fatto) / t
            return [c[i][0] + (c[i + 1][0] - c[i][0]) * f, c[i][1] + (c[i + 1][1] - c[i][1]) * f]
        fatto += t
    return c[0]


with open(sys.argv[1]) as src, open(sys.argv[2], 'w') as out:
    for riga in src:
        ft = json.loads(riga)
        g = ft.get('geometry') or {}
        linee = [g['coordinates']] if g.get('type') == 'LineString' else g.get('coordinates', []) if g.get('type') == 'MultiLineString' else []
        if not linee or len(linee[0]) < 2:
            continue
        ft['geometry'] = {'type': 'Point', 'coordinates': centro(linee[0])}
        out.write(json.dumps(ft, ensure_ascii=False) + '\n')
