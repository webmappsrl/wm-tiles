# Comandi in parallelo, a gruppi: `avvia cmd...` lo lancia in background,
# `aspetta` attende tutti quelli lanciati e si ferma se uno e' fallito.
# Quando il gruppo e' pieno (WM_PARALLELO, di serie meta' dei processori,
# almeno 2) `avvia` aspetta da solo.
#
# Perche': le estrazioni dal PBF leggono il file intero una alla volta, e la
# rigenerazione nazionale "solo OSM" del 12 ottobre 2026 e' durata oltre tre
# ore su un solo processore dei suoi 8 (extra da solo 1 h 28 min, 16 letture).
#
# Scritto per bash 3.2 (il Mac): niente `wait -n`. Si usa con `source`.
_ncpu=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 2)
WM_PARALLELO="${WM_PARALLELO:-$(( _ncpu / 2 > 2 ? _ncpu / 2 : 2 ))}"
PARALLELO_PIDS=()

avvia() {
  "$@" &
  PARALLELO_PIDS+=($!)
  if [ "${#PARALLELO_PIDS[@]}" -ge "$WM_PARALLELO" ]; then aspetta; fi
}

aspetta() {
  local p r=0
  for p in ${PARALLELO_PIDS[@]+"${PARALLELO_PIDS[@]}"}; do
    wait "$p" || r=1
  done
  PARALLELO_PIDS=()
  if [ "$r" -ne 0 ]; then
    echo "!! un comando in parallelo e' fallito" >&2
    exit 1
  fi
}
