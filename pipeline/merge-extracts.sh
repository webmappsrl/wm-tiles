#!/usr/bin/env bash
set -euo pipefail
# Unisce piu' estratti Geofabrik ritagliandoli su un'area.
#
# Gli estratti di Geofabrik seguono i confini AMMINISTRATIVI: `centro` copre
# Toscana, Umbria, Marche, Lazio, Abruzzo e Molise ma non l'Emilia-Romagna,
# che sta in `nord-est`. Un bbox a cavallo del crinale appenninico ricade su
# due estratti, e usarne uno solo lascia meta' area senza dati — cosa che si
# manifesta come tile mancanti e mappa vuota a nord del confine regionale.
#
# Uso: merge-extracts.sh <W> <S> <E> <N> <out.pbf> <in1.pbf> [in2.pbf ...]
W="${1:?W}"; S="${2:?S}"; E="${3:?E}"; N="${4:?N}"; OUT="${5:?out}"; shift 5
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

PARTI=()
for PBF in "$@"; do
  NOME="$(basename "$PBF" .osm.pbf)"
  echo "== ritaglio $NOME su $W,$S,$E,$N"
  osmium extract -b "$W,$S,$E,$N" "$PBF" -o "$WORK/$NOME.pbf" --overwrite
  ls -la "$WORK/$NOME.pbf" | awk '{printf "   %.1f MB\n", $5/1048576}'
  PARTI+=("$WORK/$NOME.pbf")
done

if [ "${#PARTI[@]}" -eq 1 ]; then
  cp "${PARTI[0]}" "$OUT"
else
  echo "== unisco ${#PARTI[@]} estratti"
  osmium merge "${PARTI[@]}" -o "$OUT" --overwrite
fi
echo "== fatto: $OUT ($(du -h "$OUT" | cut -f1))"
osmium fileinfo "$OUT" | grep -iE "Bounding box|Number of nodes" | sed 's/^/   /' || true
