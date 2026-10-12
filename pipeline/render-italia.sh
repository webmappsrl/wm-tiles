#!/usr/bin/env bash
set -euo pipefail
# Rende le tile PNG di tutta l'Italia dalla versione che il server sta
# servendo, con piu' processi in parallelo, e riprende da dove si e' fermato.
#
# Quali tile: tile-italia.py, cioe' i livelli e le celle che TGen ha generato e
# che toccano l'Italia (fino a z12 tutte, da z13 le celle dell'inventario).
#
# Come si dividono: per metatile. Le tile di un blocco 4x4 vanno sempre allo
# stesso processo, perche' render-png disegna il blocco una volta sola e lo
# ritaglia; spezzarlo vorrebbe dire disegnarlo piu' volte. I processi sono
# container render-png con OpenGL in software a un thread (LP_NUM_THREADS=1):
# tanti processi quanti core, senza che si contendano la CPU.
#
# Riprende: una tile gia' presente nella cartella non si rifa'. Per rifare
# tutto (stile o dati cambiati) si cancella la cartella o se ne usa un'altra.
#
# Gira sul server, dalla radice del repo, con il server delle tile acceso.
# Un solo server Node non basta a sei renderer: resta fisso al 100% di un core
# e i renderer lo aspettano. WM_BASES elenca piu' copie del server, una ogni
# tanti processi, e tiene libero quello pubblico:
#   WM_BASES="http://localhost:8081 http://localhost:8082" pipeline/render-italia.sh ...
# Uso: pipeline/render-italia.sh <cartella-png> [zoom-min] [zoom-max] [processi]
#   es. pipeline/render-italia.sh data/png/italia 0 16
OUT="${1:?cartella dei PNG, sotto il repo (es. data/png/italia)}"
ZMIN="${2:-0}"; ZMAX="${3:-16}"
NPROC="${4:-$(( $(nproc) > 2 ? $(nproc) - 2 : 1 ))}"
LISTE="$OUT/.liste"
mkdir -p "$OUT" "$LISTE"
GDAL="ghcr.io/osgeo/gdal:ubuntu-small-latest"
fase() { echo "== $(date -u '+%F %T') $*"; }

fase "elenco delle tile z$ZMIN-z$ZMAX"
docker run --rm -v "$PWD/data":/data -v "$PWD/pipeline":/pipeline:ro "$GDAL" \
  python3 /pipeline/tile-italia.py /data/sources/confine-italia-stati.geojsonl \
  /data/tgen-copia/italia/grid_1x1.jsonl "$ZMIN" "$ZMAX" > "$LISTE/tutte.txt"

fase "tolgo le gia' rese e divido per metatile in $NPROC parti"
python3 - "$OUT" "$LISTE" "$NPROC" <<'PY'
import os, sys
out, liste, n = sys.argv[1], sys.argv[2], int(sys.argv[3])
blocchi = {}
fatte = 0
for riga in open(f"{liste}/tutte.txt"):
    t = riga.strip()
    if not t:
        continue
    z, x, y = map(int, t.split("/"))
    if os.path.exists(f"{out}/{z}/{x}/{y}.png"):
        fatte += 1
        continue
    lato = min(4, 2 ** z)  # come raggruppa() di src/raster/tiles.js
    blocchi.setdefault((z, x // lato, y // lato), []).append(t)
parti = [open(f"{liste}/parte-{i}.txt", "w") for i in range(n)]
for k, chiave in enumerate(sorted(blocchi)):
    parti[k % n].write("\n".join(blocchi[chiave]) + "\n")
for p in parti:
    p.close()
print(f"   {fatte} gia' rese, {sum(len(b) for b in blocchi.values())} da rendere in {len(blocchi)} metatile")
PY

fase "resa con $NPROC processi (log in $LISTE/parte-N.log)"
read -r -a BASI <<< "${WM_BASES:-}"
PID=()
for i in $(seq 0 $((NPROC - 1))); do
  [ -s "$LISTE/parte-$i.txt" ] || continue
  BASE=()
  [ ${#BASI[@]} -eq 0 ] || BASE=(--base "${BASI[$((i % ${#BASI[@]}))]}")
  LP_NUM_THREADS=1 bash pipeline/render-png-docker.sh --tiles "$LISTE/parte-$i.txt" --out "$OUT" \
    ${BASE[@]+"${BASE[@]}"} > "$LISTE/parte-$i.log" 2>&1 &
  PID+=($!)
done
ERRORI=0
for p in "${PID[@]}"; do wait "$p" || ERRORI=$((ERRORI + 1)); done
fase "fatto: $(find "$OUT" -name '*.png' | wc -l | tr -d ' ') PNG in $OUT, processi falliti: $ERRORI"
[ "$ERRORI" -eq 0 ] || { echo "!! rilancia lo stesso comando: riprende dalle tile mancanti" >&2; exit 1; }
