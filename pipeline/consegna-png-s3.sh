#!/usr/bin/env bash
set -euo pipefail
# Consegna i PNG su S3, serviti da CloudFront (infra/tiles-png.yaml): carica le
# tile di una cartella z/x/y.png e invalida in CloudFront quelle caricate.
#
# Come consegna-png.sh aggiunge e sovrascrive, non cancella MAI, e i permessi
# di chi consegna non lo consentono. La versione precedente di ogni tile la
# conserva il versioning del bucket: nel registro restano l'elenco consegnato
# e l'ora, e per tornare indietro basta
#   pipeline/ripristina-png-s3.sh <registro>/<ora> <destinazione> <distribuzione>
#
# Intestazioni: il browser tiene una tile 7 giorni, come oggi su
# api.webmapp.it (max-age); CloudFront un anno (s-maxage), perche' a ogni
# consegna si invalida cio' che cambia.
#
# Uso: pipeline/consegna-png-s3.sh <cartella-png> s3://<bucket>[/<prefisso>] <id-distribuzione> <cartella-registro>
SRC="${1:?cartella dei PNG da consegnare}"
DEST="${2:?destinazione: s3://bucket[/prefisso]}"
DIST="${3:?id della distribuzione CloudFront}"
REGISTRO="${4:?cartella del registro delle consegne}"
DEST="${DEST%/}"
case "$DEST" in s3://*) ;; *) echo "!! la destinazione deve essere s3://bucket[/prefisso]" >&2; exit 2 ;; esac
test -d "$SRC" || { echo "!! $SRC non esiste" >&2; exit 1; }
command -v aws >/dev/null || { echo "!! serve aws CLI v2" >&2; exit 1; }

ORA=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
REG="$REGISTRO/$(date -u '+%Y%m%d-%H%M%S')"
mkdir -p "$REG"
echo "$ORA" > "$REG/ora.txt"
LISTA="$REG/consegnate.txt"
(cd "$SRC" && find . -name '*.png' | sed 's|^\./||' | sort) > "$LISTA"
N=$(wc -l < "$LISTA" | tr -d ' ')
[ "$N" -gt 0 ] || { echo "== niente da consegnare"; rm -rf "$REG"; exit 0; }
echo "== consegna di $N tile: $SRC -> $DEST"

aws s3 cp "$SRC" "$DEST" --recursive --exclude '*' --include '*.png' \
  --content-type image/png --cache-control 'public, max-age=604800, s-maxage=31536000' --only-show-errors

# Le prime 1000 invalidazioni al mese sono gratuite: oltre le 1000 tile se ne
# fa una sola, su tutto il prefisso.
BP="${DEST#s3://}"
PREF=""
[ "$BP" = "${BP%%/*}" ] || PREF="${BP#*/}/"
LOTTO="$REG/invalidazione.json"
node -e '
  const [lista, pref, n, ora] = process.argv.slice(1);
  const percorsi = Number(n) > 1000 ? [`/${pref}*`]
    : require("fs").readFileSync(lista, "utf8").split("\n").filter(Boolean).map(f => `/${pref}${f}`);
  process.stdout.write(JSON.stringify({Paths: {Quantity: percorsi.length, Items: percorsi}, CallerReference: `wm-tiles-${ora}`}));
' "$LISTA" "$PREF" "$N" "$ORA" > "$LOTTO"
ID=$(aws cloudfront create-invalidation --distribution-id "$DIST" --invalidation-batch "file://$LOTTO" \
  --query 'Invalidation.Id' --output text)

echo "== consegnate $N tile, invalidazione $ID; registro in $REG"
echo "   per tornare indietro: pipeline/ripristina-png-s3.sh $REG $DEST $DIST"
