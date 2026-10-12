#!/usr/bin/env bash
set -euo pipefail
# Elementi che TGen disegna e lo schema OpenMapTiles non porta, dal PBF.
#
#   barriere     dighe, traverse, porte di chiusa (water-barriers-line/poly, da z13)
#                e frangiflutti e pennelli (piers-line/poly, da z12): `tipo`
#   aree_strade  aree pedonali, piazze, aree stradali (highway-area-fill, da z14): `tipo`
#   filari       filari di alberi (trees, natural=tree_row, da z16)
#   ferrovie     linee principali con nome (railways-text-name, da z14)
#   edifici      edifici con nome e soglia di superficie `zpx` (building-text, da z14)
#   recinzioni   muri, siepi, recinzioni, mura (line-barriers e area-barriers, da z14-z16)
#   punti        passaggi a livello, croci, slarghi di inversione (amenity-low-priority,
#                turning-circle)
#   marine       porti turistici (marinas-area, da z14)
#   turismo      zoo e parchi tematici, soglia 750 pixel (tourism-boundary, da z10)
#   guidovie     corsie guidate degli autobus (guideways, da z11)
#   guadi        guadi sui nodi e al centro delle vie (amenity-points e amenity-line, da z16)
#   ponti, piazze, linee_nome   nomi di ponti (soglia 62,5 px), aree stradali, scogliere
#                e argini (bridge-text, roads-area-text-name, text-line)
#
# Le regole sono in water-features.mss, roads.mss e amenity-points.mss di TGen;
# qui si selezionano le stesse geometrie con le stesse condizioni del .mml.
#
# Uso: build-extra.sh <pbf> <W> <S> <E> <N> <out.pmtiles>
PBF="${1:?}"; W="${2:?}"; S="${3:?}"; E="${4:?}"; N="${5:?}"; OUT="${6:?}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

ogr() {  # ogr <out.geojsonl> <sql>
  docker run --rm -v "$PWD":/w -v "$WORK":/out \
    --entrypoint ogr2ogr ghcr.io/osgeo/gdal:ubuntu-small-latest \
    -f GeoJSONSeq "/out/$1" "/w/$PBF" -spat "$W" "$S" "$E" "$N" \
    -lco COORDINATE_PRECISION=6 -sql "$2"
}

echo "== dighe, traverse, frangiflutti"
# nel layer `lines` del driver OSM `waterway` e `man_made` sono colonne proprie
ogr barriere-l.geojsonl "SELECT name, waterway AS w, man_made FROM lines
  WHERE waterway IN ('dam', 'weir', 'lock_gate') OR man_made IN ('breakwater', 'groyne')"
ogr barriere-p.geojsonl "SELECT name, hstore_get_value(other_tags, 'waterway') AS w, man_made FROM multipolygons
  WHERE hstore_get_value(other_tags, 'waterway') = 'dam' OR man_made IN ('breakwater', 'groyne')"
echo "== aree stradali"
ogr aree.geojsonl "SELECT hstore_get_value(other_tags, 'highway') AS highway,
    hstore_get_value(other_tags, 'area:highway') AS area_highway,
    hstore_get_value(other_tags, 'railway') AS railway FROM multipolygons
  WHERE hstore_get_value(other_tags, 'highway') IN ('pedestrian', 'footway', 'cycleway', 'path', 'living_street',
          'residential', 'unclassified', 'service', 'track', 'platform')
     OR hstore_get_value(other_tags, 'area:highway') IS NOT NULL
     OR hstore_get_value(other_tags, 'railway') = 'platform'"
echo "== nomi di ferrovie ed edifici"
# railways-text-name: le linee principali (usage=main) e l'alta velocita'
ogr ferrovie.geojsonl "SELECT name FROM lines
  WHERE railway IN ('rail', 'narrow_gauge', 'light_rail', 'preserved', 'funicular', 'monorail', 'subway')
    AND name IS NOT NULL
    AND (hstore_get_value(other_tags, 'usage') = 'main' OR hstore_get_value(other_tags, 'highspeed') = 'yes')"
# building-text: edifici con nome, con la soglia way_pixels > 3000 di TGen
ogr edifici.geojsonl "SELECT name FROM multipolygons WHERE building IS NOT NULL AND name IS NOT NULL"
python3 -I pipeline/parchi-soglia.py "$WORK/edifici.geojsonl" "$WORK/edifici-z.geojsonl" 12 14
echo "== barriere, punti, marine e parchi tematici, guidovie"
# line-barriers e area-barriers (classe .barriers di landcover.mss)
ogr recinzioni-l.geojsonl "SELECT barrier, hstore_get_value(other_tags, 'historic') AS historic FROM lines
  WHERE (barrier IN ('chain', 'city_wall', 'embankment', 'ditch', 'fence', 'guard_rail', 'handrail', 'hedge', 'kerb',
                     'retaining_wall', 'wall') OR hstore_get_value(other_tags, 'historic') = 'citywalls')
    AND (waterway IS NULL OR waterway NOT IN ('river', 'canal', 'stream', 'drain', 'ditch', 'wadi'))"
ogr recinzioni-p.geojsonl "SELECT barrier, historic FROM multipolygons
  WHERE barrier IN ('chain', 'city_wall', 'embankment', 'ditch', 'fence', 'guard_rail', 'handrail', 'hedge', 'kerb',
                    'retaining_wall', 'wall') OR historic = 'citywalls'"
# amenity-low-priority e turning-circle: passaggi a livello, croci, slarghi di inversione
ogr punti.geojsonl "SELECT highway, man_made, hstore_get_value(other_tags, 'railway') AS railway,
    hstore_get_value(other_tags, 'historic') AS historic FROM points
  WHERE highway = 'turning_circle' OR man_made = 'cross'
     OR hstore_get_value(other_tags, 'railway') IN ('level_crossing', 'crossing')
     OR hstore_get_value(other_tags, 'historic') = 'wayside_cross'"
# marinas-area e tourism-boundary (zoo e parchi tematici sopra 750 pixel)
ogr marine.geojsonl "SELECT 'marina' AS tipo FROM multipolygons WHERE leisure = 'marina'"
ogr turismo.geojsonl "SELECT tourism AS tipo FROM multipolygons WHERE tourism IN ('zoo', 'theme_park')"
python3 -I pipeline/parchi-soglia.py "$WORK/turismo.geojsonl" "$WORK/turismo-z.geojsonl" 10 14 750
# i guadi (ford=yes o stepping_stones), da z16: su una via (amenity-line), al centro
# della via, e sui nodi (`highway_ford` di amenity-points). In OSM sono quasi tutti
# nodi, il punto dove il sentiero incrocia il torrente: fino all'11/10/2026 si
# prendevano solo le vie e sulla mappa i guadi mancavano quasi ovunque.
ogr guadi-l.geojsonl "SELECT 'ford' AS tipo FROM lines
  WHERE hstore_get_value(other_tags, 'ford') IN ('yes', 'stepping_stones')"
python3 -I pipeline/centro-linee.py "$WORK/guadi-l.geojsonl" "$WORK/guadi.geojsonl"
ogr guadi-p.geojsonl "SELECT 'ford' AS tipo FROM points
  WHERE hstore_get_value(other_tags, 'ford') IN ('yes', 'stepping_stones')"
cat "$WORK/guadi-p.geojsonl" >> "$WORK/guadi.geojsonl"
# guideways
ogr guidovie.geojsonl "SELECT 'bus_guideway' AS tipo FROM lines WHERE highway = 'bus_guideway'"
echo "== nomi di ponti, piazze, scogliere e argini"
# bridge-text: way_pixels > 62,5 (11 px sopra 250, cioe' un livello dopo)
ogr ponti.geojsonl "SELECT name FROM multipolygons WHERE man_made = 'bridge' AND name IS NOT NULL"
python3 -I pipeline/parchi-soglia.py "$WORK/ponti.geojsonl" "$WORK/ponti-z.geojsonl" 12 14 62.5
# roads-area-text-name: aree stradali con nome, way_pixels > 3000
ogr piazze.geojsonl "SELECT name FROM multipolygons WHERE name IS NOT NULL
  AND (hstore_get_value(other_tags, 'highway') IN ('pedestrian', 'footway', 'cycleway', 'living_street', 'track', 'residential', 'service')
       OR hstore_get_value(other_tags, 'area:highway') IS NOT NULL)"
python3 -I pipeline/parchi-soglia.py "$WORK/piazze.geojsonl" "$WORK/piazze-z.geojsonl" 12 14
# text-line: nomi di scogliere e argini
ogr linee-nome.geojsonl "SELECT name, hstore_get_value(other_tags, 'natural') AS natural, man_made FROM lines
  WHERE name IS NOT NULL AND (hstore_get_value(other_tags, 'natural') = 'cliff' OR man_made = 'embankment')"

for f in recinzioni-l recinzioni-p; do
  jq -c '.properties = {tipo: (if .properties.historic == "citywalls" then "city_wall" else .properties.barrier end)}' \
    "$WORK/$f.geojsonl" > "$WORK/$f-2.geojsonl"
done
cat "$WORK/recinzioni-l-2.geojsonl" "$WORK/recinzioni-p-2.geojsonl" > "$WORK/recinzioni.geojsonl"
jq -c '.properties = {tipo: (if .properties.highway == "turning_circle" then "turning_circle"
                             elif .properties.railway != null then .properties.railway
                             else "cross" end)}' "$WORK/punti.geojsonl" > "$WORK/punti-2.geojsonl"
jq -c '.properties = {name: .properties.name, tipo: (if .properties.natural == "cliff" then "cliff" else "embankment" end)}' \
  "$WORK/linee-nome.geojsonl" > "$WORK/linee-nome-2.geojsonl"

echo "== filari"
ogr filari.geojsonl "SELECT 'tree_row' AS tipo FROM lines WHERE hstore_get_value(other_tags, 'natural') = 'tree_row'"

# OGRSQL non ha COALESCE: `tipo` si compone qui, e `area:highway` vale come `highway`
for f in barriere-l barriere-p; do
  jq -c '.properties = ({tipo: (.properties.w // .properties.man_made), name: .properties.name} | with_entries(select(.value != null)))' \
    "$WORK/$f.geojsonl" > "$WORK/$f-2.geojsonl"
done
jq -c '.properties = {tipo: (if .properties.railway == "platform" then "platform"
                             else (.properties.highway // .properties.area_highway) end)}' \
  "$WORK/aree.geojsonl" > "$WORK/aree2.geojsonl"
cat "$WORK/barriere-l-2.geojsonl" "$WORK/barriere-p-2.geojsonl" > "$WORK/barriere.geojsonl"
for f in barriere aree2 filari ferrovie edifici-z recinzioni punti-2 marine turismo-z guidovie ponti-z piazze-z linee-nome-2 guadi; do echo "   $f: $(wc -l < "$WORK/$f.geojsonl" | tr -d ' ')"; done

# il livello d'ingresso di ogni gruppo: l'archivio parte da z10 (parchi tematici,
# guidovie), e senza soglia le recinzioni di tutta Italia finirebbero nelle tile di z10
minz() {
  jq -c --argjson z "$2" '. + {tippecanoe: ((.tippecanoe // {}) + {minzoom: ([$z, (.tippecanoe.minzoom // 0)] | max)})}' \
    "$WORK/$1.geojsonl" > "$WORK/$1.tmp" && mv "$WORK/$1.tmp" "$WORK/$1.geojsonl"
}
minz barriere 12; minz aree2 14; minz filari 14; minz ferrovie 14; minz recinzioni 14
minz punti-2 14; minz marine 14; minz linee-nome-2 14; minz guidovie 11; minz guadi 14

tippecanoe -t "${TMPDIR:-/tmp}" -o "$WORK/extra.mbtiles" --force -q -Z10 -z14 \
  --no-feature-limit --no-tile-size-limit \
  -L barriere:"$WORK/barriere.geojsonl" -L aree_strade:"$WORK/aree2.geojsonl" -L filari:"$WORK/filari.geojsonl" \
  -L ferrovie:"$WORK/ferrovie.geojsonl" -L edifici:"$WORK/edifici-z.geojsonl" \
  -L recinzioni:"$WORK/recinzioni.geojsonl" -L punti:"$WORK/punti-2.geojsonl" -L marine:"$WORK/marine.geojsonl" \
  -L turismo:"$WORK/turismo-z.geojsonl" -L guidovie:"$WORK/guidovie.geojsonl" -L ponti:"$WORK/ponti-z.geojsonl" \
  -L piazze:"$WORK/piazze-z.geojsonl" -L linee_nome:"$WORK/linee-nome-2.geojsonl" -L guadi:"$WORK/guadi.geojsonl"
pmtiles convert "$WORK/extra.mbtiles" "$OUT"
ls -la "$OUT" | awk '{printf "== fatto: %s (%.1f MB)\n", $9, $5/1048576}'
