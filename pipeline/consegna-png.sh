#!/usr/bin/env bash
set -euo pipefail
# Consegna i PNG sul server che li serve, come fa oggi TGen
# (generate_map_tiles.sh: `rsync -avz map/ <server>`): aggiunge e sovrascrive,
# non cancella MAI. Le tile estere e quelle che non rifacciamo restano come
# sono.
#
# Prima di sovrascrivere salva le versioni attuali delle tile che cambiano in
# una copia di sicurezza, dalla parte di wm-tiles: per tornare indietro si
# riconsegna quella cartella con questo stesso script. Le tile che prima non
# esistevano restano anche dopo il ritorno indietro (non si cancella mai).
#
# La destinazione e' una cartella locale (le prove sul Mac) oppure
# host:percorso (produzione; serve rsync >= 3.1 da entrambe le parti).
#
# Uso: pipeline/consegna-png.sh <cartella-png> <destinazione> <cartella-copie>
SRC="${1:?cartella dei PNG da consegnare}"
DEST="${2:?destinazione: cartella locale oppure host:percorso}"
COPIE="${3:?cartella delle copie di sicurezza}"
test -d "$SRC" || { echo "!! $SRC non esiste" >&2; exit 1; }

STAMP=$(date '+%Y%m%d-%H%M%S')
COPIA="$COPIE/$STAMP"
mkdir -p "$COPIA"
LISTA="$COPIA/consegnate.txt"
(cd "$SRC" && find . -name '*.png' | sed 's|^\./||' | sort) > "$LISTA"
N=$(wc -l < "$LISTA" | tr -d ' ')
[ "$N" -gt 0 ] || { echo "== niente da consegnare"; rmdir "$COPIA" 2>/dev/null || rm -rf "$COPIA"; exit 0; }
echo "== consegna di $N tile: $SRC -> $DEST"

case "$DEST" in
  *:*)
    # 1. copia di sicurezza di cio' che sta per essere sovrascritto
    rsync -a --files-from="$LISTA" --ignore-missing-args "$DEST/" "$COPIA/"
    # 2. consegna: rsync scrive in un file temporaneo e rinomina, quindi chi
    #    serve le tile non vede mai un PNG a meta'
    rsync -a --files-from="$LISTA" "$SRC/" "$DEST/"
    ;;
  *)
    mkdir -p "$DEST"
    while read -r F; do
      if [ -f "$DEST/$F" ]; then
        mkdir -p "$COPIA/$(dirname "$F")"
        cp -p "$DEST/$F" "$COPIA/$F"
      fi
    done < "$LISTA"
    while read -r F; do
      mkdir -p "$DEST/$(dirname "$F")"
      cp "$SRC/$F" "$DEST/$F.tmp" && mv "$DEST/$F.tmp" "$DEST/$F"
    done < "$LISTA"
    ;;
esac

SALVATE=$(find "$COPIA" -name '*.png' | wc -l | tr -d ' ')
echo "== consegnate $N tile; $SALVATE erano gia' presenti e sono salvate in $COPIA"
echo "   per tornare indietro: pipeline/consegna-png.sh $COPIA $DEST $COPIE"
