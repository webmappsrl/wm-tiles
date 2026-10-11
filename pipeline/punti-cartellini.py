#!/usr/bin/env python3
"""
Punti dei cartellini stradali, dalle vie numerate.

ol-mapbox-style 11 piazza l'icona di una linea solo se la linea occupa piu'
di 150 pixel ("FIXME Do not hard-code a size of 150" in stylefunction.js):
alle scale basse le vie OSM sono lunghe pochi pixel e i cartellini non
comparivano. Mapnik invece ne mette uno per via, a distanza minima fra
uguali (shield-min-distance). Qui si fa lo stesso in anticipo: il centro di
ogni via numerata, tenendone per ogni livello solo quelli a 250 pixel dagli
altri con lo stesso numero (shield-min-distance di roads.mss); il livello da
cui un punto compare va in `tippecanoe.minzoom`.

Uso: python3 punti-cartellini.py <vie.geojsonl> <punti.geojsonl> [zmin] [zmax]
"""
import json
import math
import sys

R = 6371000.0


def dist(a, b):
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dp, dl = p2 - p1, math.radians(b[0] - a[0])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def centro(coords):
    """Il punto a meta' lunghezza della linea."""
    tratti = [dist(coords[i], coords[i + 1]) for i in range(len(coords) - 1)]
    meta, fatto = sum(tratti) / 2, 0.0
    for i, t in enumerate(tratti):
        if fatto + t >= meta and t > 0:
            f = (meta - fatto) / t
            a, b = coords[i], coords[i + 1]
            return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], sum(tratti)
        fatto += t
    return coords[0], sum(tratti)


# shield-min-distance di roads.mss: due cartellini con lo stesso numero stanno
# ad almeno 250 pixel. Un pixel a zoom z misura 156543.03 / 2^z metri di
# proiezione, cioe' per cos(lat) metri sul terreno.
DISTANZA_PX = 250
PIXEL_Z0 = 156543.03392804097


def distanza_min(z, lat):
    return DISTANZA_PX * PIXEL_Z0 / 2 ** z * math.cos(math.radians(lat))


def main(src, dst, zmin, zmax):
    per_strada = {}
    for riga in open(src):
        e = json.loads(riga)
        g, p = e["geometry"], e["properties"]
        linee = [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]
        for c in linee:
            if len(c) < 2:
                continue
            pt, lung = centro(c)
            per_strada.setdefault((p["class"], p["ref"]), []).append((lung, pt))
    n = 0
    with open(dst, "w") as out:
        for (classe, ref), cand in per_strada.items():
            # le vie piu' lunghe prima: un cartellino a meta' di un lungo
            # rettilineo e' il piu' leggibile
            cand = [pt for _, pt in sorted(cand, key=lambda x: -x[0])]
            # gerarchia per livello: chi entra a z10 resta a z11 e z12, e ogni
            # livello aggiunge i punti che ora distano almeno 250 pixel
            tenuti = []
            for z in range(zmin, zmax + 1):
                for pt in cand:
                    if any(pt is q for q, _ in tenuti):
                        continue
                    d = distanza_min(z, pt[1])
                    if all(dist(pt, q) >= d for q, _ in tenuti):
                        tenuti.append((pt, z))
            for pt, z in tenuti:
                out.write(json.dumps({"type": "Feature",
                                      "properties": {"class": classe, "ref": ref, "scudo": 1},
                                      "tippecanoe": {"minzoom": z},
                                      "geometry": {"type": "Point", "coordinates": pt}}) + "\n")
                n += 1
    print(f"   {n} cartellini da {len(per_strada)} strade numerate")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 10,
         int(sys.argv[4]) if len(sys.argv) > 4 else 12)
