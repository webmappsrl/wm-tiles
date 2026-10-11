#!/usr/bin/env bash
set -euo pipefail
# Il ciclo di aggiornamento dei PNG, dall'inizio alla fine:
#
#   1. OpenStreetMap: ogni estratto riceve le modifiche giornaliere mancanti
#      (aggiorna-osm.sh), senza riscaricarlo;
#   2. archivi: si rifanno solo quelli di OSM (build-celle.sh --solo-osm);
#      dati di TGen, DEM e curve restano;
#   3. confronto: quali PNG dipendono da tile cambiate (diff-versioni.mjs);
#   4. rendering dei soli PNG cambiati (render-png.mjs), con il server acceso
#      sulla versione nuova;
#   5. consegna, con copia di sicurezza di cio' che si sovrascrive
#      (consegna-png.sh).
#
# Il primo giro di un'area nuova non e' un aggiornamento: si generano e si
# consegnano tutti i PNG (render-png.mjs --bbox, poi consegna-png.sh).
#
# Il server deve girare (render-png.mjs lo usa) e servire la versione appena
# pubblicata: la versione corrente e' la cartella piu' recente, letta a ogni
# richiesta, quindi non serve riavviarlo per gli archivi di OSM.
#
# Uso: pipeline/aggiorna-png.sh <destinazione> <cartella-copie> [--bbox W,S,E,N] \
#        <nome>:<W,S,E,N>:<pbf> [...]
DEST="${1:?destinazione dei PNG: cartella o host:percorso}"
COPIE="${2:?cartella delle copie di sicurezza}"
shift 2
BBOX_OPZ=()
if [ "${1:-}" = "--bbox" ]; then BBOX_OPZ=(--bbox "${2:?riquadro}"); shift 2; fi
[ $# -ge 1 ] || { echo "uso: aggiorna-png.sh <dest> <copie> [--bbox W,S,E,N] <nome>:<W,S,E,N>:<pbf> ..." >&2; exit 2; }

PREC="$(ls -d data/archives/2*/ | sort | tail -1)"; PREC="${PREC%/}"
V="$(date '+%Y%m%d-%H%M')"
[ "data/archives/$V" != "$PREC" ] || { echo "!! la versione $V esiste gia': riprova fra un minuto" >&2; exit 1; }
echo "== aggiornamento: $PREC -> data/archives/$V"

# 1. OSM: ogni estratto, una volta sola anche se serve piu' celle
CELLE=()
for C in "$@"; do
  IFS=: read -r NOME BBOX PBF <<< "$C"
  CELLE+=("$NOME:$BBOX:$PBF")
done
for PBF in $(printf '%s\n' "${CELLE[@]}" | cut -d: -f3 | sort -u); do
  bash pipeline/aggiorna-osm.sh "$PBF" "$PBF.nuovo"
  mv "$PBF" "$PBF.precedente"; mv "$PBF.nuovo" "$PBF"
done

# 2. archivi OSM
bash pipeline/build-celle.sh --solo-osm "$V" "${CELLE[@]}"

# 3. confronto
LISTA="data/archives/$V/png-da-rifare.txt"
node pipeline/diff-versioni.mjs "$PREC" "data/archives/$V" "${BBOX_OPZ[@]}" > "$LISTA"
N=$(wc -l < "$LISTA" | tr -d ' ')
if [ "$N" -eq 0 ]; then echo "== nessun PNG da rifare"; exit 0; fi

# 4. rendering dei soli PNG cambiati. Se il binario di maplibre-native non si
#    carica sul sistema (librerie diverse da quelle con cui e' compilato), si
#    usa l'immagine Docker che le fissa.
PNG="data/png-aggiornamenti/$V"
if node -e "require('@maplibre/maplibre-gl-native')" 2>/dev/null; then
  node pipeline/render-png.mjs --tiles "$LISTA" --out "$PNG"
else
  bash pipeline/render-png-docker.sh --tiles "$LISTA" --out "$PNG"
fi

# 5. consegna
bash pipeline/consegna-png.sh "$PNG" "$DEST" "$COPIE"
echo "== fatto: $N PNG rifatti e consegnati (versione $V)"
