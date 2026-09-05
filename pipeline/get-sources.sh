#!/usr/bin/env bash
set -euo pipefail
# Scarica le fonti ESTERNE (non TGen) per un riquadro.
#
# Un clone del repo non ha dati: `data/` sta fuori da git. Questo script
# rimette in piedi tutto cio' che si scarica pubblicamente; per i dati che
# vivono su TGen serve l'accesso alla macchina (vedi docs/import-da-tgen.md).
#
# Uso: get-sources.sh <W> <S> <E> <N>
W="${1:?W}"; S="${2:?S}"; E="${3:?E}"; N="${4:?N}"
mkdir -p data/sources data/dem-src data/landcover-src

echo "== estratti OpenStreetMap (Geofabrik)"
# Gli estratti seguono i confini AMMINISTRATIVI: un riquadro a cavallo di due
# regioni ne vuole due. `centro` copre Toscana/Umbria/Marche/Lazio/Abruzzo,
# l'Emilia-Romagna sta in `nord-est`.
for R in centro nord-est; do
  F="data/sources/${R}.osm.pbf"
  if [ -s "$F" ]; then echo "   $R: gia' presente"; continue; fi
  echo "   scarico $R…"
  # -L obbligatorio: Geofabrik risponde 302 e senza redirect si scarica un
  # file da 250 byte che sembra un PBF e non lo e'
  curl -fsSL -o "$F" "https://download.geofabrik.de/europe/italy/${R}-latest.osm.pbf"
done

echo "== DEM Copernicus GLO-30"
# un tile per grado; i nomi sono NxxE0yy con gli estremi arrotondati per difetto
for LAT in $(seq "${S%.*}" "${N%.*}"); do
  for LON in $(seq "${W%.*}" "${E%.*}"); do
    T=$(printf "N%02d_00_E%03d" "$LAT" "$LON")
    F="data/dem-src/Copernicus_DSM_COG_10_${T}_00_DEM.tif"
    if [ -s "$F" ]; then echo "   $T: gia' presente"; continue; fi
    echo "   scarico $T…"
    curl -fsSL -o "$F" \
      "https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_${T}_00_DEM/Copernicus_DSM_COG_10_${T}_00_DEM.tif" \
      || { echo "   $T non disponibile (probabilmente mare)"; rm -f "$F"; }
  done
done

echo "== ESA WorldCover 2021 (uso suolo a 10 m)"
# i tile coprono 3x3 gradi, con origine su multipli di 3
for LAT in $(seq $(( (${S%.*} / 3) * 3 )) 3 "${N%.*}"); do
  for LON in $(seq $(( (${W%.*} / 3) * 3 )) 3 "${E%.*}"); do
    T=$(printf "N%02dE%03d" "$LAT" "$LON")
    F="data/landcover-src/worldcover_${T}.tif"
    if [ -s "$F" ]; then echo "   $T: gia' presente"; continue; fi
    echo "   scarico $T…"
    curl -fsSL -o "$F" \
      "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_${T}_Map.tif" \
      || { echo "   $T non disponibile"; rm -f "$F"; }
  done
done

echo "== glifi dei font"
[ -d style/glyphs ] && echo "   gia' presenti" || bash pipeline/get-glyphs.sh

echo
echo "== fatto. Restano i dati che vivono su TGen:"
echo "   uso suolo regionale, Corine, toponimi, rifugi"
echo "   vedi docs/import-da-tgen.md"
