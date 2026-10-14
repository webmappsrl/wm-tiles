"""Etichette lungo le linee come punti ruotati, posizionati come fa Mapnik.

OpenLayers scrive un testo lungo una linea solo in posizioni fisse
(`symbol-spacing`) e lo scarta se in quel punto la linea curva troppo: sulle
curve di livello e sui fossi, tortuosi e tagliati al bordo delle tile, quasi
nessuna etichetta sopravviveva. Mapnik invece cerca, attorno a ogni posizione,
il tratto abbastanza dritto (13 ottobre 2026: TGen scrive 5-6 quote in una
tile dove il locale ne scriveva una, e i nomi dei fossi mancavano).

Qui la ricerca si fa nel dato, livello per livello: per ogni linea, ogni
`spaziatura` pixel (alla scala del livello), si cerca nel raggio di mezzo passo
il tratto lungo quanto il testo con la curvatura minore; se resta sotto
`--angolo` gradi diventa un punto con la rotazione del tratto (sempre leggibile,
mai capovolta) e lo spostamento `dy` di Mapnik. minzoom = maxzoom = livello:
la spaziatura vale in pixel di quel livello.

Uso: python3 punti-lungo-linee.py <in.geojsonl> <out.geojsonl> --testo CAMPO
       --zoom 14-16 --spaziatura 256 --dimensione 9 [--dy -3] [--angolo 30]
       [--filtro "p['type'].startswith('cp')"] [--campi a,b]
Le geometrie in ingresso sono in WGS 84 (GeoJSONSeq di GDAL o tippecanoe).
"""
import argparse
import bisect
import json
import math
import sys

ap = argparse.ArgumentParser()
ap.add_argument('ingresso'); ap.add_argument('uscita')
ap.add_argument('--testo', required=True)
ap.add_argument('--zoom', required=True)
ap.add_argument('--spaziatura', type=float, required=True)
ap.add_argument('--dimensione', type=float, required=True)
ap.add_argument('--dy', type=float, default=0)
ap.add_argument('--angolo', type=float, default=30)
ap.add_argument('--filtro', default='True')
ap.add_argument('--campi', default='')
a = ap.parse_args()
Z0, Z1 = map(int, a.zoom.split('-'))
FILTRO = compile(a.filtro, 'filtro', 'eval')
CAMPI = [c for c in a.campi.split(',') if c]
R = 6378137.0
MONDO = 2 * math.pi * R


def merc(lon, lat):
    return R * math.radians(lon), R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def wgs(x, y):
    return math.degrees(x / R), math.degrees(2 * math.atan(math.exp(y / R)) - math.pi / 2)


def linee(g):
    if g['type'] == 'LineString':
        yield g['coordinates']
    elif g['type'] == 'MultiLineString':
        yield from g['coordinates']


def misura(xy):
    s = [0.0]
    for k in range(1, len(xy)):
        s.append(s[-1] + math.dist(xy[k - 1], xy[k]))
    return s


def svolte(xy):
    """Cambio di direzione a ogni vertice interno, in gradi (0 agli estremi)."""
    ang = [math.atan2(b[1] - a_[1], b[0] - a_[0]) for a_, b in zip(xy, xy[1:])]
    t = [0.0] * len(xy)
    for i in range(1, len(xy) - 1):
        t[i] = abs((math.degrees(ang[i] - ang[i - 1]) + 180) % 360 - 180)
    return t


def punto_a(xy, s, d):
    """Punto alla distanza d lungo la linea (ricerca binaria)."""
    k = min(len(s) - 1, max(1, bisect.bisect_left(s, d)))
    t = (d - s[k - 1]) / ((s[k] - s[k - 1]) or 1)
    (x0, y0), (x1, y1) = xy[k - 1], xy[k]
    return x0 + t * (x1 - x0), y0 + t * (y1 - y0)


def curvatura(s, tv, d0, d1):
    """La svolta piu' forte fra i vertici dentro il tratto [d0, d1]."""
    i0, i1 = bisect.bisect_right(s, d0), bisect.bisect_left(s, d1)
    return max(tv[i0:i1], default=0.0)


uscita = n_linee = 0
with open(a.ingresso) as fin, open(a.uscita, 'w') as fout:
    for riga in fin:
        e = json.loads(riga)
        p = e.get('properties') or {}
        testo = p.get(a.testo)
        if testo in (None, '') or not eval(FILTRO, {'p': p}):
            continue
        testo = str(testo)
        for coords in linee(e['geometry']):
            xy = [merc(lon, lat) for lon, lat in coords]
            if len(xy) < 2:
                continue
            s = misura(xy)
            tv = svolte(xy)
            tot = s[-1]
            n_linee += 1
            for z in range(Z0, Z1 + 1):
                px = MONDO / (256 * 2 ** z)
                # lunghezza del testo: 0,6 em per carattere, +1 px di spaziatura
                lun = (0.6 * a.dimensione + 1) * len(testo) * px
                passo = a.spaziatura * px
                if tot < lun * 1.2:
                    continue
                d = min(passo / 2, tot / 2)
                while d < tot:
                    migliore = None
                    # candidati nel raggio di mezzo passo, ogni quarto di testo
                    lo, hi = max(lun / 2, d - passo / 2), min(tot - lun / 2, d + passo / 2)
                    c = lo
                    while c <= hi:
                        cu = curvatura(s, tv, c - lun / 2, c + lun / 2)
                        if cu <= a.angolo:
                            chiave = (round(cu, 1), abs(c - d))
                            if migliore is None or chiave < migliore[0]:
                                migliore = (chiave, c)
                        c += max(2 * px, lun / 4)
                    if migliore:
                        c = migliore[1]
                        (x0, y0), (x1, y1) = punto_a(xy, s, c - lun / 2), punto_a(xy, s, c + lun / 2)
                        ang = math.degrees(math.atan2(y1 - y0, x1 - x0))
                        if ang > 90: ang -= 180
                        if ang < -90: ang += 180
                        # dy di Mapnik: positivo verso il basso dello schermo,
                        # perpendicolare al testo
                        cx, cy = punto_a(xy, s, c)
                        r = math.radians(ang)
                        cx += a.dy * px * math.sin(r)
                        cy -= a.dy * px * math.cos(r)
                        lon, lat = wgs(cx, cy)
                        prop = {'t': testo, 'r': round(-ang, 1), 's': a.dimensione}
                        prop.update({k: p.get(k) for k in CAMPI})
                        fout.write(json.dumps({'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [round(lon, 7), round(lat, 7)]},
                                               'properties': prop, 'tippecanoe': {'minzoom': z, 'maxzoom': z}},
                                              ensure_ascii=False, separators=(',', ':')) + '\n')
                        uscita += 1
                    d += passo
print(f'   {n_linee} linee, {uscita} etichette', file=sys.stderr)
