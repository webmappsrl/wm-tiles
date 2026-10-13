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
# -r1: nessun diradamento, ogni icona entra al suo livello (CLAUDE.md:
# tippecanoe dirada i punti sotto il livello massimo e ne sparivano a caso);
# l'ordine e' quello di TGen, e decide chi vince nelle collisioni
tippecanoe -t "${TMPDIR:-/tmp}" -o "$WORK/a.mbtiles" --force -q -Z10 -z16 -r1 \
  --no-feature-limit --no-tile-size-limit --preserve-input-order \
  -L amenity:"$WORK/amenity.geojsonl" -L frecce:"$WORK/frecce.geojsonl"
pmtiles convert "$WORK/a.mbtiles" "$OUT"
echo "== fatto: $OUT ($(du -h "$OUT" | cut -f1))"
