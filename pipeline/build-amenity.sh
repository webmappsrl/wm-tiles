#!/usr/bin/env bash
set -euo pipefail
# Icone dei punti di interesse come amenity-points di TGen: dal PBF
# all'archivio PMTiles (layer `amenity`). La classe, l'icona e il livello
# d'ingresso li calcola build-amenity.py valutando le regole di project.xml
# (style/amenity-regole.json).
#
# Uso: build-amenity.sh <pbf> <W> <S> <E> <N> <out.pmtiles>
PBF="${1:?pbf}"; W="${2:?W}"; S="${3:?S}"; E="${4:?E}"; N="${5:?N}"; OUT="${6:?out}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

echo "== icone dei punti di interesse da $PBF"
docker run --rm -v "$PWD":/w -v "$WORK":/out -e CPL_LOG=/dev/null \
  --entrypoint python3 ghcr.io/osgeo/gdal:ubuntu-small-latest -I \
  /w/pipeline/build-amenity.py "/w/$PBF" "$W" "$S" "$E" "$N" /w/style/amenity-regole.json /out/amenity.geojsonl
echo "== frecce dei sensi unici"
docker run --rm -v "$PWD":/w -v "$WORK":/out -e CPL_LOG=/dev/null \
  --entrypoint python3 ghcr.io/osgeo/gdal:ubuntu-small-latest -I \
  /w/pipeline/build-frecce.py "/w/$PBF" "$W" "$S" "$E" "$N" /w/style/frecce-colori.json /out/frecce.geojsonl
echo "== nomi dei corsi d'acqua lungo la linea"
# come water-lines-text di TGen: fiumi e canali da z13 (12 px da z14, ogni
# 400 px), torrenti e fossi da z15 (10 px, ogni 600 px, 8 px sotto la linea).
# Punti ruotati, posizionati come Mapnik (punti-lungo-linee.py): lungo la
# linea OpenLayers ne piazzava pochissimi
docker run --rm -v "$PWD":/w -v "$WORK":/out \
  --entrypoint ogr2ogr ghcr.io/osgeo/gdal:ubuntu-small-latest \
  -f GeoJSONSeq /out/acque.geojsonl "/w/$PBF" -spat "$W" "$S" "$E" "$N" -lco COORDINATE_PRECISION=6 \
  -sql "SELECT name, waterway AS c FROM lines WHERE name IS NOT NULL
        AND waterway IN ('river', 'canal', 'stream', 'drain', 'ditch')"
PL="python3 pipeline/punti-lungo-linee.py $WORK/acque.geojsonl"
$PL "$WORK/n1.geojsonl" --testo name --campi c --zoom 13-13 --spaziatura 400 --dimensione 10 --filtro "p['c'] in ('river', 'canal')"
$PL "$WORK/n2.geojsonl" --testo name --campi c --zoom 14-16 --spaziatura 400 --dimensione 12 --filtro "p['c'] == 'river'"
$PL "$WORK/n3.geojsonl" --testo name --campi c --zoom 14-16 --spaziatura 400 --dimensione 10 --filtro "p['c'] == 'canal'"
$PL "$WORK/n4.geojsonl" --testo name --campi c --zoom 15-16 --spaziatura 600 --dimensione 10 --dy 8 --filtro "p['c'] in ('stream', 'drain', 'ditch')"
cat "$WORK"/n[1-4].geojsonl > "$WORK/nomi-acque.geojsonl"
echo "== nomi dei punti di interesse"
docker run --rm -v "$PWD":/w -v "$WORK":/out -e CPL_LOG=/dev/null \
  --entrypoint python3 ghcr.io/osgeo/gdal:ubuntu-small-latest -I \
  /w/pipeline/build-testi.py "/w/$PBF" "$W" "$S" "$E" "$N" \
  /w/style/testi-coalesce.json /w/style/testi-regole.json /out/testi.geojsonl /w/style/glifi-larghezze.json
# -r1: nessun diradamento, ogni icona entra al suo livello (CLAUDE.md:
# tippecanoe dirada i punti sotto il livello massimo e ne sparivano a caso);
# l'ordine e' quello di TGen, e decide chi vince nelle collisioni
tippecanoe -t "${TMPDIR:-/tmp}" -o "$WORK/a.mbtiles" --force -q -Z10 -z16 -r1 \
  --no-feature-limit --no-tile-size-limit --preserve-input-order \
  -L amenity:"$WORK/amenity.geojsonl" -L frecce:"$WORK/frecce.geojsonl" -L testi:"$WORK/testi.geojsonl" -L nomi_acque:"$WORK/nomi-acque.geojsonl"
pmtiles convert "$WORK/a.mbtiles" "$OUT"
echo "== fatto: $OUT ($(du -h "$OUT" | cut -f1))"
