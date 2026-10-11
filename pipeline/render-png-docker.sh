#!/usr/bin/env bash
# render-png.mjs dentro un container Ubuntu 22.04, con gli stessi argomenti.
#
# Serve sui server Linux: il binario di maplibre-native vuole versioni precise
# di glibc e ICU, che l'immagine fissa. Il codice del repo si monta in sola
# lettura, le dipendenze sono quelle dell'immagine. I percorsi passati
# (--tiles, --out) devono stare sotto la cartella corrente, che si monta allo
# stesso percorso.
#
#   bash pipeline/render-png-docker.sh --bbox W,S,E,N --zoom 8-16 --out data/png
set -euo pipefail
R="$(cd "$(dirname "$0")/.." && pwd)"
IMG=wm-render-png
if ! docker image inspect "$IMG" >/dev/null 2>&1; then
  docker build -t "$IMG" -f "$R/pipeline/render-png.Dockerfile" "$R/pipeline"
fi
# sul server il container usa la rete dell'host; Docker Desktop (Mac) no
RETE=(--network host)
BASE=()
if [ "$(uname)" = Darwin ]; then
  RETE=()
  BASE=(--base http://host.docker.internal:8080)
fi
# --init: senza, xvfb-run e' il processo 1 del container e resta bloccato in attesa di Xvfb
# ${A[@]+"${A[@]}"}: con set -u il bash 3 del Mac rifiuta un array vuoto
docker run --rm --init ${RETE[@]+"${RETE[@]}"} -v "$PWD:$PWD" -w "$PWD" \
  -v "$R/pipeline:/repo/pipeline:ro" -v "$R/src:/repo/src:ro" -v "$R/package.json:/repo/package.json:ro" \
  "$IMG" xvfb-run -a -s "-screen 0 1024x768x24" node /repo/pipeline/render-png.mjs ${BASE[@]+"${BASE[@]}"} "$@"
