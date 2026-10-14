#!/usr/bin/env bash
set -euo pipefail
# Copernicus GLO-30 (DSM a 30 m, dati aperti) sul riquadro del DEM, dal bucket
# pubblico su AWS. Serve da base sotto TINITALY, che copre solo l'Italia: fuori
# dal confine la quota valeva 0 e lungo le Alpi l'ombra disegnava una parete
# (fascia nera al Passo Mondelli, 16/34223/23314) e le curve si addensavano con
# quote spurie (14 ottobre 2026).
#
# Una tile per grado; quelle sul mare non esistono (404) e si saltano. Le tile
# gia' scaricate restano: rilanciare riprende da dove si era fermato.
#
# Uso: scarica-copernicus.sh <W> <S> <E> <N> <cartella>
W="${1:?}"; S="${2:?}"; E="${3:?}"; N="${4:?}"; OUT="${5:?}"
mkdir -p "$OUT"
BASE="https://copernicus-dem-30m.s3.amazonaws.com"
lat0=$(python3 -c "import math; print(math.floor($S))"); lat1=$(python3 -c "import math; print(math.ceil($N) - 1)")
lon0=$(python3 -c "import math; print(math.floor($W))"); lon1=$(python3 -c "import math; print(math.ceil($E) - 1)")
n=0; mare=0
for lat in $(seq "$lat0" "$lat1"); do
  for lon in $(seq "$lon0" "$lon1"); do
    ns=$([ "$lat" -ge 0 ] && printf 'N%02d' "$lat" || printf 'S%02d' "${lat#-}")
    ew=$([ "$lon" -ge 0 ] && printf 'E%03d' "$lon" || printf 'W%03d' "${lon#-}")
    nome="Copernicus_DSM_COG_10_${ns}_00_${ew}_00_DEM"
    [ -s "$OUT/$nome.tif" ] && { n=$((n + 1)); continue; }
    if curl -sfL --retry 3 -o "$OUT/$nome.tif.part" "$BASE/$nome/$nome.tif"; then
      mv "$OUT/$nome.tif.part" "$OUT/$nome.tif"; n=$((n + 1))
    else
      rm -f "$OUT/$nome.tif.part"; mare=$((mare + 1))
    fi
  done
done
echo "   Copernicus: $n tile, $mare senza terra (mare)"
