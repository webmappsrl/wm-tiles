#!/usr/bin/env bash
set -euo pipefail
# Genera tutto cio' che serve alla mappa per un elenco di celle di prova.
#
# Ogni cella e' un riquadro di un grado, come quelli con cui lavora TGen, con
# il suo estratto OSM regionale e la sua copia da TGen (copia-da-tgen.sh con
# il riquadro, in data/tgen-copia/<nome>). Il risultato e' una versione nuova
# degli archivi, un DEM e delle curve di livello che coprono solo le celle.
#
# Gira sul Mac solo per le celle di prova (CLAUDE.md): l'Italia intera va sul
# server.
#
# Cosa viene da dove — l'algoritmo, non scelte caso per caso:
#   - OpenStreetMap, sentieri, strade dei livelli bassi, POI: estratto
#     Geofabrik ritagliato sulle celle, con gli script di sempre;
#   - uso suolo (landcover): i layer del project.mml di TGen che portano
#     `coduso`, nell'ordine in cui Mapnik li disegna (IGM, regioni, ghiacciai,
#     land_cover_hr): chi viene dopo copre chi viene prima;
#   - Corine (clc): il layer `clc` di TGen, z7-z13 come nel .mml;
#   - curve di livello: le tabelle di TGen per z12 e z13 come nel .mml
#     (cl_lr_subd, cl_mr_subd); da z14 dal DEM, con la convenzione di TGen;
#   - DEM: TINITALY 10 m, fino a z16 come il DEM gia' servito.
#
# La pubblicazione scambia le cartelle invece di sovrascriverle: l'area di
# prova precedente resta in data/dem/terrain-prototipo e
# data/archives/dem/contours-prototipo.pmtiles, e si torna indietro
# rinominando.
#
# Con --solo-osm e' un aggiornamento: si rifanno solo gli archivi di
# OpenStreetMap, e dati di TGen, DEM e curve — che non cambiano — si prendono
# dalla versione precedente.
#
# Uso: pipeline/build-celle.sh [--solo-osm] <versione> <nome>:<W,S,E,N>:<pbf> [...]
SOLO_OSM=""
if [ "${1:-}" = "--solo-osm" ]; then SOLO_OSM=1; shift; fi
V="${1:?versione, es. 20261010-1930}"; shift
T0=$(date +%s)  # il tempo totale si scrive alla fine
durata() { local s=$(( $(date +%s) - T0 )); printf '%dh%02dm%02ds' $((s / 3600)) $((s % 3600 / 60)) $((s % 60)); }
[ $# -ge 1 ] || { echo "uso: build-celle.sh <versione> <nome>:<W,S,E,N>:<pbf> [...]" >&2; exit 2; }
echo "$V" | grep -Eq '^[0-9]{8}-[0-9]{4}$' || { echo "!! versione non valida: $V" >&2; exit 2; }

WORK="data/celle-work/$V"
STAGE="data/archives/.tmp-$V"
PREC="$(ls -d data/archives/2*/ | sort | tail -1)"
mkdir -p "$WORK" "$STAGE"
GDAL="ghcr.io/osgeo/gdal:ubuntu-small-latest"

NOMI=(); BBOXES=(); PBFS=()
for C in "$@"; do
  IFS=: read -r NOME BBOX PBF <<< "$C"
  echo "$BBOX" | grep -Eq '^-?[0-9.]+,-?[0-9.]+,-?[0-9.]+,-?[0-9.]+$' || { echo "!! $NOME: riquadro non valido" >&2; exit 2; }
  test -f "$PBF" || { echo "!! $NOME: estratto $PBF assente" >&2; exit 1; }
  [ -n "$SOLO_OSM" ] || test -d "data/tgen-copia/$NOME/tinitaly" \
    || { echo "!! $NOME: manca la copia da TGen (copia-da-tgen.sh)" >&2; exit 1; }
  NOMI+=("$NOME"); BBOXES+=("$BBOX"); PBFS+=("$PBF")
done
# Il riquadro che contiene tutte le celle: lo usano gli script OSM, che
# lavorano sull'estratto unito e quindi producono solo dove ci sono dati.
UNIONE=$(printf '%s\n' "${BBOXES[@]}" | awk -F, 'NR==1{w=$1;s=$2;e=$3;n=$4} {if($1<w)w=$1; if($2<s)s=$2; if($3>e)e=$3; if($4>n)n=$4} END{print w" "s" "e" "n}')
read -r UW US UE UN <<< "$UNIONE"
echo "== celle: ${NOMI[*]} (insieme $UW,$US,$UE,$UN) -> versione $V"

# ---------------------------------------------------------------------------
# 1. OpenStreetMap
# ---------------------------------------------------------------------------
PARTI=()
for i in "${!NOMI[@]}"; do
  echo "== 1. OSM ${NOMI[$i]}: ritaglio ${BBOXES[$i]}"
  osmium extract -b "${BBOXES[$i]}" "${PBFS[$i]}" -o "$WORK/${NOMI[$i]}.osm.pbf" --overwrite
  PARTI+=("$WORK/${NOMI[$i]}.osm.pbf")
done
if [ "${#PARTI[@]}" -gt 1 ]; then
  osmium merge "${PARTI[@]}" -o "$WORK/celle.osm.pbf" --overwrite
else
  cp "${PARTI[0]}" "$WORK/celle.osm.pbf"
fi
bash pipeline/build-osm.sh "$WORK/celle.osm.pbf" "$STAGE" 14
bash pipeline/build-hiking-full.sh "$WORK/celle.osm.pbf" "$UW" "$US" "$UE" "$UN" "$STAGE/hiking.pmtiles" 10 14
bash pipeline/build-roads-lowzoom.sh "$WORK/celle.osm.pbf" "$UW" "$US" "$UE" "$UN" "$STAGE/roadslz.pmtiles" 8 11
bash pipeline/build-osmpoi.sh "$WORK/celle.osm.pbf" "$UW" "$US" "$UE" "$UN" "$STAGE/osmpoi.pmtiles" 11 14
bash pipeline/build-power.sh "$WORK/celle.osm.pbf" "$UW" "$US" "$UE" "$UN" "$STAGE/power.pmtiles"
bash pipeline/build-extra.sh "$WORK/celle.osm.pbf" "$UW" "$US" "$UE" "$UN" "$STAGE/extra.pmtiles"
bash pipeline/build-parchi.sh "$WORK/celle.osm.pbf" "$UW" "$US" "$UE" "$UN" "$STAGE/parchi.pmtiles"
bash pipeline/build-amenity.sh "$WORK/celle.osm.pbf" "$UW" "$US" "$UE" "$UN" "$STAGE/amenity.pmtiles"

if [ -n "$SOLO_OSM" ]; then
  echo "== 2. aggiornamento: dati di TGen, DEM e curve restano quelli di $PREC"
  for A in landcover clc toponimi rifugi igm; do
    if [ -f "$PREC/$A.pmtiles" ]; then cp "$PREC/$A.pmtiles" "$STAGE/"; fi
  done
else

# ---------------------------------------------------------------------------
# 2. I dati di TGen, dalle copie delle celle
# ---------------------------------------------------------------------------
# Unisce un layer di TGen di tutte le celle in un GeoJSON (pipeline/unisci-tgen.py).
COPIE=$(printf 'data/tgen-copia/%s,' "${NOMI[@]}"); COPIE="${COPIE%,}"
unisci() {  # <uscita> <campi: nome|nome=nuovo,...> <layer...>
  local OUT="$1" CAMPI="$2"; shift 2
  python3 pipeline/unisci-tgen.py "$OUT" "$CAMPI" "$COPIE" "$@"
}

# L'ordine dei layer di uso suolo e' quello del project.mml (manifest).
USO=$(awk -F'\t' 'NR > 1 && ($1 ~ /^igm_dbsn_/ || $1 ~ /^uso/ || $1 == "ghiacciai_piemonte" || $1 == "land_cover_hr") { print $1 }' pipeline/sql/tgen/manifest.tsv)
echo "== 2. uso suolo da TGen: $(echo $USO | wc -w | tr -d ' ') layer"
unisci "$WORK/landcover.geojsonl" "coduso" $USO
# `--preserve-input-order`: chi viene dopo nel .mml deve coprire chi viene
# prima, come in Mapnik. Niente limiti di tile: a z14 un limite farebbe
# cadere poligoni e lascerebbe buchi nell'uso suolo.
tippecanoe -o "$STAGE/landcover.pmtiles" --force -q -l landcover -Z14 -z14 \
  --preserve-input-order --no-feature-limit --no-tile-size-limit "$WORK/landcover.geojsonl"

echo "== 2. edifici IGM da TGen"
# TGen li disegna da z14 con la regola degli edifici OSM, sopra di essi
# (buildings.mss): stesso layer di stile, archivio a parte.
unisci "$WORK/igm_edifici.geojsonl" "src" igm_edifc igm_edi_min
tippecanoe -o "$STAGE/igm.pmtiles" --force -q -l igm_edifici -Z14 -z14 \
  --no-feature-limit --no-tile-size-limit "$WORK/igm_edifici.geojsonl"

echo "== 2. Corine da TGen"
unisci "$WORK/clc.geojsonl" "code_12=code" clc
tippecanoe -o "$STAGE/clc.pmtiles" --force -q -l clc -Z7 -z13 \
  --no-feature-limit --no-tile-size-limit --simplification=4 "$WORK/clc.geojsonl"


# toponimi e rifugi non stanno nel project.mml: si tengono quelli gia'
# pubblicati, che coprono l'Italia o quasi.
for A in toponimi rifugi; do cp "$PREC/$A.pmtiles" "$STAGE/"; done

# ---------------------------------------------------------------------------
# 3. DEM: TINITALY, cella per cella, fino a z16
# ---------------------------------------------------------------------------
mkdir -p "$WORK/terrain"
for i in "${!NOMI[@]}"; do
  NOME="${NOMI[$i]}"; IFS=, read -r W S E N <<< "${BBOXES[$i]}"
  D="$WORK/dem-$NOME"; mkdir -p "$D"
  echo "== 3. DEM $NOME: TINITALY -> EPSG:3857, poi terrain z8-z16"
  # I file di TINITALY stanno in UTM 32 o 33: si portano tutti in WGS 84
  # prima del mosaico, perche' gdalbuildvrt scarta in silenzio i file con una
  # proiezione diversa dal primo (CLAUDE.md, trappole GDAL).
  docker run --rm -v "$PWD/data/tgen-copia/$NOME/tinitaly":/src:ro -v "$PWD/$D":/work \
    -v "$PWD/pipeline":/pipeline --entrypoint bash "$GDAL" -c "
      set -euo pipefail; cd /work
      for f in /src/*.tif; do
        gdalwarp -overwrite -q -t_srs EPSG:4326 -r cubicspline -co COMPRESS=DEFLATE \"\$f\" \"\$(basename \"\$f\" .tif)_4326.tif\"
      done
      gdalbuildvrt -overwrite -q -resolution highest -r cubicspline mosaico.vrt *_4326.tif
      gdalwarp -overwrite -q -t_srs EPSG:3857 -r cubicspline -multi -te_srs EPSG:4326 -te $W $S $E $N \
        -co COMPRESS=DEFLATE -co TILED=YES -co BIGTIFF=IF_SAFER mosaico.vrt dem3857.tif
      rm -f *_4326.tif
      bash /pipeline/build-terrain-zoom.sh /work 8 16
    "
  # Le tile delle celle vanno in un'unica cartella: celle lontane non si
  # sovrappongono, quindi nessuna tile ne sovrascrive un'altra.
  cp -R "$D/terrain-nuovo/." "$WORK/terrain/"
done

# Curve di livello, dopo il DEM perche' dove mancano in TGen si calcolano da li'.
echo "== 2. curve di livello da TGen, una tabella per fascia"
unisci "$WORK/cl_lr.geojsonl" "quota,type" contourlines_lr
unisci "$WORK/cl_mr.geojsonl" "quota,type" contourlines_mr
# Le curve di dettaglio (da z14) si calcolano SEMPRE dal DEM della cella, con
# la convenzione di TGen: ogni 25 m, `cp25` le direttrici ogni 100 m, `cs25`
# le altre. La tabella di TGen (cl_hr_subd) copre solo l'area dell'ultimo
# lavoro, come la sua ombreggiatura ad alta risoluzione: nella cella di Pisa
# c'e' sopra 43,9 N e manca sul Monte Pisano, i cui PNG pero' le mostrano.
# Mescolare le due fonti lascerebbe cuciture dove si incontrano; e' un buco di
# dati, non di stile, e non si imita. z12 e z13 invece TGen li ha ovunque.
: > "$WORK/cl_hr.geojsonl"
for NOME in "${NOMI[@]}"; do
  echo "   $NOME: curve di dettaglio dal DEM, ogni 25 m"
  docker run --rm -v "$PWD/$WORK/dem-$NOME":/work --entrypoint bash "$GDAL" -c \
    "gdal_contour -a quota -i 25 -f GeoJSONSeq -q /work/dem3857.tif /work/cl25.geojsonl"
  python3 - "$WORK/dem-$NOME/cl25.geojsonl" "$NOME" >> "$WORK/cl_hr.geojsonl" <<'PY'
import json, sys
for riga in open(sys.argv[1]):
    e = json.loads(riga)
    q = int(e["properties"]["quota"] // 1)
    e["properties"] = {"quota": q, "type": ("cp25" if q % 100 == 0 else "cs25"), "src": "dem-" + sys.argv[2]}
    print(json.dumps(e, separators=(",", ":")))
PY
done
# Una fascia per file, poi si uniscono: tile-join lavora su .mbtiles.
tippecanoe -o "$WORK/cl_lr.mbtiles" --force -q -l contour -Z12 -z12 --no-feature-limit --no-tile-size-limit "$WORK/cl_lr.geojsonl"
tippecanoe -o "$WORK/cl_mr.mbtiles" --force -q -l contour -Z13 -z13 --no-feature-limit --no-tile-size-limit "$WORK/cl_mr.geojsonl"
tippecanoe -o "$WORK/cl_hr.mbtiles" --force -q -l contour -Z14 -z15 --no-feature-limit --no-tile-size-limit "$WORK/cl_hr.geojsonl"
tile-join -o "$WORK/contours.mbtiles" --force -q --no-tile-size-limit \
  "$WORK/cl_lr.mbtiles" "$WORK/cl_mr.mbtiles" "$WORK/cl_hr.mbtiles"
pmtiles convert "$WORK/contours.mbtiles" "$WORK/contours.pmtiles"
bash pipeline/build-quote.sh "$WORK/cl_hr.geojsonl" "$WORK/quote.pmtiles"

fi

# ---------------------------------------------------------------------------
# 4. Pubblicazione: versione nuova, DEM e curve scambiati di cartella
# ---------------------------------------------------------------------------
cat > "$STAGE/provenance.json" <<JSON
{
  "archive": "celle${SOLO_OSM:+ (aggiornamento solo OSM)}",
  "version": "$V",
  "scope": "bbox $UW,$US,$UE,$UN (celle di prova: ${NOMI[*]})",
  "celle": [$(for i in "${!NOMI[@]}"; do printf '%s{"nome": "%s", "bbox": [%s]}' "$([ "$i" -gt 0 ] && echo ', ')" "${NOMI[$i]}" "${BBOXES[$i]}"; done)],
  "sources": [
    {"name": "Geofabrik, estratti regionali", "files": "$(printf '%s ' "${PBFS[@]}")"},
    {"name": "TGen, copia in sola lettura", "files": "data/tgen-copia/{$(echo "${NOMI[*]}" | tr ' ' ',')}"},
    {"name": "TINITALY 10 m, da TGen"}
  ],
  "createdAt": "$(date -u +%FT%TZ)"
}
JSON
mv "$STAGE" "data/archives/$V"
if [ -n "$SOLO_OSM" ]; then
  echo "== fatto: versione $V (solo OpenStreetMap) in $(durata). Riavvia il server."
  exit 0
fi
if [ ! -e data/dem/terrain-prototipo ]; then mv data/dem/terrain data/dem/terrain-prototipo; else rm -rf data/dem/terrain; fi
mv "$WORK/terrain" data/dem/terrain
if [ ! -e data/archives/dem/contours-prototipo.pmtiles ]; then
  mv data/archives/dem/contours.pmtiles data/archives/dem/contours-prototipo.pmtiles
fi
cp "$WORK/contours.pmtiles" data/archives/dem/contours.pmtiles
cp "$WORK/quote.pmtiles" data/archives/dem/quote.pmtiles
echo "== fatto: versione $V in $(durata), DEM $(find data/dem/terrain -name '*.png' | wc -l | tr -d ' ') tile. Riavvia il server."
