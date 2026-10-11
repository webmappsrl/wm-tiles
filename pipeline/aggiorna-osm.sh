#!/usr/bin/env bash
set -euo pipefail
# Porta un estratto Geofabrik all'ultimo stato pubblicato, applicando le
# modifiche giornaliere invece di riscaricare l'estratto intero.
#
# Da dove ripartire lo dice il file stesso: Geofabrik scrive nell'intestazione
# l'indirizzo delle modifiche e il numero dell'ultima applicata
# (osmosis_replication_*). Si scaricano le mancanti, si applicano con osmium
# e si riscrive l'intestazione col nuovo stato: la volta dopo si riparte da
# li', senza tenere un registro a parte.
#
# Le modifiche coprono l'intera regione Geofabrik: il ritaglio sulle celle lo
# fa build-celle.sh.
#
# Uso: pipeline/aggiorna-osm.sh <in.osm.pbf> <out.osm.pbf>
IN="${1:?estratto da aggiornare}"; OUT="${2:?estratto aggiornato}"
test -f "$IN" || { echo "!! $IN non esiste" >&2; exit 1; }

BASE=$(osmium fileinfo -g header.option.osmosis_replication_base_url "$IN")
SEQ=$(osmium fileinfo -g header.option.osmosis_replication_sequence_number "$IN")
[ -n "$BASE" ] && [ -n "$SEQ" ] || { echo "!! $IN non dice da dove ripartire (osmosis_replication_*)" >&2; exit 1; }

STATO=$(curl -sSf "$BASE/state.txt")
ULTIMO=$(echo "$STATO" | sed -n 's/^sequenceNumber=//p')
QUANDO=$(echo "$STATO" | sed -n 's/^timestamp=//p' | tr -d '\\')
echo "== $IN: modifica $SEQ, Geofabrik e' alla $ULTIMO ($QUANDO)"

if [ "$SEQ" -ge "$ULTIMO" ]; then
  echo "== gia' aggiornato"
  [ "$IN" = "$OUT" ] || cp "$IN" "$OUT"
  exit 0
fi

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
for S in $(seq $((SEQ + 1)) "$ULTIMO"); do
  # Il percorso spezza il numero a gruppi di tre cifre: 3960 -> 000/003/960
  P=$(printf '%03d/%03d/%03d' $((S / 1000000)) $((S / 1000 % 1000)) $((S % 1000)))
  curl -sSf --retry 3 -o "$WORK/$(printf '%09d' "$S").osc.gz" "$BASE/$P.osc.gz"
done
N=$(ls "$WORK"/*.osc.gz | wc -l | tr -d ' ')
echo "== applico $N modifiche ($(du -ch "$WORK"/*.osc.gz | tail -1 | cut -f1))"

# I nomi a nove cifre tengono l'ordine giusto: le modifiche vanno applicate
# nella sequenza in cui sono state pubblicate.
osmium apply-changes "$IN" "$WORK"/*.osc.gz -o "$OUT.tmp.osm.pbf" --overwrite \
  --output-header="osmosis_replication_base_url=$BASE" \
  --output-header="osmosis_replication_sequence_number=$ULTIMO" \
  --output-header="osmosis_replication_timestamp=$QUANDO"
mv "$OUT.tmp.osm.pbf" "$OUT"
echo "== fatto: $OUT, modifica $ULTIMO ($QUANDO)"
