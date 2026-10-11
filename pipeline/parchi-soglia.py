"""Soglia di visibilita' dei parchi, calcolata come la calcola TGen.

`nature-reserve-boundaries` e `nature-reserve-text` disegnano un'area solo se
`way_pixels > 3000`, cioe' se la sua superficie in EPSG:3857 supera 3000 pixel
al livello di zoom corrente. Un pixel a zoom z misura 156543.03 / 2^z metri
(di proiezione), quindi l'area in pixel quadruplica a ogni livello e ogni area
ha un primo livello da cui compare: `zpx`.

Lo si scrive nel dato come `tippecanoe.minzoom` (la feature non esiste nelle
tile piu' basse, come in TGen la escludeva la query) e come proprieta' `zpx`,
da cui lo stile ricava la dimensione dell'etichetta: TGen la ingrandisce sopra
12.000 e 48.000 pixel, cioe' esattamente uno e due livelli dopo `zpx`.

La soglia di 3000 pixel e' quella di parchi, boschi, acque ed edifici; i nomi
dei ponti usano 62,5 (bridge-text), i parchi tematici 750 (tourism-boundary).

Uso: python3 parchi-soglia.py <in.geojsonl> <out.geojsonl> [zmin] [zmax] [soglia_px]
"""
import json
import math
import sys

R = 6378137.0
PIXEL_Z0 = 156543.03392804097  # metri di proiezione per pixel a z0, tile da 256


def area_3857(anelli):
    """Area (shoelace) di un poligono: il primo anello e' il bordo, gli altri i buchi."""
    tot = 0.0
    for k, anello in enumerate(anelli):
        pts = [(R * math.radians(lon),
                R * math.log(math.tan(math.pi / 4 + math.radians(max(min(lat, 85.0511), -85.0511)) / 2)))
               for lon, lat in anello]
        a = 0.0
        for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]):
            a += x1 * y2 - x2 * y1
        tot += abs(a) / 2 * (1 if k == 0 else -1)
    return tot


def main():
    src, dst = sys.argv[1], sys.argv[2]
    zmin = int(sys.argv[3]) if len(sys.argv) > 3 else 8
    zmax = int(sys.argv[4]) if len(sys.argv) > 4 else 14
    soglia = float(sys.argv[5]) if len(sys.argv) > 5 else 3000
    n = 0
    with open(src) as f, open(dst, 'w') as out:
        for riga in f:
            ft = json.loads(riga)
            g = ft.get('geometry') or {}
            if g.get('type') == 'Polygon':
                area = area_3857(g['coordinates'])
            elif g.get('type') == 'MultiPolygon':
                area = sum(area_3857(p) for p in g['coordinates'])
            else:
                continue
            if area <= 0:
                continue
            # primo z con area / pixel(z)^2 > soglia
            z = math.floor(0.5 * math.log2(soglia * PIXEL_Z0 ** 2 / area)) + 1
            zpx = max(z, zmin)
            ft['properties']['zpx'] = zpx
            # oltre il livello massimo dell'archivio la feature non comparirebbe
            # mai: le aree piu' piccole entrano all'ultimo livello
            ft['tippecanoe'] = {'minzoom': min(zpx, zmax)}
            out.write(json.dumps(ft, ensure_ascii=False) + '\n')
            n += 1
    print(f'   {n} aree con soglia')


main()
