#!/usr/bin/env bash
set -euo pipefail
# POI puntuali dal PBF all'archivio PMTiles.
#
# Lo script mancava: il primo archivio era stato prodotto a mano, e senza di
# esso una rigenerazione su un'area nuova non era ripetibile.
#
# Uso: build-osmpoi.sh <pbf> <W> <S> <E> <N> <out.pmtiles> [zmin] [zmax]
PBF="${1:?}"; W="${2:?}"; S="${3:?}"; E="${4:?}"; N="${5:?}"; OUT="${6:?}"
ZMIN="${7:-11}"; ZMAX="${8:-14}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

GDAL="ghcr.io/osgeo/gdal:ubuntu-small-latest"
ogr() {  # ogr <out.geojsonl> <file sql>
  docker run --rm -v "$PWD":/w -v "$WORK":/out --entrypoint ogr2ogr "$GDAL" \
    -f GeoJSONSeq "/out/$1" "/w/$PBF" -spat "$W" "$S" "$E" "$N" \
    -lco COORDINATE_PRECISION=6 -sql "@/w/pipeline/$2"
}
echo "== estraggo i POI"
ogr poi.geojsonl osmpoi.sql
echo "   $(wc -l < "$WORK/poi.geojsonl") punti"
# rifugi e ripari disegnati come aree: un punto interno, poi insieme agli altri
ogr aree.geojsonl osmpoi-aree.sql
docker run --rm -v "$WORK":/out -v "$PWD/pipeline":/pipeline:ro --entrypoint python3 "$GDAL" \
  -I /pipeline/punto-interno.py /out/aree.geojsonl /out/aree-punti.geojsonl
echo "   $(wc -l < "$WORK/aree-punti.geojsonl") aree"
cat "$WORK/aree-punti.geojsonl" >> "$WORK/poi.geojsonl"

# `kind` si compone qui: OGRSQL non ha COALESCE.
# Le uscite: TGen va a capo a ogni `;` del nome (`text-wrap-character`), che lo
# Style Spec non ha; il ritorno a capo si scrive qui nel dato.
# Ogni tipo entra nel dato dal livello in cui lo stile lo disegna: uscite
# autostradali da z11 (#junctions), rifugi da z13 (icone CAI di TGen), tutto il
# resto da z14 (selle; sorgenti, grotte, ripari e localita' si vedono da z15-z16).
# Con -r1 tippecanoe non dirada i punti sui livelli bassi: col diradamento di
# serie (-r 2,5) a z13 sparivano rifugi a caso (il Genova, in Val di Funes,
# c'era solo a z14), mentre TGen li mostra tutti.
jq -c '(.properties |= (
   {name: .name, ref: (if .highway == "motorway_junction" then .ref else null end),
    kind: (.t_natural // .t_tourism // .t_amenity // (if .t_pass == "yes" then "mountain_pass" else null end)
           // (if .highway == "motorway_junction" then "motorway_junction" else null end) // .place),
    ele: .ele}
   | if .kind == "motorway_junction" and .name != null then .name |= gsub("\\s*;\\s*"; "\n") else . end
   | with_entries(select(.value != null))
 ))
 | .tippecanoe = {minzoom: (if .properties.kind == "motorway_junction" then 11
                           elif .properties.kind == "alpine_hut" or .properties.kind == "wilderness_hut" then 13
                           else 14 end)}
 ' "$WORK/poi.geojsonl" > "$WORK/poi2.geojsonl"
mv "$WORK/poi2.geojsonl" "$WORK/poi.geojsonl"

echo "== tiles z${ZMIN}-${ZMAX}"
tippecanoe -t "${TMPDIR:-/tmp}" -o "$WORK/osmpoi.mbtiles" -l osmpoi \
  -Z "$ZMIN" -z "$ZMAX" -r1 --drop-densest-as-needed --force -q \
  "$WORK/poi.geojsonl"
pmtiles convert "$WORK/osmpoi.mbtiles" "$OUT"
ls -la "$OUT" | awk '{printf "== fatto: %s (%.1f MB)\n", $9, $5/1048576}'
