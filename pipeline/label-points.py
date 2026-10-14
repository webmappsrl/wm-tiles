"""Le aree con nome diventano il punto dove Mapnik scrive il nome.

OpenLayers etichetta un multipoligono una volta per ogni parte: il Parco
Nazionale dell'Arcipelago di La Maddalena, un'area di otto isole, aveva il nome
ripetuto quattro volte nella stessa tile a z10 (giro di revisione italia1, 14
ottobre 2026). Mapnik invece, con `text-placement: interior`, scrive il nome una
volta sola, sulla parte col riquadro piu' grande (`text-largest-bbox-only`, vero
di serie), nel baricentro se cade dentro l'area. Lo stesso valeva per un'area
tagliata dal bordo delle tile, che in OpenLayers riceveva un nome per ogni tile.

Qui ogni area diventa quel punto. Proprieta' e `tippecanoe` restano quelli
dell'area (la soglia di superficie la scrive parchi-soglia.py).

Con `--wrap` il nome arriva gia' spezzato come lo spezza Mapnik, che va a capo
DOPO la parola che supera la larghezza (OpenLayers prima): "Parco / Naturale di /
Migliarino San / Rossore / Massaciuccoli" in cinque righe invece delle quattro di
TGen, e la riga in piu' lo faceva urtare col nome della Macchia di San Rossore.
La larghezza e' in em, quindi le righe non dipendono dalla dimensione del testo.

Uso: python3 label-points.py <in.geojsonl> <out.geojsonl> [--wrap <glifi.json> <R|I|B> <em>]
"""
import heapq
import json
import math
import sys


def bbox(ring):
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return min(xs), min(ys), max(xs), max(ys)


def segment_distance_sq(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    if dx or dy:
        t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
        if t > 1:
            ax, ay = bx, by
        elif t > 0:
            ax, ay = ax + dx * t, ay + dy * t
    return (px - ax) ** 2 + (py - ay) ** 2


def signed_distance(x, y, rings):
    """Distanza dal bordo, positiva dentro il poligono (anelli: bordo e buchi)."""
    inside = False
    best = math.inf
    for ring in rings:
        n = len(ring)
        for i in range(n):
            ax, ay = ring[i]
            bx, by = ring[i - 1]
            if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
                inside = not inside
            best = min(best, segment_distance_sq(x, y, ax, ay, bx, by))
    return (1 if inside else -1) * math.sqrt(best)


def centroid(ring):
    a = cx = cy = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        f = x1 * y2 - x2 * y1
        a += f
        cx += (x1 + x2) * f
        cy += (y1 + y2) * f
    if a == 0:
        return ring[0]
    return cx / (3 * a), cy / (3 * a)


def interior_point(rings):
    """Il baricentro se cade dentro l'area, come fa Mapnik; altrimenti il punto
    interno piu' lontano dai bordi. Nei PNG di TGen il nome del parco di
    Migliarino San Rossore sta a 10,309 / 43,727, il baricentro a 10,313 / 43,733:
    il punto piu' lontano dai bordi (43,720) lo portava addosso al nome della
    Macchia di San Rossore, che lo cancellava."""
    cx, cy = centroid(rings[0])
    if signed_distance(cx, cy, rings) > 0:
        return cx, cy
    return pole_of_inaccessibility(rings)


def pole_of_inaccessibility(rings, precision_ratio=0.01):
    """Il punto interno piu' lontano dai bordi (polylabel)."""
    x0, y0, x1, y1 = bbox(rings[0])
    size = min(x1 - x0, y1 - y0)
    if size <= 0:
        return rings[0][0]
    precision = max(x1 - x0, y1 - y0) * precision_ratio
    h = size / 2
    queue = []

    def push(x, y, half):
        d = signed_distance(x, y, rings)
        heapq.heappush(queue, (-(d + half * math.sqrt(2)), d, x, y, half))

    x = x0
    while x < x1:
        y = y0
        while y < y1:
            push(x + h, y + h, h)
            y += size
        x += size
    cx, cy = centroid(rings[0])
    best = (signed_distance(cx, cy, rings), cx, cy)
    while queue:
        neg_max, d, x, y, half = heapq.heappop(queue)
        if d > best[0]:
            best = (d, x, y)
        if -neg_max - best[0] <= precision:
            continue
        half /= 2
        for sx in (-half, half):
            for sy in (-half, half):
                push(x + sx, y + sy, half)
    return best[1], best[2]


def wrap_like_mapnik(name, widths, em):
    """Le righe di Mapnik (wrap-before falso), con le larghezze dei glifi dello
    stile; 1,1 come in build-testi.py (FreeType arrotonda ogni carattere)."""
    scale = 1.1 / widths['corpo']
    table = widths['table']
    length = lambda w: sum(table.get(str(ord(c)), 13) for c in w) * scale
    space = length(' ')
    lines, line, width = [], [], 0.0
    for word in name.split():
        line.append(word)
        width += (space if len(line) > 1 else 0) + length(word)
        if width > em:
            lines.append(' '.join(line))
            line, width = [], 0.0
    if line:
        lines.append(' '.join(line))
    return '\n'.join(lines)


def main():
    src, dst = sys.argv[1], sys.argv[2]
    widths = None
    if len(sys.argv) > 3 and sys.argv[3] == '--wrap':
        glyphs = json.load(open(sys.argv[4]))
        widths = {'corpo': glyphs['corpo'], 'table': glyphs['font'][sys.argv[5]]}
        em = float(sys.argv[6])
    count = 0
    with open(src) as fin, open(dst, 'w') as fout:
        for line in fin:
            ft = json.loads(line)
            g = ft.get('geometry') or {}
            if g.get('type') == 'Polygon':
                parts = [g['coordinates']]
            elif g.get('type') == 'MultiPolygon':
                parts = g['coordinates']
            else:
                continue
            parts = [p for p in parts if p and len(p[0]) >= 4]
            if not parts:
                continue

            # text-largest-bbox-only: la parte col riquadro piu' grande
            def bbox_area(p):
                a, b, c, d = bbox(p[0])
                return (c - a) * (d - b)
            # gradi -> coordinate piane approssimate (cos della latitudine),
            # perche' il punto piu' lontano dai bordi dipende dalle distanze
            part = max(parts, key=bbox_area)
            k = math.cos(math.radians(part[0][0][1]))
            plane = [[(x * k, y) for x, y in ring[:-1]] for ring in part]
            px, py = interior_point(plane)
            if widths and ft['properties'].get('name'):
                ft['properties']['name'] = wrap_like_mapnik(ft['properties']['name'], widths, em)
            ft['geometry'] = {'type': 'Point', 'coordinates': [round(px / k, 7), round(py, 7)]}
            fout.write(json.dumps(ft, ensure_ascii=False) + '\n')
            count += 1
    print(f'   {count} punti per le etichette', file=sys.stderr)


main()
