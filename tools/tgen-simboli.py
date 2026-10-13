"""Inventario dei simboli di TGen: ogni file grafico che project.xml usa entro
z16, con layer, classi e primo livello, e se lo stile locale ha qualcosa che
lo disegna.

Nasce da una richiesta dell'utente (13 ottobre 2026): invece di aspettare che
noti una mancanza guardando la mappa (fermate degli autobus, frecce dei sensi
unici), cercarle tutte allo stesso modo. Un simbolo di TGen senza un
corrispondente locale non si vede in nessuna misura che confronti cio' che
esiste da entrambe le parti.

Corrispondenza: un simbolo e' coperto se lo sprite locale ha `tg-<nome>-*`
(icone e frecce generate dai simboli di TGen) o se style/simboli-locali.json
lo associa a un'icona o a un layer locale scritto a mano. Esce 1 se ne trova
di scoperti.

Uso: python3 tools/tgen-simboli.py data/tgen-style/project.xml [--tutti]
"""
import json
import re
import sys
from collections import defaultdict

XML = open(sys.argv[1]).read()
TUTTI = '--tutti' in sys.argv
SCALA = lambda z: 559082264.028 / 2 ** z
SIMBOLIZZATORI = ('MarkersSymbolizer', 'PointSymbolizer', 'ShieldSymbolizer', 'LinePatternSymbolizer',
                  'PolygonPatternSymbolizer')

stili = {m.group(1): m.group(2) for m in re.finditer(r'<Style [^>]*name="([^"]+)"[^>]*>(.*?)</Style>', XML, re.S)}
usi = defaultdict(lambda: {'layer': set(), 'classi': set(), 'z': 99, 'tipo': set()})
for lay in re.finditer(r'<Layer ([^>]*)>(.*?)</Layer>', XML, re.S):
    nome = re.search(r'name="([^"]+)"', lay.group(1)).group(1)
    mx = re.search(r'maximum-scale-denominator="(\d+)"', lay.group(1))
    zlayer = min(z for z in range(21) if SCALA(z) < int(mx.group(1))) if mx else 0
    for st in re.findall(r'<StyleName><!\[CDATA\[([^\]]+)\]\]></StyleName>', lay.group(2)):
        for r in re.findall(r'<Rule>(.*?)</Rule>', stili.get(st, ''), re.S):
            rmx = re.search(r'<MaxScaleDenominator>(\d+)', r)
            rmn = re.search(r'<MinScaleDenominator>(\d+)', r)
            liv = [z for z in range(zlayer, 21) if (not rmx or SCALA(z) < int(rmx.group(1)))
                   and (not rmn or SCALA(z) >= int(rmn.group(1)))]
            if not liv or liv[0] > 16:
                continue
            fl = re.search(r'<Filter><!\[CDATA\[(.*?)\]\]></Filter>', r, re.S)
            classi = set(re.findall(r"\[(?:feature|highway|railway|power|barrier|man_made|natural|landuse|leisure|amenity)\] = '([^']+)'",
                                    fl.group(1))) if fl else set()
            for tipo in SIMBOLIZZATORI:
                for a in re.findall(r'<%s([^>]*)/?>' % tipo, r):
                    f = re.search(r'file="([^"]+)"', a)
                    if not f or '[' in f.group(1):  # file parametrico (scudi per larghezza): a parte
                        f = f and re.sub(r'\[[^\]]+\]', '*', f.group(1))
                        if not f:
                            continue
                    else:
                        f = f.group(1)
                    u = usi[f.split('/')[-1]]
                    u['layer'].add(nome); u['classi'] |= classi; u['z'] = min(u['z'], liv[0]); u['tipo'].add(tipo.replace('Symbolizer', ''))

import os
sprite = set(json.load(open('style/sprite/webmapp.json')))
locali = json.load(open('style/simboli-locali.json'))['simboli'] if os.path.exists('style/simboli-locali.json') else {}
scoperti = 0
for f, u in sorted(usi.items(), key=lambda kv: (kv[1]['z'], kv[0])):
    base = re.sub(r'\.svg$|\.png$', '', f)
    coperto = any(n.startswith(f'tg-{base}-') for n in sprite) or base in locali
    if not coperto:
        scoperti += 1
    if TUTTI or not coperto:
        dove = locali.get(base, '') if coperto else 'MANCA'
        print(f"z{u['z']:<3}{f:<34}{','.join(sorted(u['tipo'])):<22}{dove:<26}{','.join(sorted(u['layer']))[:40]:<42}{' '.join(sorted(u['classi']))[:90]}")
print(f'\n{len(usi)} simboli usati entro z16, {scoperti} senza corrispondenza locale', file=sys.stderr)
sys.exit(1 if scoperti else 0)
