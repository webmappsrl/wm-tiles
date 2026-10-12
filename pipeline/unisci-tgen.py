"""Unisce in un GeoJSON (una riga per elemento) layer copiati da TGen.

Tiene solo i campi indicati, rinominandoli se serve (`code_12=code`: il nome
che lo stile usa per Corine), e scrive in `src` da quale layer di TGen viene
ogni elemento. L'ordine dei layer e' l'ordine di disegno: chi viene dopo copre
chi viene prima, come in Mapnik.

Lo usano build-celle.sh (piu' copie, una per cella) e build-italia.sh (la copia
nazionale).

Uso: python3 unisci-tgen.py <uscita> <campi: nome|nome=nuovo,...> <copia>[,<copia>...] <layer>...
"""
import gzip
import json
import os
import sys

out, campi, copie, layer = sys.argv[1], sys.argv[2].split(","), sys.argv[3].split(","), sys.argv[4:]
mappa = dict((c.split("=") + [c])[:2] for c in campi)
n = 0
with open(out, "w") as f:
    for nome in layer:
        for copia in copie:
            p = f"{copia}/{nome}.geojsonl.gz"
            if not os.path.exists(p):
                sys.exit(f"manca {p}: rifare copia-da-tgen.sh")
            with gzip.open(p, "rt") as g:
                for riga in g:
                    e = json.loads(riga)
                    pr = e["properties"]
                    e["properties"] = {nuovo: pr[vecchio] for vecchio, nuovo in mappa.items() if vecchio in pr}
                    e["properties"]["src"] = nome
                    f.write(json.dumps(e, separators=(",", ":")) + "\n")
                    n += 1
print(f"   {os.path.basename(out)}: {n} elementi da {len(layer)} layer")
