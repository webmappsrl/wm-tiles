# Runbook — far girare wm-tiles

Operazioni pratiche: avviare, rigenerare un'area, capire perché qualcosa non
si vede.

---

## Avviare

```bash
npm install
node src/server.js          # http://localhost:8080
open http://localhost:8080/preview/
```

Verifiche rapide:

```bash
curl -s localhost:8080/health              # stato
curl -s localhost:8080/version | jq        # quali dati sta servendo
curl -s localhost:8080/manifest | jq       # gruppi disponibili
```

I dati stanno in `data/`, **fuori dal repo**: un clone appena fatto non ha
archivi e la mappa è vuota. È il comportamento atteso, non un guasto.

---

## Ripopolare da zero, dopo un clone

`data/` sta fuori da git: un clone appena fatto non ha dati e la mappa è
vuota. Con accesso a TGen si rimette in piedi tutto.

**Prerequisiti**: Docker, Node ≥ 18, `osmium`, `tippecanoe`, `pmtiles`, `jq`.
Su macOS: `brew install osmium-tool tippecanoe pmtiles jq`.

```mermaid
flowchart TB
  a["1. fonti pubbliche<br/><i>get-sources.sh</i>"] --> b["2. dati da TGen<br/><i>ssh, sola lettura</i>"]
  b --> c["3. generare gli archivi<br/><i>la sequenza qui sotto</i>"]
  c --> d["4. avviare e verificare"]
```

### 1. Le fonti pubbliche

```bash
bash pipeline/get-sources.sh 10.0 43.62 10.9 44.5
```

Scarica, saltando ciò che c'è già:

| cosa | da dove |
|---|---|
| estratti OSM | `download.geofabrik.de/europe/italy/` — `centro` e `nord-est` |
| DEM Copernicus GLO-30 | `copernicus-dem-30m.s3.amazonaws.com` |
| ESA WorldCover 2021 | `esa-worldcover.s3.eu-central-1.amazonaws.com` |
| glifi dei font | `github.com/openmaptiles/fonts` release v2.0 |

Le sorgenti ausiliarie di planetiler (Natural Earth, water polygons,
lake centerlines) le scarica planetiler stesso al primo giro.

### 2. I dati che vivono su TGen

Servono l'accesso a `ssh tgen` e il rispetto della **sola lettura** — vedi
[`import-da-tgen.md`](import-da-tgen.md) per la regola completa.

**Uso suolo regionale.** Le query ci sono, basta adattare l'envelope:

```bash
ssh tgen "psql -d general -Atf -" < pipeline/sql/usotoscana-bbox.sql   > data/usotoscana.geojsonl
tippecanoe -o /tmp/lc.mbtiles -l landcover -Z8 -z14   --drop-densest-as-needed --simplification=4 --force -q data/usotoscana.geojsonl
pmtiles convert /tmp/lc.mbtiles data/archives/$V/landcover.pmtiles
```

Per un'altra regione serve una query nuova: i nomi reali delle tabelle e la
traduzione delle colonne in `coduso` stanno nelle espressioni `CASE` di
`data/tgen-style/project.mml`.

> **Le query per Corine, toponimi e rifugi non sono nel repo.** Quegli
> archivi furono importati con query scritte al momento e non salvate — gli
> archivi esistono ma la procedura per rifarli va ricostruita. Le tabelle si
> trovano nel `project.mml`: `clc` (`clc12_version_18_5`) per il Corine, e i
> layer dei toponimi e dei rifugi per gli altri due. **Chi rifà una di queste
> importazioni salvi la query in `pipeline/sql/`.**

Nel frattempo, per un'area dentro il riquadro già coperto, si copiano
dall'archivio esistente: `clc`, `toponimi` e `rifugi` hanno un riquadro quasi
nazionale.

### 3-4. Generare e avviare

La sequenza è quella della sezione seguente. Poi:

```bash
node src/server.js &
curl -s localhost:8080/version | jq .provenance
open http://localhost:8080/preview/
```

---

## Rigenerare i dati di un'area

```mermaid
flowchart TB
  a["1. ritagliare il PBF<br/><i>~1 min</i>"] --> b["2. OpenStreetMap<br/><i>~2 min</i>"]
  b --> c["3. sentieri, strade basse, POI<br/><i>~3 min</i>"]
  c --> d["4. DEM e terrain<br/><i>~13 min</i>"]
  d --> e["5. curve di livello<br/><i>~13 min</i>"]
  e --> f["6. uso suolo<br/><i>~10 min + import da TGen</i>"]
  f --> g["7. attivare e verificare"]
```

I tempi sono misurati su **0,9° × 0,88° (~7.000 km²)**. I passi 4-6 si possono
lanciare in parallelo: in tutto **circa 40 minuti**.

### 1. Ritagliare il PBF

Gli estratti Geofabrik seguono i **confini amministrativi**: un riquadro a
cavallo di due regioni ne richiede due, altrimenti metà area resta vuota.

```bash
bash pipeline/merge-extracts.sh <W> <S> <E> <N> data/sources/area.osm.pbf \
  data/sources/centro.osm.pbf data/sources/nord-est.osm.pbf
```

### 2-3. OpenStreetMap, sentieri, strade, POI

```bash
V=$(date +%Y%m%d-%H%M); mkdir -p data/archives/$V

bash pipeline/build-osm.sh data/sources/area.osm.pbf data/archives/$V 14
bash pipeline/build-hiking-full.sh  data/sources/area.osm.pbf <W> <S> <E> <N> data/archives/$V/hiking.pmtiles 10 14
bash pipeline/build-roads-lowzoom.sh data/sources/area.osm.pbf <W> <S> <E> <N> data/archives/$V/roadslz.pmtiles 8 11
bash pipeline/build-osmpoi.sh       data/sources/area.osm.pbf <W> <S> <E> <N> data/archives/$V/osmpoi.pmtiles 11 14
```

### 4. DEM

Il mosaico va costruito con `-r cubicspline` **anche su `gdalbuildvrt`**: con
`-resolution highest` il VRT assume la risoluzione del riquadro più fine e
ricampiona il DEM di base col default `nearest`, duplicando le quote. I
gradini che ne escono diventano un reticolo nell'ombreggiatura.

```bash
docker run --rm -v "$PWD/data":/work -v "$PWD/pipeline":/pipeline \
  --entrypoint bash ghcr.io/osgeo/gdal:ubuntu-small-latest -c '
    cd /work
    gdalbuildvrt -overwrite -q -resolution highest -r cubicspline \
      dem_mosaic.vrt dem-src/*.tif dem-hr/*_4326.tif
    gdalwarp -overwrite -q -t_srs EPSG:3857 -r cubicspline -multi \
      -te_srs EPSG:4326 -te <W> <S> <E> <N> \
      -co COMPRESS=DEFLATE -co BIGTIFF=IF_SAFER dem_mosaic.vrt dem3857.tif
    bash /pipeline/build-terrain-zoom.sh /work 8 16'
mv data/terrain-nuovo data/dem/terrain
```

### 5. Curve di livello

```bash
bash pipeline/build-contours-tipizzate.sh data/dem3857.tif \
  data/archives/dem/contours.pmtiles
```

> Il server apre **`contours.pmtiles`**, non `contours-tgen.pmtiles`.
> Sostituendo il secondo le tile rispondono `HTTP 204` e le curve spariscono
> dalla mappa **senza alcun errore**.

### 6. Uso suolo

Il regionale va riletto da TGen — vedi [`import-da-tgen.md`](import-da-tgen.md).
Corine, toponimi e rifugi hanno un riquadro quasi nazionale: si copiano
dall'archivio precedente.

### 7. Attivare

```bash
# aggiornare lo scope in data/archives/$V/provenance.json
pkill -f "node.*src/server"; node src/server.js &
curl -s localhost:8080/version | jq .provenance.scope
```

---

## Aggiungere un'area alla preview

In `manifest/layers.v1.json`, sotto `previewAreas`:

```json
{ "id": "montepisano", "label": "Monte Pisano (Monte Serra)",
  "center": [10.5533, 43.7581], "zoom": 13 }
```

Accendere **area dati** (tasto `b`) per vedere se il punto cade dentro il
riquadro generato: un'area fuori copertura mostra un pannello vuoto accanto a
un riferimento pieno, e sembra un difetto di stile.

---

## Modificare lo stile

> **Non modificare `style/webmapp.json`: è generato.** Le modifiche si perdono
> alla prima rigenerazione.

```bash
# si toccano questi due:
#   style/zoom-profile.json   quali layer per zoom, parametri per livello
#   style/base-layers.json    struttura dei layer (source, filtri, paint)
npm run style && npm run validate
```

Le soglie di zoom si scrivono **nominali**, come nel CartoCSS: la correzione
dello sfasamento la applica `scalaZoom()` in `build-style.mjs`.

---

## Quando qualcosa non si vede

```mermaid
flowchart TB
  q["un layer non compare"] --> a{"il riquadro<br/>copre l'area?"}
  a -->|no| a1["accendi 'area dati' (b)"]
  a -->|sì| b{"la tile<br/>risponde?"}
  b -->|"HTTP 204"| b1["archivio sbagliato<br/>o area non coperta"]
  b -->|"HTTP 200"| c{"il layer è<br/>nel set?"}
  c -->|no| c1["controlla /sets/{setId}"]
  c -->|sì| d{"soglie di zoom?"}
  d -->|"invisibile a z12<br/>con minzoom 12"| d1["è lo sfasamento:<br/>soglia esclusa"]
  d -->|no| e["apri l'ispettore (i)<br/>e guarda cosa c'è sotto"]
```

**Il riquadro degli errori.** La preview mostra gli errori dello stile in un
pannello rosso in basso, che negli screenshot di misura viene nascosto. Se
qualcosa non torna, guardalo: un'eccezione in `applyStyle` toglie un intero
layer senza altri segnali. `tile-diff.mjs` ora lo legge e lo riporta.

**Verificare che un parametro sia arrivato a destinazione**, prima di
cambiarne il valore. Tre volte in un giorno un parametro *sembrava*
configurato e non lo era: una funzione mai definita, un `mix-blend-mode`
sovrascritto da `ol.css`, un layer rimosso e mai reinserito. Conta i pixel di
un colore noto, leggi il `getComputedStyle`, elenca i layer della mappa.

---

## Verificare la somiglianza

```bash
node tools/tile-diff.mjs 14/8662/5941      # una tile, i due lati
node tools/element-diff.mjs 10.34,44.25    # per elemento, su più zoom
node tools/ombra-vs-gdal.mjs 16            # l'ombra contro gdaldem
node tools/ombra-scala.mjs                 # l'ombra su un punto, tutti gli zoom
node tools/oltre-z16.mjs 16 17 18 19       # oltre il riferimento non sparisce nulla
node tools/avvio-check.mjs                 # l'avvio non "lampeggia"
npx vitest run                             # i test unitari
```

**Il riferimento raster arriva a z16**: oltre, `tile-diff` si rifiuta di
misurare, perché confronterebbe con un ingrandimento.

---

## Spazio e tempi, per pianificare

| | area di prova (7.000 km²) | Italia (43× la terraferma) |
|---|---|---|
| archivi vettoriali | ~200 MB | ~6 GB |
| DEM fino a **z16** | 3,1 GB | **~130 GB** |
| DEM fino a **z14** | ~200 MB | **~8 GB** |
| tempo totale | ~40 min | 12-15 h (z16) · 4-6 h (z14) |

**Il DEM fino a z14 è la scelta ragionevole**: l'ombreggiatura ai livelli
superiori regge bene l'overzoom, da quando le quote si decodificano in
virgola mobile.

Sono stime estrapolate da **una sola area montuosa**: la pianura ha molte
meno curve di livello, la montagna di più.

---

## Tile PNG su S3 e CloudFront

Le tile PNG si servono da **`tiles.webmapp.it`**: un bucket S3 privato che
legge solo CloudFront. Le app passano dal vecchio indirizzo
(`api.webmapp.it/tiles/{z}/{x}/{y}.png`) al nuovo
(`https://tiles.webmapp.it/{z}/{x}/{y}.png`) quando le si configura: non c'è
redirect. Tutto sta in [`infra/tiles-png.yaml`](../infra/tiles-png.yaml), con
le ragioni di ogni scelta.

**Regione `eu-central-1`** (Francoforte): vicina al server di wm-tiles, che
carica le tile, e non va attivata a parte come Milano. Per chi guarda la mappa
la regione non conta, risponde CloudFront.

```bash
# 1. certificato: CloudFront lo legge solo da us-east-1. La validazione chiede
#    un record CNAME sul DNS di webmapp.it (dnsitalia.net)
aws acm request-certificate --region us-east-1 --domain-name tiles.webmapp.it --validation-method DNS
aws acm describe-certificate --region us-east-1 --certificate-arn <arn> \
  --query 'Certificate.DomainValidationOptions[0].ResourceRecord'

# 2. bucket, distribuzione, permessi (a certificato emesso)
aws cloudformation deploy --region eu-central-1 --stack-name wm-tiles-png \
  --template-file infra/tiles-png.yaml --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides NomeBucket=<nome-unico> CertificatoArn=<arn>
aws cloudformation describe-stacks --region eu-central-1 --stack-name wm-tiles-png \
  --query 'Stacks[0].Outputs'
# 3. sul DNS: CNAME tiles.webmapp.it -> DominioCloudFront (dagli output)

# 4. la chiave di chi consegna: si crea qui e vive SOLO sul server di wm-tiles
aws iam create-access-key --user-name wm-tiles-consegna

# 5. migrazione, una volta, dal server di oggi (da li' solo letture)
aws configure set default.s3.max_concurrent_requests 64
bash pipeline/migra-tiles-s3.sh root@46.101.124.52:/root/api.webmapp.it/tiles \
  data/tiles-api s3://<nome-unico>

# 6. verifica, poi si cambia l'indirizzo nelle app
curl -sI https://tiles.webmapp.it/14/8669/5973.png   # 200, image/png, CORS
curl -sI https://tiles.webmapp.it/18/1/1.png          # 404
```

Da lì le consegne vanno sul bucket: `aggiorna-png.sh` con destinazione
`s3://<nome-unico>` e `WM_CLOUDFRONT_ID=<IdDistribuzione>`. Ogni consegna
carica le sole tile cambiate, le invalida in CloudFront e lascia nella
cartella delle copie elenco e ora; per tornare indietro,
`pipeline/ripristina-png-s3.sh` riporta quelle tile alla versione precedente,
che il versioning del bucket conserva per 60 giorni.

**Cosa garantisce la configurazione**, e perché:

- **niente bucket pubblico**: legge solo questa distribuzione (Origin Access
  Control);
- **chi consegna non può cancellare**: solo scrittura e invalidazione, come la
  consegna di oggi, che non cancella mai (sul server ci sono anche tile estere
  che wm-tiles non rifà);
- **una tile mancante risponde 404**, come oggi, e il 404 resta in cache
  cinque minuti;
- **cache**: il browser tiene una tile 7 giorni, come oggi; CloudFront un anno,
  perché ogni consegna invalida ciò che cambia. Le prime 1.000 invalidazioni al
  mese sono gratuite, e sopra le 1.000 tile se ne fa una sola su tutto;
- **CORS aperto** (`Access-Control-Allow-Origin: *`), come oggi: OpenLayers
  carica le tile in modo da poterne leggere i pixel;
- **il bucket sopravvive allo stack**: cancellare lo stack non cancella le tile.

---

## Riferimenti

- come funziona: [`wm-tiles.md`](wm-tiles.md)
- il sistema attuale: [`tgen.md`](tgen.md)
- leggere da TGen: [`import-da-tgen.md`](import-da-tgen.md)
- contratto per le app: [`integrazione.md`](integrazione.md)
- trappole e vincoli, per chi lavora al codice: `CLAUDE.md`
