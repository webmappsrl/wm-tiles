#!/usr/bin/env bash
set -euo pipefail
# I nomi delle strade come punti ruotati, posizionati come Mapnik.
#
# Lungo una linea OpenLayers prova posizioni fisse e scarta quelle troppo curve,
# Mapnik cerca il tratto dritto: TGen scriveva piu' nomi di strade (giro di
# revisione italia1, z14 e z16, 14 ottobre 2026), come prima per le quote delle
# curve. Qui la ricerca si fa nel dato con punti-lungo-linee.py, una via OSM per
# volta come roads-text-name di TGen (planet_osm_line, non le vie unite di
# OpenMapTiles), ogni 300 px come il suo `spacing`.
#
# Classi, livelli e dimensioni sono quelli dei layer road-label* dello stile,
# gia' tarati su TGen; il gruppo `g` sceglie colore e alone.
#
# Uso: build-nomi-strade.sh <pbf> <W> <S> <E> <N> <out.pmtiles>
PBF="${1:?}"; W="${2:?}"; S="${3:?}"; E="${4:?}"; N="${5:?}"; OUT="${6:?}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

echo "== filtro il PBF"
osmium tags-filter "$PBF" -o "$WORK/strade.osm.pbf" --overwrite w/highway w/name
echo "== estraggo le vie con nome"
docker run --rm -v "$WORK":/out --entrypoint ogr2ogr ghcr.io/osgeo/gdal:ubuntu-small-latest \
  -f GeoJSONSeq /out/vie.geojsonl /out/strade.osm.pbf -spat "$W" "$S" "$E" "$N" \
  -lco COORDINATE_PRECISION=6 \
  -sql "SELECT name, highway FROM lines WHERE name IS NOT NULL AND highway IS NOT NULL"
echo "   $(wc -l < "$WORK/vie.geojsonl" | tr -d ' ') vie"

# gruppo: classe dei layer road-label* (le *_link come la loro strada)
python3 -I -c '
import json, sys
G = {"motorway": "major", "trunk": "major", "primary": "major", "secondary": "major",
     "tertiary": "tertiary",
     "unclassified": "minor", "residential": "minor", "living_street": "minor", "road": "minor",
     "service": "service", "track": "track",
     "path": "path", "footway": "path", "cycleway": "path", "bridleway": "path", "steps": "path"}
for riga in open(sys.argv[1]):
    f = json.loads(riga)
    p = f["properties"]
    h = (p.get("highway") or "").removesuffix("_link")
    if h in G:
        p["g"] = G[h]
        p["mt"] = 1 if h in ("motorway", "trunk") else 0
        print(json.dumps(f, ensure_ascii=False))
' "$WORK/vie.geojsonl" > "$WORK/vie-o.geojsonl"
# nell'ordine di roads-text-name: z_order DESC, length(name) DESC, name DESC (nei
# giri gia' separati per classe resta il nome): con --collisioni chi viene prima
# vince, e Mapnik prova prima i nomi lunghi
python3 -I -c '
import json, sys
r = [l for l in open(sys.argv[1])]
r.sort(key=lambda l: (lambda n: (-len(n), [-ord(c) for c in n]))(json.loads(l)["properties"]["name"]))
sys.stdout.write("".join(r))
' "$WORK/vie-o.geojsonl" > "$WORK/vie-g.geojsonl"

# Ogni giro evita le etichette gia' scritte dai giri prima (--evita) e dalle
# precedenti dello stesso giro, col riquadro ridotto di 6 px come lo stile.
# livello -> gruppi visibili e dimensione (road-label*: major da z13, tertiary e
# track/minor da z14-z15, service e path da z16)
PL="python3 -I pipeline/punti-lungo-linee.py $WORK/vie-g.geojsonl"
: > "$WORK/nomi.geojsonl"
punti() {  # punti <zoom> <dimensione> <gruppi separati da virgola>
  local z=$1 dim=$2 gruppi=$3
  $PL "$WORK/n.geojsonl" --testo name --zoom "$z-$z" --spaziatura 300 --dimensione "$dim" \
    --filtro "p['g'] in '$gruppi'.split(',')" --campi g,mt --glifi style/glifi-larghezze.json R --collisioni --padding 6 --evita "$WORK/nomi.geojsonl"
  cat "$WORK/n.geojsonl" >> "$WORK/nomi.geojsonl"
}
punti 13 8 major
punti 14 9 major,tertiary
punti 15 10 major
punti 15 9 tertiary
punti 15 8 minor,track
punti 16 10 major
punti 16 9 tertiary,minor,track,service,path
echo "   $(wc -l < "$WORK/nomi.geojsonl" | tr -d ' ') nomi"

tippecanoe -t "${TMPDIR:-/tmp}" -o "$WORK/n.mbtiles" --force -q -l nomi_strade -Z13 -z16 -r1 \
  --no-feature-limit --no-tile-size-limit "$WORK/nomi.geojsonl"
pmtiles convert "$WORK/n.mbtiles" "$OUT"
ls -la "$OUT" | awk '{printf "== fatto: %s (%.1f MB)\n", $9, $5/1048576}'
