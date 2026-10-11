#!/usr/bin/env bash
set -euo pipefail
# Copia da TGen, una volta, tutto cio' che wm-tiles legge da li'.
#
# Cosa: i layer PostGIS del project.mml che non sono OpenStreetMap (le query
# in pipeline/sql/tgen/, generate da tgen-layer-sql.py), l'inventario delle
# celle generate (grid_1x1) e il DEM TINITALY a 10 m.
#
# TGen e' in SOLA LETTURA (CLAUDE.md, vincolo 1): qui ci sono solo COPY ...
# TO STDOUT e `tar cf -` su stdout, le query entrano da stdin, su TGen non si
# scrive niente. Ogni comando SSH viene stampato prima di partire.
#
# Riprende da dove si era fermato: cio' che e' gia' stato copiato si salta.
# Un file appare solo completo (si scrive in .tmp e si rinomina).
#
# Con un riquadro copia solo quello: le stesse query limitate alla cella e,
# di TINITALY, solo i file che la toccano. Senza, copia tutta l'Italia, che
# richiede ore.
#
# Uso: pipeline/copia-da-tgen.sh <cartella-destinazione> [W,S,E,N]
DEST="${1:?cartella di destinazione}"
BBOX="${2:-}"
SQL="pipeline/sql/tgen"
ITALIA_ENV="ST_MakeEnvelope(6.6, 35.4, 18.6, 47.1, 4326)"
if [ -n "$BBOX" ]; then
  echo "$BBOX" | grep -Eq '^-?[0-9.]+,-?[0-9.]+,-?[0-9.]+,-?[0-9.]+$' \
    || { echo "!! riquadro non valido: $BBOX (atteso W,S,E,N)" >&2; exit 2; }
  ENV="ST_MakeEnvelope($(echo "$BBOX" | sed 's/,/, /g'), 4326)"
else
  ENV="$ITALIA_ENV"
fi
# La query di un layer, col riquadro richiesto. Se l'ancora non c'e' il
# comando deve fallire: una query rimasta sull'Italia intera copierebbe ore
# di dati senza che nulla lo segnali.
query() {
  grep -qF "$ITALIA_ENV" "$1" || { echo "!! $1: riquadro dell'Italia non trovato" >&2; exit 1; }
  sed "s/$ITALIA_ENV/$ENV/" "$1"
}
TINITALY_DIR="/mnt/sdb1/mapdata/dem/it_original"
# 193 GeoTIFF; con mosaic.vrt la cartella ne conta 194 (copiati l'11 ottobre 2026)
TINITALY_FILE=193
TINITALY_GB=16

test -f "$SQL/manifest.tsv" || { echo "!! manca $SQL/manifest.tsv: lancia prima tgen-layer-sql.py" >&2; exit 1; }
mkdir -p "$DEST"
LOG="$DEST/copia.log"
log() { echo "$(date '+%F %T') $*" | tee -a "$LOG"; }
mostra() { echo "  \$ $*" | tee -a "$LOG"; }
# Quanti file di TINITALY ci sono gia'. Con `pipefail` un `find` su una
# cartella che non esiste ancora farebbe uscire lo script senza un messaggio.
conta_tif() {
  if [ -d "$DEST/tinitaly" ]; then find "$DEST/tinitaly" -name '*.tif' | wc -l | tr -d ' '; else echo 0; fi
}

# ---------------------------------------------------------------------------
# 0. Quanto pesa, e se c'e' posto. Il peso delle tabelle (indici compresi)
#    fa da tetto: esportate e compresse pesano meno.
# ---------------------------------------------------------------------------
NECESSARI_KB=0
if [ -n "$BBOX" ]; then
  log "== 0. riquadro $BBOX: dati pochi, basta che ci siano 10 GB liberi"
  NECESSARI_KB=$((10 * 1024 * 1024))
  DATABASE=""
else
  log "== 0. pesi delle tabelle su TGen"
  DATABASE="general igm_dbsn"
fi
for DB in $DATABASE; do
  TABELLE=$(awk -F'\t' -v db="$DB" 'NR > 1 && $2 == db { print $4 }' "$SQL/manifest.tsv" \
    | tr ',' '\n' | sort -u | sed "s/.*/'&'/" | paste -sd, -)
  [ -n "$TABELLE" ] || continue
  Q="SELECT relname, pg_total_relation_size(oid) / 1024 FROM pg_class WHERE relkind = 'r' AND relname IN ($TABELLE) ORDER BY 2 DESC;"
  mostra "ssh tgen 'psql -X -At -d $DB -f -' <<< \"$Q\""
  while IFS='|' read -r NOME KB; do
    printf '   %-22s %8d MB\n' "$NOME" $((KB / 1024)) | tee -a "$LOG"
    NECESSARI_KB=$((NECESSARI_KB + KB))
  done < <(ssh tgen "psql -X -At -v ON_ERROR_STOP=1 -d $DB -f -" <<< "$Q" 2> >(grep -v '^\*\*' >&2))
done
if [ -z "$BBOX" ] && [ "$(conta_tif)" -lt "$TINITALY_FILE" ]; then
  NECESSARI_KB=$((NECESSARI_KB + TINITALY_GB * 1024 * 1024))
fi
LIBERI_KB=$(df -k "$DEST" | awk 'NR == 2 { print $4 }')
log "   servono al piu' $((NECESSARI_KB / 1024 / 1024)) GB, liberi $((LIBERI_KB / 1024 / 1024)) GB"
if [ "$LIBERI_KB" -lt "$NECESSARI_KB" ]; then
  log "!! spazio insufficiente in $DEST: mi fermo prima di copiare"
  exit 1
fi

# ---------------------------------------------------------------------------
# 1. I layer: una query per file, GeoJSON una riga per elemento, compresso.
# ---------------------------------------------------------------------------
log "== 1. layer"
tail -n +2 "$SQL/manifest.tsv" | while IFS=$'\t' read -r FILE DB _GEOM _TAB LAYER _ZOOM; do
  OUT="$DEST/$FILE.geojsonl.gz"
  if [ -f "$OUT" ]; then log "   $FILE: gia' copiato, salto"; continue; fi
  log "   $FILE ($LAYER, database $DB)"
  mostra "ssh -C tgen 'psql -X -q -d $DB -f -' < $SQL/$FILE.sql [riquadro $ENV] | gzip -1 > $OUT"
  query "$SQL/$FILE.sql" | ssh -C tgen "psql -X -q -v ON_ERROR_STOP=1 -d $DB -f -" \
    2> >(grep -v '^\*\*' >&2) | gzip -1 > "$OUT.tmp"
  # La prima riga deve essere un GeoJSON valido: un errore di psql o un
  # formato rotto si scoprono qui, non quando la mappa esce vuota.
  RIGHE=$(python3 - "$OUT.tmp" <<'PY'
import gzip, json, sys
with gzip.open(sys.argv[1], 'rt') as f:
    prima = f.readline()
    if not prima:
        print(0); sys.exit()
    g = json.loads(prima)
    assert g.get("type") == "Feature" and "geometry" in g, "la prima riga non e un GeoJSON Feature"
    print(1 + sum(1 for _ in f))
PY
)
  mv "$OUT.tmp" "$OUT"
  log "   $FILE: $RIGHE elementi, $(du -h "$OUT" | cut -f1)"
done

# ---------------------------------------------------------------------------
# 2. L'inventario: quali celle e quali livelli TGen ha generato, e quando.
# ---------------------------------------------------------------------------
log "== 2. inventario grid_1x1"
if [ -f "$DEST/grid_1x1.jsonl" ]; then
  log "   gia' copiato, salto"
else
  mostra "ssh tgen 'psql -X -q -d general -f -' < $SQL/grid_1x1.sql > $DEST/grid_1x1.jsonl"
  ssh tgen "psql -X -q -v ON_ERROR_STOP=1 -d general -f -" < "$SQL/grid_1x1.sql" \
    2> >(grep -v '^\*\*' >&2) > "$DEST/grid_1x1.jsonl.tmp"
  mv "$DEST/grid_1x1.jsonl.tmp" "$DEST/grid_1x1.jsonl"
  log "   $(wc -l < "$DEST/grid_1x1.jsonl" | tr -d ' ') celle"
fi

# ---------------------------------------------------------------------------
# 3. TINITALY, il DEM a 10 m di tutta Italia (193 GeoTIFF e un .vrt, 16 GB).
# ---------------------------------------------------------------------------
log "== 3. TINITALY"
N=$(conta_tif)
if [ -n "$BBOX" ]; then
  # Quali file toccano il riquadro: gli angoli in gradi letti dalle
  # intestazioni (gdalinfo senza -stats non scrive nulla).
  mostra "ssh tgen 'cd $TINITALY_DIR/tinitaly && for f in *.tif; do gdalinfo \$f [angoli]; done'"
  FILE_CELLA=$(ssh tgen "cd $TINITALY_DIR/tinitaly && for f in *.tif; do echo \"\$f|\$(gdalinfo \$f | grep -E '^(Upper Left|Lower Right)' | tr -s ' ' | tr '\n' '|')\"; done" \
    2> >(grep -v '^\*\*' >&2) | python3 pipeline/tinitaly-celle.py "$BBOX")
  [ -n "$FILE_CELLA" ] || { log "!! nessun file di TINITALY tocca $BBOX"; exit 1; }
  log "   $(echo $FILE_CELLA | wc -w | tr -d ' ') file toccano il riquadro"
  mkdir -p "$DEST/tinitaly"
  mostra "ssh -C tgen 'tar cf - -C $TINITALY_DIR/tinitaly $(echo $FILE_CELLA)' | tar xf - -C $DEST/tinitaly"
  ssh -C tgen "tar cf - -C $TINITALY_DIR/tinitaly $(echo $FILE_CELLA)" 2> >(grep -v '^\*\*' >&2) | tar xf - -C "$DEST/tinitaly"
  log "   $(conta_tif) file, $(du -sh "$DEST/tinitaly" | cut -f1)"
elif [ "$N" -ge "$TINITALY_FILE" ]; then
  log "   gia' copiato ($N file), salto"
else
  mostra "ssh -C tgen 'tar cf - -C $TINITALY_DIR tinitaly' | tar xf - -C $DEST"
  ssh -C tgen "tar cf - -C $TINITALY_DIR tinitaly" 2> >(grep -v '^\*\*' >&2) | tar xf - -C "$DEST"
  N=$(conta_tif)
  [ "$N" -ge "$TINITALY_FILE" ] || { log "!! TINITALY incompleto: $N file su $TINITALY_FILE"; exit 1; }
  log "   $N file, $(du -sh "$DEST/tinitaly" | cut -f1)"
fi

log "== fatto: $DEST"
