#!/usr/bin/env bash
set -euo pipefail
# L'estratto OSM nazionale: l'Europa di Geofabrik ritagliata sul riquadro
# dell'Italia. Non `italy-latest`: e' tagliato al confine e produce tile
# incomplete sull'arco alpino (CLAUDE.md).
#
# L'estratto dell'Europa resta: e' quello che aggiorna-osm.sh porta avanti con
# le modifiche giornaliere (la sua intestazione dice da dove ripartire), e il
# ritaglio sulle celle lo fa build-celle.sh. Lo si scarica una volta sola, e
# il download riprende da dove si era fermato.
#
# Uso: pipeline/estratto-italia.sh <cartella>   (es. data/sources)
DIR="${1:?cartella di destinazione}"
URL="https://download.geofabrik.de/europe-latest.osm.pbf"
BBOX="4.39,35.37,22.11,48.06"
mkdir -p "$DIR"
cd "$DIR"

if [ ! -f europe-latest.osm.pbf ]; then
  # Geofabrik reindirizza i file grandi su un mirror, e il .md5 sta li', non
  # all'indirizzo di Geofabrik (che risponde 404): si segue il reindirizzamento
  FINALE=$(curl -fsSL -r 0-0 -o /dev/null -w '%{url_effective}' "$URL")
  TOTALE=$(curl -fsSI "$FINALE" | awk 'tolower($1) == "content-length:" { print $2 }' | tr -d '\r')
  if [ "$(stat -c %s europe-latest.osm.pbf.part 2>/dev/null || echo 0)" != "$TOTALE" ]; then
    echo "== $(date -u +%FT%TZ) scarico l'Europa da $FINALE"
    curl -fsSL --retry 5 -C - -o europe-latest.osm.pbf.part "$FINALE"
  fi
  # l'md5 si legge DOPO: se nel frattempo e' uscito un file nuovo, non coincide
  # e si riscarica, invece di tenere un file a meta' fra due giorni
  curl -fsSL -o europe-latest.osm.pbf.md5 "$FINALE.md5"
  ATTESO=$(cut -d' ' -f1 europe-latest.osm.pbf.md5)
  REALE=$(md5sum europe-latest.osm.pbf.part | cut -d' ' -f1)
  if [ "$ATTESO" != "$REALE" ]; then
    echo "!! md5 diverso (atteso $ATTESO, scaricato $REALE): cancello e riprova" >&2
    rm -f europe-latest.osm.pbf.part
    exit 1
  fi
  mv europe-latest.osm.pbf.part europe-latest.osm.pbf
fi
echo "== Europa: $(du -h europe-latest.osm.pbf | cut -f1), modifiche Geofabrik alla" \
  "$(osmium fileinfo -g header.option.osmosis_replication_sequence_number europe-latest.osm.pbf)" \
  "del $(osmium fileinfo -g header.option.osmosis_replication_timestamp europe-latest.osm.pbf)"

echo "== $(date -u +%FT%TZ) ritaglio dell'Italia ($BBOX)"
osmium extract -b "$BBOX" europe-latest.osm.pbf -o italia.osm.pbf.tmp -f pbf --overwrite
mv italia.osm.pbf.tmp italia.osm.pbf
echo "== $(date -u +%FT%TZ) Italia: $(du -h italia.osm.pbf | cut -f1)"
