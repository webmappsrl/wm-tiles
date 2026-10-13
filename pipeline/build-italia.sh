#!/usr/bin/env bash
set -euo pipefail
# Genera tutto cio' che serve alla mappa per l'Italia intera. E' build-celle.sh
# in scala nazionale, con le stesse fonti e lo stesso algoritmo, e gira sul
# server (CLAUDE.md: sul Mac solo le celle di prova).
#
# Cosa cambia rispetto alle celle, e perche':
#   - OpenStreetMap: l'estratto nazionale di estratto-italia.sh, intero;
#   - dati di TGen: la copia nazionale (copia-da-tgen.sh senza riquadro);
#   - DEM: TINITALY si riproietta UNA volta, e ogni livello si genera dal
#     mosaico. Le celle passano per un GeoTIFF a 10 m: sull'Italia peserebbe
#     circa 150 GB;
#   - quote fino a z14 (decisione dell'11 ottobre 2026): oltre le ingrandisce
#     chi disegna, senza differenze visibili;
#   - curve di dettaglio: dal DEM di z14, in strisce calcolate in parallelo che
#     si sovrappongono di una riga, cosi' le curve si toccano senza buchi.
#
# I file di lavoro stanno sul disco locale (WM_WORK, veloce), i risultati in
# data/ (sul Volume). Ogni passo salta cio' che ha gia' prodotto: dopo
# un'interruzione si rilancia lo stesso comando.
#
# Con --solo-osm e' un aggiornamento: si rifanno solo gli archivi di
# OpenStreetMap; dati di TGen, toponimi e rifugi si copiano dalla versione
# precedente, e DEM e curve restano quelli pubblicati (non cambiano). Ore
# invece di una giornata.
#
# Con --solo-dem si rifanno solo le quote e le curve di livello (che vengono
# dal DEM); tutti gli archivi si copiano dalla versione precedente.
#
# Uso: pipeline/build-italia.sh [--solo-osm|--solo-dem] <versione> [estratto.osm.pbf]
SOLO_OSM=""; SOLO_DEM=""
if [ "${1:-}" = "--solo-osm" ]; then SOLO_OSM=1; shift; fi
if [ "${1:-}" = "--solo-dem" ]; then SOLO_DEM=1; shift; fi
V="${1:?versione, es. 20261011-1500}"
PBF="${2:-data/sources/italia.osm.pbf}"
echo "$V" | grep -Eq '^[0-9]{8}-[0-9]{4}$' || { echo "!! versione non valida: $V" >&2; exit 2; }
test -f "$PBF" || { echo "!! manca $PBF (estratto-italia.sh)" >&2; exit 1; }
TG="data/tgen-copia/italia"
test -d "$TG/tinitaly" || { echo "!! manca la copia nazionale da TGen in $TG (copia-da-tgen.sh)" >&2; exit 1; }

# il riquadro dell'estratto OSM, e quello di TINITALY e delle copie da TGen
read -r OW OS OE ON <<< "4.39 35.37 22.11 48.06"
read -r DW DS DE DN <<< "6.6 35.4 18.6 47.1"
DEM_ZMIN=8
DEM_ZMAX=14
NPROC=$(nproc)
WORK="${WM_WORK:-/var/tmp/wm-tiles}/$V"
STAGE="data/archives/.tmp-$V"
GDAL="ghcr.io/osgeo/gdal:ubuntu-small-latest"
mkdir -p "$WORK/tmp" "$STAGE"
# Gli script dei singoli strati scrivono i loro file di lavoro con mktemp, e
# tippecanoe i suoi in TMPDIR (con -t): sul disco locale, non in /tmp, che su
# Ubuntu 26.04 sta in memoria (16 GB) e con l'Italia si riempie.
export TMPDIR="$WORK/tmp"
fase() { echo "== $(date -u '+%F %T') $*"; }
# i tempi: ogni passo scrive quanto ha impiegato, e alla fine il totale
T0=$(date +%s)
durata() { local s=$(( $(date +%s) - $1 )); printf '%dh%02dm%02ds' $((s / 3600)) $((s % 3600 / 60)) $((s % 60)); }
# Un passo e' fatto quando ha lasciato il suo segno, non quando il file esiste:
# planetiler e tippecanoe scrivono l'archivio mentre lavorano, e dopo
# un'interruzione un file a meta' verrebbe preso per buono.
fatto() { [ -f "$(dirname "$1")/.fatto-$(basename "$1")" ] && echo "   $(basename "$1"): gia' fatto, salto"; }
segna() { touch "$(dirname "$1")/.fatto-$(basename "$1")"; }
passo() {  # <uscita> <comando...>: lo esegue se non e' gia' fatto, e lo segna
  local OUT="$1"; shift
  fatto "$OUT" && return 0
  local t=$(date +%s)
  "$@"
  segna "$OUT"
  echo "   $(basename "$OUT"): $(durata $t)"
}

if [ -n "$SOLO_DEM" ]; then
  PREC="$(ls -d data/archives/2*/ 2>/dev/null | grep -v "/$V/" | sort | tail -1 || true)"
  [ -n "$PREC" ] || { echo "!! --solo-dem: nessuna versione precedente in data/archives" >&2; exit 1; }
  fase "solo DEM e curve: gli archivi vengono da $PREC"
  for f in "$PREC"/*.pmtiles; do ln -f "$f" "$STAGE/"; segna "$STAGE/$(basename "$f")"; done
fi

# ---------------------------------------------------------------------------
# 1. OpenStreetMap
# ---------------------------------------------------------------------------
if [ -z "$SOLO_DEM" ]; then
fase "1. OpenStreetMap da $PBF"
# I passi sono indipendenti e girano insieme, a gruppi di WM_PASSI, ognuno con
# il suo log in $WORK: in sequenza la rigenerazione "solo OSM" del 12 ottobre
# 2026 ha impiegato oltre tre ore usando un processore su 8. I piu' lunghi per
# primi: planetiler (CPU) accanto alle estrazioni (lettura del PBF).
source pipeline/parallelo.sh
WM_PARALLELO="${WM_PASSI:-4}"
passo_log() {  # come passo, con l'uscita in un log a parte
  local OUT="$1"; shift
  local L="$WORK/$(basename "$OUT").log" t
  fatto "$OUT" && return 0
  t=$(date +%s)
  if "$@" > "$L" 2>&1; then
    segna "$OUT"; echo "   $(basename "$OUT"): $(durata $t)"
  else
    echo "!! $(basename "$OUT") fallito dopo $(durata $t); ultime righe di $L:" >&2
    tail -15 "$L" >&2
    return 1
  fi
}
avvia passo_log "$STAGE/osm.pmtiles" env PLANETILER_XMX="${PLANETILER_XMX:-16g}" PLANETILER_TMP="$WORK/planetiler" \
  bash pipeline/build-osm.sh "$PBF" "$STAGE" 14
avvia passo_log "$STAGE/extra.pmtiles" bash pipeline/build-extra.sh "$PBF" $OW $OS $OE $ON "$STAGE/extra.pmtiles"
avvia passo_log "$STAGE/amenity.pmtiles" bash pipeline/build-amenity.sh "$PBF" $OW $OS $OE $ON "$STAGE/amenity.pmtiles"
avvia passo_log "$STAGE/roadslz.pmtiles" bash pipeline/build-roads-lowzoom.sh "$PBF" $OW $OS $OE $ON "$STAGE/roadslz.pmtiles" 8 11
avvia passo_log "$STAGE/parchi.pmtiles" bash pipeline/build-parchi.sh "$PBF" $OW $OS $OE $ON "$STAGE/parchi.pmtiles"
avvia passo_log "$STAGE/osmpoi.pmtiles" bash pipeline/build-osmpoi.sh "$PBF" $OW $OS $OE $ON "$STAGE/osmpoi.pmtiles" 11 14
avvia passo_log "$STAGE/hiking.pmtiles" bash pipeline/build-hiking-full.sh "$PBF" $OW $OS $OE $ON "$STAGE/hiking.pmtiles" 10 14
avvia passo_log "$STAGE/power.pmtiles" bash pipeline/build-power.sh "$PBF" $OW $OS $OE $ON "$STAGE/power.pmtiles"
aspetta
fase "1. OpenStreetMap: fatto in $(durata $T0)"

# ---------------------------------------------------------------------------
# --solo-osm: il resto dalla versione precedente, e si pubblica
# ---------------------------------------------------------------------------
if [ -n "$SOLO_OSM" ]; then
  PREC="$(ls -d data/archives/2*/ 2>/dev/null | grep -v "/$V/" | sort | tail -1 || true)"
  [ -n "$PREC" ] || { echo "!! --solo-osm: nessuna versione precedente in data/archives" >&2; exit 1; }
  fase "2. aggiornamento: dati di TGen, toponimi e rifugi da $PREC; DEM e curve restano"
  for A in landcover igm clc toponimi rifugi; do
    test -f "$PREC/$A.pmtiles" || { echo "!! manca $PREC/$A.pmtiles" >&2; exit 1; }
    cp "$PREC/$A.pmtiles" "$STAGE/"
  done
  fase "5. pubblicazione della versione $V (solo OpenStreetMap)"
  cat > "$STAGE/provenance.json" <<JSON
{
  "archive": "italia (aggiornamento solo OSM)",
  "version": "$V",
  "scope": "Italia: OSM $OW,$OS,$OE,$ON; TGen e TINITALY $DW,$DS,$DE,$DN",
  "sources": [
    {"name": "Geofabrik, Europa ritagliata sull'Italia", "files": "$PBF"},
    {"name": "TGen, copia in sola lettura", "files": "$TG (da $PREC)"},
    {"name": "TINITALY 10 m, da TGen, quote fino a z$DEM_ZMAX (invariato)"}
  ],
  "createdAt": "$(date -u +%FT%TZ)"
}
JSON
  rm -f "$STAGE"/.fatto-*
  mv "$STAGE" "data/archives/$V"
  fase "fatto: versione $V (solo OpenStreetMap) in $(durata $T0). Riavvia il server"
  exit 0
fi

# ---------------------------------------------------------------------------
# 2. I dati di TGen, dalla copia nazionale (come build-celle.sh)
# ---------------------------------------------------------------------------
# tippecanoe scrive temporanei grandi quanto l'ingresso: sul disco locale
TIPPE=(tippecanoe -t "$WORK" --force -q --no-feature-limit --no-tile-size-limit)
USO=$(awk -F'\t' 'NR > 1 && ($1 ~ /^igm_dbsn_/ || $1 ~ /^uso/ || $1 == "ghiacciai_piemonte" || $1 == "land_cover_hr") { print $1 }' pipeline/sql/tgen/manifest.tsv)
fase "2. uso suolo da TGen: $(echo $USO | wc -w | tr -d ' ') layer"
if ! fatto "$STAGE/landcover.pmtiles"; then
  python3 pipeline/unisci-tgen.py "$WORK/landcover.geojsonl" coduso "$TG" $USO
  # chi viene dopo nel .mml copre chi viene prima, come in Mapnik
  "${TIPPE[@]}" -o "$STAGE/landcover.pmtiles" -l landcover -Z14 -z14 --preserve-input-order "$WORK/landcover.geojsonl"
  rm -f "$WORK/landcover.geojsonl"
  segna "$STAGE/landcover.pmtiles"
fi
fase "2. edifici IGM da TGen"
if ! fatto "$STAGE/igm.pmtiles"; then
  python3 pipeline/unisci-tgen.py "$WORK/igm_edifici.geojsonl" src "$TG" igm_edifc igm_edi_min
  "${TIPPE[@]}" -o "$STAGE/igm.pmtiles" -l igm_edifici -Z14 -z14 "$WORK/igm_edifici.geojsonl"
  rm -f "$WORK/igm_edifici.geojsonl"
  segna "$STAGE/igm.pmtiles"
fi
fase "2. Corine da TGen"
if ! fatto "$STAGE/clc.pmtiles"; then
  python3 pipeline/unisci-tgen.py "$WORK/clc.geojsonl" "code_12=code" "$TG" clc
  "${TIPPE[@]}" -o "$STAGE/clc.pmtiles" -l clc -Z7 -z13 --simplification=4 "$WORK/clc.geojsonl"
  rm -f "$WORK/clc.geojsonl"
  segna "$STAGE/clc.pmtiles"
fi
# toponimi e rifugi non stanno nel project.mml: si tengono quelli pubblicati
# (coprono l'Italia), dalla versione precedente o, sul primo giro, da data/seed
PREC="$(ls -d data/archives/2*/ 2>/dev/null | sort | tail -1 || true)"
for A in toponimi rifugi; do
  if fatto "$STAGE/$A.pmtiles"; then continue; fi
  if [ -n "$PREC" ] && [ -f "$PREC/$A.pmtiles" ]; then cp "$PREC/$A.pmtiles" "$STAGE/"
  elif [ -f "data/seed/$A.pmtiles" ]; then cp "data/seed/$A.pmtiles" "$STAGE/"
  else echo "!! manca $A.pmtiles: ne' in una versione precedente ne' in data/seed" >&2; exit 1; fi
  segna "$STAGE/$A.pmtiles"
done

fi  # fine dei passi 1 e 2, saltati con --solo-dem

# ---------------------------------------------------------------------------
# 3. DEM: TINITALY riproiettato una volta, ogni livello dal mosaico
# ---------------------------------------------------------------------------
DEM="$WORK/dem"
mkdir -p "$DEM/terrain"
fase "3. DEM: TINITALY, un mosaico per zona UTM"
# I fogli di TINITALY stanno in UTM 32 o 33. Si montano PER ZONA, nella loro
# proiezione, e si riproietta il mosaico intero, una volta per livello.
# Riproiettare ogni foglio da solo (com'era fino al 13 ottobre 2026) lasciava
# a ogni bordo di foglio una fascia di valori sbagliati, dove l'interpolazione
# cubica non ha i pixel del foglio accanto: l'ombra la disegnava come una
# linea dritta (Valle d'Arnetola, fogli w48555/w48560, curvatura 9,7 volte la
# normale; col mosaico per zona 2 volte, cioe' terreno). gdalbuildvrt scarta in
# silenzio i file con un'altra proiezione: per questo un VRT per zona.
docker run --rm -v "$PWD/$TG/tinitaly":/src:ro -v "$DEM":/work --entrypoint bash "$GDAL" -c "
  set -euo pipefail; cd /work
  rm -f zona_*.txt zona_*.vrt
  for f in /src/*.tif; do echo \$f >> zona_\$(gdalsrsinfo -o epsg \$f | tr -dc 0-9).txt; done
  for l in zona_*.txt; do gdalbuildvrt -q -r cubicspline -input_file_list \$l \${l%.txt}.vrt; done
  wc -l zona_*.txt
"
for Z in $(seq $DEM_ZMIN $DEM_ZMAX); do
  if [ -d "$DEM/terrain/$Z" ] && [ -f "$DEM/terrain/.z$Z" ]; then echo "   z$Z: gia' fatto, salto"; continue; fi
  STEP=$(python3 -c "print(156543.033928 / 2 ** $Z)")
  fase "3. DEM z$Z: $STEP m/pixel"
  # Ogni livello dal mosaico in float, con cubicspline: la pendenza resta
  # continua e non c'e' reticolo (build-terrain-zoom.sh). Il float di z14 resta
  # per le curve di livello.
  # /src: i VRT delle zone puntano ai fogli di TINITALY con quel percorso
  docker run --rm -v "$DEM":/work -v "$PWD/$TG/tinitaly":/src:ro -v "$PWD/pipeline":/pipeline --entrypoint bash "$GDAL" -c "
    set -euo pipefail; cd /work
    gdalwarp -overwrite -q -t_srs EPSG:3857 -te_srs EPSG:4326 -te $DW $DS $DE $DN -tr $STEP $STEP \
      -r cubicspline -multi -wo NUM_THREADS=ALL_CPUS \
      -co COMPRESS=DEFLATE -co TILED=YES -co BIGTIFF=YES zona_*.vrt dem_z$Z.tif
    python3 /pipeline/encode-terrarium.py dem_z$Z.tif terrain_z$Z.tif
    rm -rf terrain/$Z
    gdal2tiles.py --xyz --zoom=$Z-$Z --resampling=near --processes=$NPROC \
      --tiledriver=PNG --webviewer=none -q terrain_z$Z.tif terrain
    rm -f terrain_z$Z.tif
    [ $Z -eq $DEM_ZMAX ] || rm -f dem_z$Z.tif
    touch terrain/.z$Z
  "
done

# ---------------------------------------------------------------------------
# 4. Curve di livello: z12 e z13 da TGen, da z14 dal DEM (come build-celle.sh)
# ---------------------------------------------------------------------------
CL="$WORK/curve"
mkdir -p "$CL"
if ! fatto "$CL/contours.pmtiles"; then
  fase "4. curve di livello da TGen (z12, z13)"
  python3 pipeline/unisci-tgen.py "$CL/cl_lr.geojsonl" "quota,type" "$TG" contourlines_lr
  python3 pipeline/unisci-tgen.py "$CL/cl_mr.geojsonl" "quota,type" "$TG" contourlines_mr
  fase "4. curve di dettaglio dal DEM, ogni 25 m, in $NPROC strisce"
  docker run --rm -v "$DEM":/work -v "$CL":/out --entrypoint bash "$GDAL" -c "
    set -euo pipefail
    read -r W H < <(gdalinfo /work/dem_z$DEM_ZMAX.tif | sed -n 's/^Size is \([0-9]*\), \([0-9]*\)/\1 \2/p')
    P=\$(( (H + $NPROC - 1) / $NPROC )); PID=()
    for i in \$(seq 0 \$(( $NPROC - 1 ))); do
      Y=\$(( i * P )); [ \$Y -lt \$H ] || continue
      # una riga in comune con la striscia dopo: le curve si toccano senza buchi
      R=\$(( P + 1 )); [ \$(( Y + R )) -le \$H ] || R=\$(( H - Y ))
      gdal_translate -q -of VRT -srcwin 0 \$Y \$W \$R /work/dem_z$DEM_ZMAX.tif /out/striscia_\$i.vrt
      gdal_contour -q -a quota -i 25 -f GeoJSONSeq /out/striscia_\$i.vrt /out/cl25_\$i.geojsonl &
      PID+=(\$!)
    done
    # una striscia fallita deve fermare tutto: \`wait\` senza argomenti non lo dice
    for p in \${PID[@]}; do wait \$p; done
  "
  # la convenzione di TGen: `cp25` le direttrici ogni 100 m, `cs25` le altre
  cat "$CL"/cl25_*.geojsonl | python3 -c '
import json, sys
for riga in sys.stdin:
    e = json.loads(riga)
    q = int(e["properties"]["quota"] // 1)
    e["properties"] = {"quota": q, "type": ("cp25" if q % 100 == 0 else "cs25"), "src": "dem-italia"}
    print(json.dumps(e, separators=(",", ":")))
' > "$CL/cl_hr.geojsonl"
  rm -f "$CL"/cl25_*.geojsonl "$CL"/striscia_*.vrt
  "${TIPPE[@]}" -o "$CL/cl_lr.mbtiles" -l contour -Z12 -z12 "$CL/cl_lr.geojsonl"
  "${TIPPE[@]}" -o "$CL/cl_mr.mbtiles" -l contour -Z13 -z13 "$CL/cl_mr.geojsonl"
  "${TIPPE[@]}" -o "$CL/cl_hr.mbtiles" -l contour -Z14 -z15 "$CL/cl_hr.geojsonl"
  tile-join -o "$CL/contours.mbtiles" --force -q --no-tile-size-limit \
    "$CL/cl_lr.mbtiles" "$CL/cl_mr.mbtiles" "$CL/cl_hr.mbtiles"
  pmtiles convert "$CL/contours.mbtiles" "$CL/contours.pmtiles"
  segna "$CL/contours.pmtiles"
fi

# ---------------------------------------------------------------------------
# 5. Pubblicazione: versione nuova, DEM e curve al loro posto
# ---------------------------------------------------------------------------
fase "5. pubblicazione della versione $V"
cat > "$STAGE/provenance.json" <<JSON
{
  "archive": "italia",
  "version": "$V",
  "scope": "Italia: OSM $OW,$OS,$OE,$ON; TGen e TINITALY $DW,$DS,$DE,$DN",
  "sources": [
    {"name": "Geofabrik, Europa ritagliata sull'Italia", "files": "$PBF"},
    {"name": "TGen, copia in sola lettura", "files": "$TG"},
    {"name": "TINITALY 10 m, da TGen, quote fino a z$DEM_ZMAX"}
  ],
  "createdAt": "$(date -u +%FT%TZ)"
}
JSON
rm -f "$STAGE"/.fatto-*
mv "$STAGE" "data/archives/$V"
mkdir -p data/dem data/archives/dem
# quanto c'era prima resta accanto, per tornare indietro rinominando
if [ -e data/dem/terrain ]; then mv data/dem/terrain "data/dem/terrain-prima-di-$V"; fi
mv "$DEM/terrain" data/dem/terrain
rm -f data/dem/terrain/.z*
if [ -e data/archives/dem/contours.pmtiles ]; then mv data/archives/dem/contours.pmtiles "data/archives/dem/contours-prima-di-$V.pmtiles"; fi
cp "$CL/contours.pmtiles" data/archives/dem/contours.pmtiles
fase "fatto: versione $V in $(durata $T0), DEM $(find data/dem/terrain -name '*.png' | wc -l | tr -d ' ') tile. Riavvia il server; i file di lavoro restano in $WORK"
