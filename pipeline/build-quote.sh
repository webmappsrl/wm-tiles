#!/usr/bin/env bash
set -euo pipefail
# Le quote delle curve di livello come punti ruotati, dall'archivio delle
# curve di dettaglio (GeoJSONSeq con `quota` e `type`), nell'archivio `quote`.
#
# Come cl_hr_labels e cl_hr_subd_labels di TGen: solo le direttrici (cp*),
# 8 px a z14 (2 px sopra la linea), 9 px da z15 (3 px sopra). Le posizioni le
# cerca punti-lungo-linee.py come Mapnik, una ogni 128 px dove la linea e'
# abbastanza dritta: lungo le linee OpenLayers ne piazzava una su cinque
# (13 ottobre 2026). Spaziatura e angolo tarati sui PNG di TGen (6 quote su 6
# nella tile 15/17361/12023).
#
# Uso: build-quote.sh <cl_hr.geojsonl> <out.pmtiles>
IN="${1:?}"; OUT="${2:?}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
PL="python3 $(dirname "$0")/punti-lungo-linee.py $IN"
F="str(p.get('type', '')).startswith('cp') and (p.get('quota') or 0) > 0"
$PL "$WORK/q14.geojsonl" --testo quota --zoom 14-14 --spaziatura 128 --angolo 30 --dimensione 8 --dy -2 --filtro "$F"
$PL "$WORK/q15.geojsonl" --testo quota --zoom 15-16 --spaziatura 128 --angolo 30 --dimensione 9 --dy -3 --filtro "$F"
cat "$WORK"/q14.geojsonl "$WORK"/q15.geojsonl > "$WORK/quote.geojsonl"
tippecanoe -t "${TMPDIR:-/tmp}" -o "$WORK/q.mbtiles" --force -q -l quote -Z14 -z16 -r1 \
  --no-feature-limit --no-tile-size-limit "$WORK/quote.geojsonl"
pmtiles convert "$WORK/q.mbtiles" "$OUT"
echo "== fatto: $OUT ($(du -h "$OUT" | cut -f1))"
