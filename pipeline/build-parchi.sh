#!/usr/bin/env bash
set -euo pipefail
# Parchi nazionali e riserve naturali, selezionati come li seleziona TGen.
#
# Il layer `nature-reserve-boundaries` del project.mml prende
#   (boundary = 'national_park' OR leisure = 'nature_reserve') AND building IS NULL
# da z8. Lo schema OpenMapTiles non porta `leisure`, e le sue classi non
# coincidono: una riserva con protect_class=4 diventa `wildlife_refuge`, e il
# vecchio filtro sulle classi la perdeva (Riserva Rossomanno-Grottascura-Bellia,
# vicino a Caltanissetta). Si estrae quindi dal PBF con la stessa condizione.
# La soglia sulla superficie (way_pixels > 3000) la scrive parchi-soglia.py.
#
# Uso: build-parchi.sh <pbf> <W> <S> <E> <N> <out.pmtiles>
PBF="${1:?}"; W="${2:?}"; S="${3:?}"; E="${4:?}"; N="${5:?}"; OUT="${6:?}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

echo "== estraggo parchi e riserve"
docker run --rm -v "$PWD":/w -v "$WORK":/out \
  --entrypoint ogr2ogr ghcr.io/osgeo/gdal:ubuntu-small-latest \
  -f GeoJSONSeq "/out/parchi.geojsonl" "/w/$PBF" \
  -spat "$W" "$S" "$E" "$N" -lco COORDINATE_PRECISION=6 \
  -sql "SELECT name, boundary, leisure FROM multipolygons \
        WHERE (boundary = 'national_park' OR leisure = 'nature_reserve') AND building IS NULL"
echo "   $(wc -l < "$WORK/parchi.geojsonl" | tr -d ' ') aree"

# way_pixels > 3000, come nel .mml: il primo livello da cui ogni area compare
python3 -I pipeline/parchi-soglia.py "$WORK/parchi.geojsonl" "$WORK/parchi-z.geojsonl" 8 14
# il nome come punto, dove lo scrive Mapnik: OpenLayers etichetta ogni parte di un
# multipoligono e ogni tile in cui l'area cade (vedi label-points.py)
# a capo a 3 em come Mapnik (@standard-wrap-width): "Parco Naturale / di Migliarino /
# San Rossore / Massaciuccoli" nei PNG di TGen
python3 -I pipeline/label-points.py "$WORK/parchi-z.geojsonl" "$WORK/parchi-nomi.geojsonl" \
  --wrap style/glifi-larghezze.json I 3
# Da z13 TGen scrive il nome lungo il confine (nature-reserve-text di project.xml:
# placement="line", 10 px, dy=-10) e solo se way_pixels > 192000, cioe' 64 volte
# la soglia dell'area: tre livelli dopo zpx. Non ha spacing, quindi Mapnik scrive un
# nome per ogni metatile (8x8 tile, 2048 px) in cui il confine passa.
: > "$WORK/parchi-confine.geojsonl"
for z in 13 14 15 16; do
  python3 -I pipeline/punti-lungo-linee.py "$WORK/parchi-z.geojsonl" "$WORK/pc$z.geojsonl" \
    --testo name --zoom $z-$z --spaziatura 2048 --dimensione 10 --dy -10 \
    --filtro "p['zpx'] + 3 <= $z"
  cat "$WORK/pc$z.geojsonl" >> "$WORK/parchi-confine.geojsonl"
done

# I nomi dei boschi: in TGen li scrive text-poly (natural_wood, landuse_forest)
# con la stessa soglia di superficie dei parchi. Servono solo per l'etichetta.
echo "== estraggo i boschi con nome"
docker run --rm -v "$PWD":/w -v "$WORK":/out \
  --entrypoint ogr2ogr ghcr.io/osgeo/gdal:ubuntu-small-latest \
  -f GeoJSONSeq "/out/boschi.geojsonl" "/w/$PBF" \
  -spat "$W" "$S" "$E" "$N" -lco COORDINATE_PRECISION=6 \
  -sql "SELECT name FROM multipolygons \
        WHERE (natural = 'wood' OR landuse = 'forest') AND name IS NOT NULL AND building IS NULL"
echo "   $(wc -l < "$WORK/boschi.geojsonl" | tr -d ' ') boschi"
python3 -I pipeline/parchi-soglia.py "$WORK/boschi.geojsonl" "$WORK/boschi-a.geojsonl" 8 14
python3 -I pipeline/label-points.py "$WORK/boschi-a.geojsonl" "$WORK/boschi-z.geojsonl"

# I nomi di laghi e bacini: water.mss li scrive con la stessa soglia
# (natural_water, natural_bay, landuse_reservoir, landuse_basin). OpenMapTiles
# porta i nomi dei laghi solo da z13 e lungo una linea, TGen da z0 e orizzontali.
echo "== estraggo le acque con nome"
docker run --rm -v "$PWD":/w -v "$WORK":/out \
  --entrypoint ogr2ogr ghcr.io/osgeo/gdal:ubuntu-small-latest \
  -f GeoJSONSeq "/out/acque.geojsonl" "/w/$PBF" \
  -spat "$W" "$S" "$E" "$N" -lco COORDINATE_PRECISION=6 \
  -sql "SELECT name FROM multipolygons \
        WHERE (natural IN ('water', 'bay') OR landuse IN ('reservoir', 'basin')) AND name IS NOT NULL"
echo "   $(wc -l < "$WORK/acque.geojsonl" | tr -d ' ') acque"
# da z4: text-poly-low-zoom ha minzoom 0 (il Golfo di Gaeta a z7)
python3 -I pipeline/parchi-soglia.py "$WORK/acque.geojsonl" "$WORK/acque-a.geojsonl" 4 14
python3 -I pipeline/label-points.py "$WORK/acque-a.geojsonl" "$WORK/acque-z.geojsonl"

# Citta' e paesi come placenames-medium: punteggio = popolazione (100.000 per una citta'
# senza, 1.000 per un paese) raddoppiata per i capoluoghi di regione (capital=4); la capitale
# (capital=yes) e' in capital-names. Il punteggio decide da che livello si vede il nome:
# citta' >= 3.000.000 da z4, >= 400.000 da z5 (fino a z13), >= 70.000 da z6, le altre da z7
# (fino a z14); paesi da z9 a z15.
echo "== estraggo citta' e paesi"
docker run --rm -v "$PWD":/w -v "$WORK":/out \
  --entrypoint ogr2ogr ghcr.io/osgeo/gdal:ubuntu-small-latest \
  -f GeoJSONSeq "/out/citta.geojsonl" "/w/$PBF" \
  -spat "$W" "$S" "$E" "$N" -lco COORDINATE_PRECISION=6 \
  -sql "SELECT osm_id, name, place, hstore_get_value(other_tags, 'population') AS population,
               hstore_get_value(other_tags, 'capital') AS capital
        FROM points WHERE place IN ('city', 'town') AND name IS NOT NULL"
jq -c 'select(.properties.capital != "yes")
  | .properties as $p
  | ($p.population // "" | test("^[0-9]{1,8}$")) as $ha
  | (if $ha then ($p.population | tonumber) elif $p.place == "city" then 100000 else 1000 end) as $pop
  | ($pop * (if $p.capital == "4" then 2 else 1 end)) as $score
  | (if $p.place == "city" then 1 else 2 end) as $cat
  | .properties = {name: $p.name, category: $cat, score: $score, osm_id: $p.osm_id}
  | .tippecanoe = (if $cat == 2 then {minzoom: 9, maxzoom: 15}
                   elif $score >= 3000000 then {minzoom: 4, maxzoom: 13}
                   elif $score >= 400000 then {minzoom: 5, maxzoom: 13}
                   elif $score >= 70000 then {minzoom: 6, maxzoom: 14}
                   else {minzoom: 7, maxzoom: 14} end)' "$WORK/citta.geojsonl" \
  | jq -sc 'sort_by(-.properties.score)[]' > "$WORK/citta-o.geojsonl"
# Da che parte del pallino va il nome: TGen prova 'N,S,E,W' se dir = 1, 'S,N,E,W' se
# dir = 0, con dir = round(ascii(md5(osm_id::text)) / 55) sugli interi di PostgreSQL
# (placenames-medium del .mml): sopra se l'md5 comincia per 7-9 o a-f. OpenLayers non
# prova alternative, quindi si scrive la prima scelta (Zadar, Split, Potenza sopra)
# Il nome a capo come Mapnik, che va a capo DOPO la parola che supera la larghezza
# (OpenLayers prima: "Alba / Adriatica", "Ascoli / Piceno" a z9, TGen su una riga).
# La larghezza in em cambia per classe e livello (placenames.mss): 2,7 / 3 / 4 / 4,1 /
# 4,5 / 5 em, una variante per ognuna (w27...w50) e lo stile sceglie quella del livello.
python3 -I -c '
import hashlib, importlib.util, json, sys
spec = importlib.util.spec_from_file_location("lp", sys.argv[2])
lp = importlib.util.module_from_spec(spec); spec.loader.exec_module(lp)
glifi = json.load(open(sys.argv[3]))
larghezze = {"corpo": glifi["corpo"], "table": glifi["font"]["R"]}
for riga in open(sys.argv[1]):
    f = json.loads(riga)
    p = f["properties"]
    p["dir"] = ord(hashlib.md5(str(p.pop("osm_id")).encode()).hexdigest()[0]) // 55
    for em in (2.7, 3, 4, 4.1, 4.5, 5):
        p["w%d" % round(em * 10)] = lp.wrap_like_mapnik(p["name"], larghezze, em)
    print(json.dumps(f, ensure_ascii=False))
' "$WORK/citta-o.geojsonl" pipeline/label-points.py style/glifi-larghezze.json > "$WORK/citta-z.geojsonl"
# l'ordine conta: a parita' di layer OpenLayers da' la precedenza alla feature che viene
# prima nella tile, e TGen piazza i nomi in ORDER BY score DESC (vedi --preserve-input-order)
echo "   $(wc -l < "$WORK/citta-z.geojsonl" | tr -d ' ') citta' e paesi"

# Nazioni e regioni: TGen le nomina dal poligono amministrativo (country-names e
# state-names leggono planet_osm_polygon, text-placement interior), non dal punto
# place=state di OpenMapTiles: "Hrvatska" sta sulla costa perche' il poligono della
# Croazia comprende il mare territoriale, e "Basilicata" e "Corse" mancavano.
# Finestre di superficie di placenames.mss: .country 1000-360000 px da z3, .state
# 3000-196000 px da z5. Le aree tagliate dal bordo dell'estratto si scartano.
echo "== estraggo nazioni e regioni"
docker run --rm -v "$PWD":/w -v "$WORK":/out \
  --entrypoint ogr2ogr ghcr.io/osgeo/gdal:ubuntu-small-latest \
  -f GeoJSONSeq "/out/admin.geojsonl" "/w/$PBF" \
  -spat "$W" "$S" "$E" "$N" -lco COORDINATE_PRECISION=6 \
  -sql "SELECT name, admin_level FROM multipolygons \
        WHERE boundary = 'administrative' AND admin_level IN ('2', '4') AND name IS NOT NULL"
jq -c 'select(.properties.admin_level == "2")' "$WORK/admin.geojsonl" > "$WORK/nazioni.geojsonl"
jq -c 'select(.properties.admin_level == "4")' "$WORK/admin.geojsonl" > "$WORK/regioni.geojsonl"
python3 -I pipeline/label-points.py "$WORK/nazioni.geojsonl" "$WORK/nazioni-p.geojsonl" \
  --window 1000 360000 3 16 --extract "$W,$S,$E,$N"
python3 -I pipeline/label-points.py "$WORK/regioni.geojsonl" "$WORK/regioni-p.geojsonl" \
  --window 3000 196000 5 16 --extract "$W,$S,$E,$N"
# le nazioni prima: a parita' di layer OpenLayers premia la feature che viene prima
cat "$WORK/nazioni-p.geojsonl" "$WORK/regioni-p.geojsonl" \
  | jq -c '.properties.admin_level |= tonumber' > "$WORK/nomi-admin.geojsonl"

# -r1: i nomi sono punti, e di serie tippecanoe li dirada sotto z14; TGen li scrive tutti
# fino a z16 per i nomi lungo il confine: lo spostamento di 10 px vale a quel livello
tippecanoe -t "${TMPDIR:-/tmp}" -o "$WORK/parchi.mbtiles" --force -q -Z3 -z16 --preserve-input-order \
  --no-feature-limit --no-tile-size-limit --simplification=4 -r1 \
  -L parchi:"$WORK/parchi-z.geojsonl" -L parchi_nomi:"$WORK/parchi-nomi.geojsonl" \
  -L parchi_confine:"$WORK/parchi-confine.geojsonl" -L nomi_admin:"$WORK/nomi-admin.geojsonl" -L boschi:"$WORK/boschi-z.geojsonl" \
  -L acque:"$WORK/acque-z.geojsonl" -L citta:"$WORK/citta-z.geojsonl"
pmtiles convert "$WORK/parchi.mbtiles" "$OUT"
ls -la "$OUT" | awk '{printf "== fatto: %s (%.1f MB)\n", $9, $5/1048576}'
