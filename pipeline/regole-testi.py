"""Le regole dei nomi dei punti di interesse di TGen, da project.xml a
style/testi-regole.json.

Sono gli stili dei layer text-point (punti) e text-poly (aree): per ogni
regola con un TextSymbolizer, livelli, filtro (tradotto come in
regole-amenity.py), dimensione, colore, alone, tipo di carattere (fontset:
normale, corsivo, grassetto), larghezza a capo e spostamento verticale
(`dy`, la distanza dall'icona). Gli stili sono in filter-mode "first": a ogni
livello vale la prima regola che corrisponde.

Uso: python3 pipeline/regole-testi.py data/tgen-style/project.xml > style/testi-regole.json
"""
import json
import re
import sys

sys.path.insert(0, __import__('os').path.dirname(__file__))
XML = open(sys.argv[1]).read()
SCALA = lambda z: 559082264.028 / 2 ** z
FONT = {'fontset-0': 'Noto Sans Regular', 'fontset-1': 'Noto Sans Italic', 'fontset-2': 'Noto Sans Bold'}


def filtro_py(f):
    s = re.sub(r'\[([^\]]+)\]', lambda m: f'v({m.group(1)!r})', f)
    s = s.replace('<>', '!=')
    s = re.sub(r'(?<![!<>=])=(?!=)', '==', s)
    s = re.sub(r'\bnot\b', ' not ', s)
    s = re.sub(r'\bnull\b', 'None', s)
    pulito = re.sub(r"v\('[^']*'\)|'[^']*'|\d+(\.\d+)?|==|!=|>=|<=|[<>()]|\band\b|\bor\b|\bnot\b|\btrue\b|\bNone\b|\s", '', s)
    if pulito:
        sys.exit(f'!! filtro non tradotto: {f!r} -> resta {pulito!r}')
    return s.replace('true', 'True')


def stili_del_layer(nome):
    m = re.search(r'<Layer ([^>]*name="%s"[^>]*)>(.*?)</Layer>' % re.escape(nome), XML, re.S)
    if not m:
        sys.exit(f'!! layer {nome} assente da project.xml')
    mx = re.search(r'maximum-scale-denominator="(\d+)"', m.group(1))
    zl = min(z for z in range(21) if SCALA(z) < int(mx.group(1))) if mx else 0
    return re.findall(r'<StyleName><!\[CDATA\[([^\]]+)\]\]></StyleName>', m.group(2)), zl


regole = {}
for chiave, layer in (('punti', 'text-point'), ('aree', 'text-poly')):
    regole[chiave] = []
    stili, zl = stili_del_layer(layer)
    for st in stili:
        m = re.search(r'<Style [^>]*name="%s">(.*?)</Style>' % re.escape(st), XML, re.S)
        if not m:
            continue
        for r in re.findall(r'<Rule>(.*?)</Rule>', m.group(1), re.S):
            ts = re.search(r'<TextSymbolizer([^>]*)><!\[CDATA\[(.*?)\]\]></TextSymbolizer>', r, re.S)
            if not ts:
                continue
            a = dict(re.findall(r'([\w-]+)="([^"]*)"', ts.group(1)))
            mx = re.search(r'<MaxScaleDenominator>(\d+)', r)
            mn = re.search(r'<MinScaleDenominator>(\d+)', r)
            liv = [z for z in range(zl, 21) if (not mx or SCALA(z) < int(mx.group(1)))
                   and (not mn or SCALA(z) >= int(mn.group(1)))]
            if not liv or liv[0] > 16:
                continue
            fl = re.search(r'<Filter><!\[CDATA\[(.*?)\]\]></Filter>', r, re.S)
            regole[chiave].append({
                'da': liv[0], 'a': liv[-1],
                'filtro': filtro_py(fl.group(1)) if fl else 'True',
                'testo': ts.group(2),
                'dim': float(a.get('size', 10)),
                'colore': a.get('fill', '#000000'),
                'alone': a.get('halo-fill', 'rgba(255, 255, 255, 0.6)'),
                'aloneR': float(a.get('halo-radius', 0)),
                'font': FONT.get(a.get('fontset-name'), 'Noto Sans Regular'),
                'acapo': float(a.get('wrap-width', 0)),
                'dy': float(a.get('dy', 0)),
            })
    print(f'{layer}: {len(regole[chiave])} regole con testo entro z16', file=sys.stderr)
json.dump(regole, sys.stdout, ensure_ascii=False, indent=1)
print()
