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
  # osmconf-con-source.ini: GDAL di serie scarta `ele`, e le cime restavano senza quota
  docker run --rm -v "$PWD":/w -v "$WORK":/out --entrypoint ogr2ogr "$GDAL" \
    --config OSM_CONFIG_FILE /w/pipeline/osmconf-con-source.ini \
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
                           elif .properties.kind == "peak" or .properties.kind == "volcano" then 13
                           elif .properties.kind == "village" or .properties.kind == "suburb" then 12
                           else 14 end)}
 ' "$WORK/poi.geojsonl" > "$WORK/poi2.geojsonl"
# Le localita' a capo come Mapnik e nell'ordine di placenames-small.
# Il nome delle cime come lo compone TGen (text-point del .mml): nome, a capo, la
# quota arrotondata con uno spazio non divisibile prima di "m"; spezzato a 3 em
# come Mapnik, che va a capo DOPO la parola che supera la larghezza ("La
# Montagnola / dell'Elmo / 852 m", OpenLayers "La / Montagnola / ..."). Le cime
# in ordine di quota: TGen le piazza per `score` = quota, e a parita' di layer
# OpenLayers premia la feature che viene prima (--preserve-input-order).
python3 -I -c '
import importlib.util, json, re, sys
spec = importlib.util.spec_from_file_location("lp", sys.argv[2])
lp = importlib.util.module_from_spec(spec); spec.loader.exec_module(lp)
glifi = json.load(open(sys.argv[3]))
larghezze = {"corpo": glifi["corpo"], "table": glifi["font"]["R"]}
# placenames-small: ORDER BY classe, length(name) DESC, name
CLASSI = ["suburb", "village", "hamlet", "quarter", "neighbourhood", "locality", "isolated_dwelling", "farm"]
righe = []
for riga in open(sys.argv[1]):
    f = json.loads(riga)
    p = f["properties"]
    quota = None
    if p.get("kind") in CLASSI and p.get("name"):
        # a capo come Mapnik: 4,5 em per frazioni e localita a z15, 5 em per il resto
        p["w45"] = lp.wrap_like_mapnik(p["name"], larghezze, 4.5)
        p["w50"] = lp.wrap_like_mapnik(p["name"], larghezze, 5)
        righe.append(((1, CLASSI.index(p["kind"]), -len(p["name"]), p["name"]), json.dumps(f, ensure_ascii=False) + "\n"))
        continue
    # la quota la aggiunge TGen a cime, vulcani, selle, rifugi alpini e ripari;
    # grotte e bivacchi hanno solo il nome. Tutti a capo a 3 em.
    if p.get("kind") in ("peak", "volcano", "saddle", "alpine_hut", "shelter", "wilderness_hut", "cave_entrance"):
        e = str(p.get("ele") or "").strip()
        if p.get("kind") in ("peak", "volcano", "saddle", "alpine_hut", "shelter") and re.fullmatch(r"-?\d{1,4}(\.\d+)?", e):
            quota = float(e)
        if p.get("name"):
            t = lp.wrap_like_mapnik(p["name"], larghezze, 3)
            if quota is not None:
                t += "\n" + str(round(quota)).replace("-", "\u2212") + "\u00a0m"
            p["t"] = t
    if p.get("kind") in ("peak", "volcano"):
        chiave = (0, -(quota if quota is not None else -1e9), 0, "")
    else:
        chiave = (2, 0, 0, "")
    righe.append((chiave, riga if "t" not in p else json.dumps(f, ensure_ascii=False) + "\n"))
righe.sort(key=lambda r: r[0])
sys.stdout.write("".join(r[1] for r in righe))
' "$WORK/poi2.geojsonl" pipeline/label-points.py style/glifi-larghezze.json > "$WORK/poi.geojsonl"

echo "== tiles z${ZMIN}-${ZMAX}"
tippecanoe -t "${TMPDIR:-/tmp}" -o "$WORK/osmpoi.mbtiles" -l osmpoi \
  -Z "$ZMIN" -z "$ZMAX" -r1 --drop-densest-as-needed --preserve-input-order --force -q \
  "$WORK/poi.geojsonl"
pmtiles convert "$WORK/osmpoi.mbtiles" "$OUT"
ls -la "$OUT" | awk '{printf "== fatto: %s (%.1f MB)\n", $9, $5/1048576}'
