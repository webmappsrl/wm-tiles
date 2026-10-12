"""Le regole delle icone di TGen, da project.xml a style/amenity-regole.json.

TGen disegna le icone dei punti di interesse con gli stili dei layer
amenity-points (punti), amenity-points-poly (aree) e amenity-low-priority
(parcheggi piccoli, croci...). project.xml e' l'XML compilato che Mapnik legge:
li' i commenti del CartoCSS sono gia' risolti, e una regola vale esattamente
per i livelli dei suoi denominatori di scala. Gli stili sono in filter-mode
"first": a ogni livello vale la prima regola che corrisponde.

Ogni regola diventa: livelli, filtro Mapnik tradotto in un'espressione Python
(valutata da build-amenity.py sulle proprieta' dell'oggetto, `way_pixels`
compresa), icona, colore, opacita'. Le regole senza MarkersSymbolizer (i soli
testi) si scartano: le etichette sono un altro lavoro.

Uso: python3 pipeline/regole-amenity.py data/tgen-style/project.xml > style/amenity-regole.json
"""
import json
import re
import sys

XML = open(sys.argv[1]).read()
SORGENTI = {
    'punti': 'amenity-points',
    'aree': 'amenity-points-poly',
    'bassa': 'amenity-low-priority',
}
# denominatore di scala di Mapnik a un livello (256 px, 0,28 mm per pixel)
SCALA = lambda z: 559082264.028 / 2 ** z
LIVELLI = range(0, 21)


def stili_del_layer(nome):
    """Gli stili del layer e il suo primo livello: anche il layer ha un limite
    di scala (maximum-scale-denominator), oltre quelli delle regole."""
    m = re.search(r'<Layer [^>]*name="%s".*?</Layer>' % re.escape(nome), XML, re.S)
    if not m:
        sys.exit(f'!! layer {nome} assente da project.xml')
    mx = re.search(r'maximum-scale-denominator="(\d+)"', m.group(0)[:600])
    zlayer = min(z for z in LIVELLI if SCALA(z) < int(mx.group(1))) if mx else 0
    return re.findall(r'<StyleName><!\[CDATA\[([^\]]+)\]\]></StyleName>', m.group(0)), zlayer


def filtro_py(f):
    """Filtro Mapnik -> espressione Python su v(campo). Fallisce rumorosamente
    se resta qualcosa che non sa tradurre."""
    s = f
    s = re.sub(r'\[([^\]]+)\]', lambda m: f'v({m.group(1)!r})', s)
    s = s.replace('<>', '!=')
    s = re.sub(r'(?<![!<>=])=(?!=)', '==', s)
    s = re.sub(r'\bnot\b', ' not ', s)
    s = re.sub(r'\bnull\b', 'None', s)
    # quel che resta deve essere solo v('...'), stringhe, numeri, operatori
    pulito = re.sub(r"v\('[^']*'\)|'[^']*'|\d+(\.\d+)?|==|!=|>=|<=|[<>()]|\band\b|\bor\b|\bnot\b|\btrue\b|\bNone\b|\s", '', s)
    if pulito:
        sys.exit(f'!! filtro non tradotto: {f!r} -> resta {pulito!r}')
    return s.replace('true', 'True')


regole = {}
for chiave, layer in SORGENTI.items():
    regole[chiave] = []
    stili, zlayer = stili_del_layer(layer)
    for stile in stili:
        m = re.search(r'<Style filter-mode="first" name="%s">(.*?)</Style>' % re.escape(stile), XML, re.S)
        if not m:
            continue
        for r in re.findall(r'<Rule>(.*?)</Rule>', m.group(1), re.S):
            mk = re.search(r'<MarkersSymbolizer([^>]*)/>', r)
            if not mk:
                continue
            a = dict(re.findall(r'([\w-]+)="([^"]*)"', mk.group(1)))
            if 'file' not in a:
                continue  # marcatori senza file: cerchi e quadrati, non icone
            mx = re.search(r'<MaxScaleDenominator>(\d+)', r)
            mn = re.search(r'<MinScaleDenominator>(\d+)', r)
            liv = [z for z in LIVELLI
                   if z >= zlayer and (not mx or SCALA(z) < int(mx.group(1))) and (not mn or SCALA(z) >= int(mn.group(1)))]
            if not liv:
                continue
            fl = re.search(r'<Filter><!\[CDATA\[(.*?)\]\]></Filter>', r, re.S)
            regole[chiave].append({
                'stile': stile,
                'da': liv[0], 'a': liv[-1],
                'filtro': filtro_py(fl.group(1)) if fl else 'True',
                'icona': a['file'].split('/')[-1].removesuffix('.svg'),
                'percorso': a['file'],
                'colore': a.get('fill', '#000000').lower(),
                'opacita': float(a.get('opacity', 1)),
            })
json.dump(regole, sys.stdout, ensure_ascii=False, indent=1)
print()
