#!/usr/bin/env bash
set -euo pipefail
# Riporta le tile di una consegna su S3 (consegna-png-s3.sh) alla versione che
# avevano prima, usando il versioning del bucket.
#
# Per ogni tile consegnata, l'ultima versione PRECEDENTE all'ora della consegna
# torna corrente: e' una copia, quindi non si cancella nulla e anche il
# ripristino si puo' annullare. Le tile che prima non esistevano restano, come
# con consegna-png.sh. Le versioni precedenti durano quanto dice il bucket
# (GiorniVersioniVecchie in infra/tiles-png.yaml).
#
# Uso: pipeline/ripristina-png-s3.sh <registro-della-consegna> s3://<bucket>[/<prefisso>] <id-distribuzione>
REG="${1:?cartella del registro della consegna (contiene ora.txt e consegnate.txt)}"
DEST="${2:?destinazione: s3://bucket[/prefisso]}"
DIST="${3:?id della distribuzione CloudFront}"
DEST="${DEST%/}"
ORA=$(cat "$REG/ora.txt")
LISTA="$REG/consegnate.txt"
BP="${DEST#s3://}"
BUCKET="${BP%%/*}"
PREF=""
[ "$BP" = "$BUCKET" ] || PREF="${BP#*/}/"

N=0; NUOVE=0
while read -r F; do
  KEY="$PREF$F"
  # l'ultima versione salvata prima della consegna (JMESPath non confronta le date: lo fa node)
  V=$(aws s3api list-object-versions --bucket "$BUCKET" --prefix "$KEY" --output json \
    | node -e '
        let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
          const [key, ora] = process.argv.slice(1);
          const prima = (JSON.parse(s || "{}").Versions ?? [])
            .filter(v => v.Key === key && new Date(v.LastModified) < new Date(ora))
            .sort((a, b) => new Date(a.LastModified) - new Date(b.LastModified));
          process.stdout.write(prima.at(-1)?.VersionId ?? "");
        });' "$KEY" "$ORA")
  if [ -z "$V" ]; then NUOVE=$((NUOVE + 1)); continue; fi
  aws s3api copy-object --bucket "$BUCKET" --key "$KEY" --copy-source "$BUCKET/$KEY?versionId=$V" \
    --metadata-directive COPY > /dev/null
  N=$((N + 1))
done < "$LISTA"

TOT=$(wc -l < "$LISTA" | tr -d ' ')
LOTTO="$(mktemp)"
node -e '
  const [lista, pref, n] = process.argv.slice(1);
  const percorsi = Number(n) > 1000 ? [`/${pref}*`]
    : require("fs").readFileSync(lista, "utf8").split("\n").filter(Boolean).map(f => `/${pref}${f}`);
  process.stdout.write(JSON.stringify({Paths: {Quantity: percorsi.length, Items: percorsi}, CallerReference: `wm-tiles-ripristino-${Date.now()}`}));
' "$LISTA" "$PREF" "$TOT" > "$LOTTO"
ID=$(aws cloudfront create-invalidation --distribution-id "$DIST" --invalidation-batch "file://$LOTTO" \
  --query 'Invalidation.Id' --output text)
rm -f "$LOTTO"
echo "== ripristinate $N tile su $TOT; $NUOVE non esistevano prima e restano; invalidazione $ID"
