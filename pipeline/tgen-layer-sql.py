#!/usr/bin/env python3
"""
Dal project.mml di TGen alle query di copia, una per layer.

Emulare TGen e' un algoritmo (vedi CLAUDE.md): quali dati servono non si
scopre zona per zona, si legge dal progetto. Ogni layer PostGIS che non
legge OpenStreetMap (quello arriva da Geofabrik) diventa un file SQL che
esporta, in GeoJSON una riga per elemento, esattamente cio' che Mapnik
riceve: la stessa sottoquery, con le stesse CASE che normalizzano le colonne
in `coduso`. Niente da riscrivere a mano, niente da dimenticare.

Layer con la stessa query (le etichette delle curve leggono la stessa
tabella delle curve) si esportano una volta sola.

La query restituisce JSON in un COPY in formato CSV con delimitatore e
virgolette impossibili (\\x02, \\x01): cosi' il JSON esce intatto. Il COPY in
formato testo raddoppierebbe i backslash e romperebbe i nomi con le
virgolette (`Rifugio "La Faggeta"`): e' gia' successo.

Uso: python3 pipeline/tgen-layer-sql.py data/tgen-style/project.mml pipeline/sql/tgen
"""
import re
import sys
from pathlib import Path

import yaml

# L'Italia con un margine: le tile di confine vogliono i dati anche oltre.
# Serve solo a Corine, che copre l'Europa; le altre tabelle sono italiane.
ITALIA = (6.6, 35.4, 18.6, 47.1)

INTESTAZIONE = "-- Generato da pipeline/tgen-layer-sql.py dal project.mml di TGen: non modificare a mano.\n"


def query_layer(tabella: str, geom: str) -> str:
    # La sottoquery del .mml finisce con un alias (`) AS data`): lo si toglie
    # per poterla riusare come sorgente.
    sotto = re.sub(r"\)\s*AS\s+\w+\s*$", ")", tabella.strip(), flags=re.I)
    w, s, e, n = ITALIA
    return f"""COPY (
  SELECT json_build_object(
    'type', 'Feature',
    'properties', to_jsonb(d) - '{geom}',
    'geometry', ST_AsGeoJSON(ST_Transform(d.{geom}, 4326), 6)::json
  )::text
  FROM {sotto} AS d
  WHERE d.{geom} && ST_Transform(ST_MakeEnvelope({w}, {s}, {e}, {n}, 4326), 3857)
) TO STDOUT WITH (FORMAT csv, DELIMITER E'\\x02', QUOTE E'\\x01');
"""


def main(mml_path: str, out_dir: str) -> None:
    mml = yaml.safe_load(open(mml_path))
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    gruppi = {}  # query normalizzata -> dati del file
    for layer in mml["Layer"]:
        ds = layer.get("Datasource", {})
        if ds.get("type") != "postgis":
            continue
        tabella = str(ds.get("table", ""))
        if "planet_osm" in tabella:
            continue  # OpenStreetMap: arriva da Geofabrik, non da TGen
        geom = ds.get("geometry_field")
        db = ds.get("dbname")
        if not geom or not db:
            sys.exit(f"layer {layer['id']}: manca geometry_field o dbname nel .mml")
        chiave = (db, re.sub(r"\s+", " ", tabella).strip())
        prop = layer.get("properties", {}) or {}
        if chiave not in gruppi:
            gruppi[chiave] = {
                "file": layer["id"],
                "db": db,
                "geom": geom,
                "tabelle": sorted(set(re.findall(r"\bFROM\s+([a-z_][a-z_0-9.]*)", tabella, re.I))),
                "layer": [],
                "zoom": [],
                "sql": query_layer(tabella, geom),
            }
        g = gruppi[chiave]
        g["layer"].append(layer["id"])
        g["zoom"].append(f"{prop.get('minzoom', '-')}-{prop.get('maxzoom', '-')}")

    righe = ["file\tdb\tgeom\ttabelle\tlayer\tzoom"]
    for g in gruppi.values():
        testa = (f"{INTESTAZIONE}-- Layer: {', '.join(g['layer'])}\n"
                 f"-- Database: {g['db']}, tabelle: {', '.join(g['tabelle'])}\n")
        (out / f"{g['file']}.sql").write_text(testa + g["sql"])
        righe.append("\t".join([g["file"], g["db"], g["geom"], ",".join(g["tabelle"]),
                                ",".join(g["layer"]), ",".join(g["zoom"])]))
    (out / "manifest.tsv").write_text("\n".join(righe) + "\n")

    # L'inventario di cio' che TGen ha prodotto: una riga per cella di un
    # grado, una colonna per livello con la data. Senza la geometria, che e'
    # ricavabile dai bordi.
    (out / "grid_1x1.sql").write_text(
        INTESTAZIONE
        + "-- Inventario delle celle generate da TGen (generate_map_tiles.sh scrive qui le date).\n"
        + "COPY (SELECT (to_jsonb(g) - 'geom' - 'the_geom' - 'wkb_geometry')::text FROM grid_1x1 g)\n"
        + "TO STDOUT WITH (FORMAT csv, DELIMITER E'\\x02', QUOTE E'\\x01');\n")

    print(f"{len(gruppi)} query per {sum(len(g['layer']) for g in gruppi.values())} layer -> {out}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("uso: tgen-layer-sql.py <project.mml> <cartella-sql>")
    main(sys.argv[1], sys.argv[2])
