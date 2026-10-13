"""Come TGen calcola `feature` per i testi: la COALESCE di text-point e
text-poly del project.mml, tradotta in clausole JSON.

E' diversa da quella delle icone (amenity-points): ha piu' classi (negozi per
tipo, landuse, natural, isole...) e un altro ordine, quindi lo stesso oggetto
puo' avere una classe per l'icona e un'altra per il nome. Invece di ricopiarla
a mano si legge dal .mml: ogni clausola deve avere una delle forme note, e su
una forma sconosciuta lo script si ferma.

Uso: python3 pipeline/coalesce-testi.py data/tgen-style/project.mml > style/testi-coalesce.json
"""
import json
import re
import sys

MML = open(sys.argv[1]).read()


def sql_del_layer(nome):
    m = re.search(r'\n  - id: %s\n(.*?)\n  - id: ' % re.escape(nome), MML, re.S)
    if not m:
        sys.exit(f'!! layer {nome} assente dal .mml')
    return m.group(1)


def coalesce(sql):
    i = sql.index('COALESCE(') + len('COALESCE(')
    prof, j = 1, i
    while prof:
        prof += {'(': 1, ')': -1}.get(sql[j], 0)
        j += 1
    corpo = sql[i:j - 1]
    if not sql[j:j + 20].lstrip().startswith('AS feature'):
        sys.exit('!! la COALESCE non e\' quella di feature')
    # clausole: virgole al livello zero di parentesi
    pezzi, prof, inizio = [], 0, 0
    for k, c in enumerate(corpo):
        prof += {'(': 1, ')': -1}.get(c, 0)
        if c == ',' and prof == 0:
            pezzi.append(corpo[inizio:k]); inizio = k + 1
    pezzi.append(corpo[inizio:])
    return [' '.join(p.split()) for p in pezzi]


COL = r"""(?:"?(\w+)"?|tags->'([\w:]+)')"""
LISTA = r"\(([^()]*)\)"
valori = lambda s: re.findall(r"'([^']*)'", s)


def traduci(c):
    col = lambda m, a, b: m.group(a) or m.group(b)
    m = re.fullmatch(r"'(\w+)' \|\| CASE WHEN %s (?:IN|in) %s THEN %s (?:ELSE|else) NULL END" % (COL, LISTA, COL), c)
    if m:
        return {'tipo': 'in', 'pre': m.group(1), 'col': col(m, 2, 3), 'valori': valori(m.group(4))}
    m = re.fullmatch(r"'(\w+)' \|\| CASE WHEN shop IN %s THEN shop WHEN shop IN %s OR shop IS NULL THEN NULL ELSE 'other' END" % (LISTA, LISTA), c)
    if m:
        return {'tipo': 'shop', 'pre': m.group(1), 'valori': valori(m.group(2)), 'esclusi': valori(m.group(3))}
    m = re.fullmatch(r"'office' \|\| CASE WHEN tags->'office' IN %s OR \(tags->'office'\) IS NULL THEN NULL ELSE '' END" % LISTA, c)
    if m:
        return {'tipo': 'office', 'esclusi': valori(m.group(1))}
    m = re.fullmatch(r"'(\w+)' \|\| CASE WHEN \((\w+) IN %s AND \(tags->'location' NOT IN \('roof', 'rooftop'\) OR \(tags->'location'\) IS NULL\)\) THEN \w+ ELSE NULL END" % LISTA, c)
    if m:
        return {'tipo': 'in_fuori_tetto', 'pre': m.group(1), 'col': m.group(2), 'valori': valori(m.group(3))}
    m = re.fullmatch(r"'historic_' \|\| CASE WHEN historic IN %s THEN concat_ws\('_', historic, CASE WHEN tags->'memorial' IN \('plaque'\) THEN tags->'memorial' ELSE NULL END\) ELSE NULL END" % LISTA, c)
    if m:
        return {'tipo': 'historic', 'valori': valori(m.group(1))}
    sys.exit(f'!! clausola non tradotta:\n   {c}')


uscita = {}
for chiave, layer in (('punti', 'text-point'), ('aree', 'text-poly')):
    uscita[chiave] = [traduci(c) for c in coalesce(sql_del_layer(layer))]
    print(f'{layer}: {len(uscita[chiave])} clausole', file=sys.stderr)
json.dump(uscita, sys.stdout, ensure_ascii=False, indent=1)
print()
