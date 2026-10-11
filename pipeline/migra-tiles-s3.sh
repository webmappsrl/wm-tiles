#!/usr/bin/env bash
set -euo pipefail
# Copia UNA VOLTA su S3 tutte le tile servite oggi da api.webmapp.it, comprese
# quelle estere e i livelli che wm-tiles non rifa' (alcune z17-z18 toscane):
# le app che passano al nuovo indirizzo devono trovare tutto.
#
# Il server di origine e' in produzione: da li' solo letture (rsync verso una
# copia locale), nessuna scrittura. Poi caricamento con `aws s3 sync`, che se
# si interrompe riprende da dove si e' fermato, e verifica dei conteggi.
#
# Uso: pipeline/migra-tiles-s3.sh <utente@host:percorso> <cartella-locale> s3://<bucket>[/<prefisso>]
#   es.: root@46.101.124.52:/root/api.webmapp.it/tiles data/tiles-api s3://webmapp-tiles
# Per milioni di file conviene alzare il parallelismo di aws CLI:
#   aws configure set default.s3.max_concurrent_requests 64
SRC="${1:?origine: utente@host:percorso}"
LOC="${2:?cartella locale per la copia}"
DEST="${3:?destinazione: s3://bucket[/prefisso]}"
DEST="${DEST%/}"
case "$DEST" in s3://*) ;; *) echo "!! la destinazione deve essere s3://bucket[/prefisso]" >&2; exit 2 ;; esac
command -v aws >/dev/null || { echo "!! serve aws CLI v2" >&2; exit 1; }

mkdir -p "$LOC"
echo "== 1. copia locale da $SRC"
rsync -a --stats "${SRC%/}/" "$LOC/" | grep -E "Number of (regular )?files|Total file size" || true
NL=$(find "$LOC" -name '*.png' | wc -l | tr -d ' ')

echo "== 2. caricamento di $NL tile su $DEST"
aws s3 sync "$LOC" "$DEST" --exclude '*' --include '*.png' \
  --content-type image/png --cache-control 'public, max-age=604800, s-maxage=31536000' --only-show-errors

echo "== 3. verifica"
NS=$(aws s3 ls "$DEST/" --recursive | grep -c '\.png$' || true)
echo "   $NL tile nella copia locale, $NS sul bucket"
if [ "$NS" -lt "$NL" ]; then
  echo "!! mancano $((NL - NS)) tile sul bucket: rilancia lo script, riprende da dove si e' fermato" >&2
  exit 1
fi
echo "== fatto: le app possono passare al nuovo indirizzo"
