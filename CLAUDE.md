# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Lingua

Rispondi sempre in italiano. La documentazione, i commenti nel codice e i
messaggi di log di questo repo sono in italiano: mantieni quella lingua.

## Cos'e' wm-tiles

Server di tiles **vettoriali** derivate da OpenStreetMap, destinato a
sostituire le tiles raster PNG servite oggi da
`https://api.webmapp.it/tiles/{z}/{x}/{y}.png`. Il consumatore finale sono la
webapp e la app mobile Webmapp, tramite `map-core`.

**L'obiettivo dichiarato dal committente e' la verosimiglianza al PNG
attuale**: il prototipo si valuta confrontandolo con il raster di riferimento,
non in astratto. Il riferimento raster e' prodotto da un server Mapnik
chiamato in questo repo **TGen**; il prototipo si chiama **locale**. Usa
sempre questi due nomi — mai "loro"/"nostro" — perche' ogni discussione
riguarda due sistemi concreti e confondere chi produce cosa fa perdere tempo.

Stato: prototipo su una singola area appenninica
(bbox `10.0,43.9,10.9,44.5`), pensato per scalare all'Italia intera. Ogni
script in `pipeline/` prende l'area come argomento proprio per questo: non
scrivere logica che assuma il bbox demo.

## Vincoli non negoziabili

Sono decisioni del committente, non preferenze tecniche. Violarle invalida il
lavoro.

1. **TGen e' sola lettura.** I dati cartografici migliori (uso suolo
   regionale, curve di livello, toponimi, rifugi) vivono su TGen
   (`ssh tgen`, 95.216.11.110), un server **di produzione**. Sono ammessi
   solo `SELECT`, `COPY ... TO STDOUT` e `tar cf -` su stdout. Nessuna
   scrittura, nessun file creato la', nessun servizio riavviato, nessuna
   query salvata sul server (passa le query da stdin:
   `ssh tgen "psql -d general -Atf -" < pipeline/sql/x.sql`).
   **Mostra ogni comando SSH e attendi l'ok prima di eseguirlo.**
2. **Niente raster come sfondo di mappa.** Uso suolo, curve di livello e
   ombreggiatura devono essere vettoriali o calcolati. L'unica eccezione e' il
   DEM come sorgente `raster-dem` (le tile codificano *quote*, non pixel di
   mappa) da cui il rilievo viene calcolato sulla GPU.
3. **Il frontend e' OpenLayers.** MapLibre non sara' mai usato in produzione:
   ogni soluzione lato client va verificata in OpenLayers. Vedi
   "Trappole di ol-mapbox-style".
4. Nessun commit senza conferma esplicita. Nessun ticket Orchestrator, nessuna
   stima.

## Comandi

```bash
npm run dev              # server con reload su :8080
npm start                # server
npm test                 # vitest run
npm test -- filter       # un solo file di test
npm run validate         # valida style/webmapp.json contro lo Style Spec
```

`npm run validate` **prima di ogni consegna**: un'espressione non valida fa
rifiutare l'intero stile e la mappa esce bianca, senza errori in console.

### Confronto con il riferimento

```bash
rm -f data/compare/*.png                  # obbligatorio: vedi sotto
node tools/compare.mjs                    # 6 viste, locale vs TGen affiancati
node tools/measure.mjs data/compare       # delta luminosita' + delta dev.std
node tools/zoom-series.mjs 10 16          # una vista per livello di zoom
node tools/isolate.mjs                    # misura con ?only= / ?off=
node tools/grid-shot.mjs                  # verifica la griglia XYZ della preview
node tools/tile-diff.mjs 10/542/371       # UNA tile, locale e riferimento a confronto
node tools/zoom-diff.mjs 10.72,44.21 10 16  # una tile per livello: la scala intera
node tools/ref-palette.mjs 10.72,44.21    # colore dominante per livello, due lati
node tools/layer-contrib.mjs 10/541/371   # quanto contrasto aggiunge ogni layer
node tools/shade-grid-test.mjs 13 14 15 16  # l'ombreggiatura non deve fare reticolo
node tools/oltre-z16.mjs 16 17 18 19      # oltre il riferimento non deve sparire nulla
```

`layer-contrib.mjs` spegne un layer per volta e rimisura: dice DOVE nasce uno
scarto che le medie complessive rilevano soltanto. A z10 ha attribuito alle
etichette dei parchi 5,9 punti di deviazione standard su 4,2 di eccesso
totale — non era ne' l'ombreggiatura ne' i confini, come si sarebbe detto a
occhio.

`shade-grid-test.mjs` misura la periodicita' delle differenze fra righe e
colonne dell'ombreggiatura isolata (`?only=` non spegne l'ombra) e fallisce
sopra 2,2. Serve perche' il reticolo e' **invisibile alle medie**: luminosita'
e contrasto complessivi quasi non si spostano, ma a occhio rovina la mappa.

**Le soglie di zoom dentro `step` e `interpolate` vanno scritte con un livello
in meno.** `ol-mapbox-style` valuta le espressioni di zoom sfasate di uno: a
vista z12 applica il valore dichiarato per z11. E' la stessa ragione per cui
`build-style.mjs` scrive `minzoom = zmin - 1`. Verificato contando i pixel di
un colore noto (`road-fill-secondary`): con soglia 12 il colore compariva a
z13. Vale per OGNI espressione dipendente dallo zoom, non solo per i colori.

**Misura sempre su tutta la scala** (`zoom-diff`), non su un livello: i
parametri del riferimento cambiano per fascia e una correzione tarata su z10
puo' peggiorare z13.

`tile-diff.mjs` prende **tre scatti e tiene il piu' scuro**. Non e' una
cautela generica: la costruzione differita dei layer di `ol-mapbox-style`
corre con lo screenshot e circa un giro su quattro l'ombreggiatura non e'
ancora disegnata — l'immagine risulta 15 punti piu' chiara, senza errori in
console e con la sorgente che si dichiara `ready`, quindi il difetto non e'
rilevabile dallo stato. L'ombra puo' solo scurire, mai schiarire. Per lo
stesso motivo la preview accetta `?c=lon,lat`: spostare la vista dopo il
caricamento innesca quella corsa.

Nella preview c'e' un **riquadro rosso dell'area generata** (interruttore
`area dati`, tasto `b`, `?copertura=on`): il bbox si legge da `/version`, cosi'
segue l'area davvero prodotta. Serve perche' fuori da quel riquadro le tile
vettoriali non esistono mentre il riferimento raster risponde comunque, e la
differenza sembra un difetto di stile invece che assenza di dati — errore in
cui si cade misurando tile fuori copertura.

Ci sono anche gli interruttori **ombreggiatura** e **pendenza**: non sono
layer dello stile, quindi gli interruttori dei layer non li toccano, e senza
questi due spegnendo tutto il resto restava una mappa grigia senza che nulla
dicesse cosa fosse.

Nella preview c'e' un interruttore **griglia XYZ** (tasto `g`, oppure
`?grid=on`; `?grid=14` blocca il livello) che disegna i confini delle tile e
la sigla `z/x/y` su **entrambi** i pannelli. Serve a nominare una differenza
invece di descriverla — `16/34639/23768` invece di "in alto a destra del
crinale" — e a ispezionarla subito con `/inspect/...` o
`tools/find-in-tile.mjs`. Rende anche visibili i confini di tile, che sono il
posto dove nascono gli artefatti: cuciture nell'ombreggiatura, etichette
troncate, poligoni di uso suolo tagliati.

### Il riferimento raster arriva a z16

**Oltre z16 si estendono i parametri dell'ultimo livello derivato da TGen.**
Non c'e' niente da imitare piu' su, quindi un layer visibile a z16 non riceve
`maxzoom` e resta visibile a z17-z19; le espressioni mantengono l'ultimo
valore e l'ombreggiatura ricade sull'ultima fascia (`fasce.at(-1)`).
`tools/oltre-z16.mjs` verifica che salendo non sparisca nulla e che l'ombra
resti composta: il rischio li' non e' un colore diverso, e' un `maxzoom` di
troppo che spegne un layer dove nessuno se ne accorge.


`https://api.webmapp.it/tiles` risponde **404 da z17 in su**. Un client che
zooma oltre mostra la tile z16 ingrandita, quindi in quel pannello i toponimi
sembrano piu' grandi e le icone enormi: e' sfocatura, non stile. Inseguirla
peggiora una resa vettoriale che a z18 e' gia' corretta e nitida.
`tile-diff.mjs` rifiuta gli zoom oltre 16; la validazione per livello si ferma
li'.

### Si confronta lo STILE, non il contenuto

**Le tiles PNG di riferimento sono ferme.** Il rendering dell'Italia ha
richiesto circa dieci giorni e l'aggiornamento continuo da OSM e' spento:
strade, sentieri, edifici e toponimi che nel frattempo sono cambiati in
OpenStreetMap ci sono da una parte e non dall'altra. **Quel divario e'
atteso e non va inseguito.**

Si confronta come sono disegnate le cose che ci sono in entrambi: colore,
larghezza, dimensione dei simboli, soglie di zoom, spessore delle etichette.
Non quante ce ne sono.

Di conseguenza le medie globali (Δ luminosita', Δ contrasto) servono solo come
indicatore grossolano: risentono del contenuto e possono portare fuori strada.
Le correzioni che hanno funzionato sono venute tutte dal confronto per
elemento — il colore dell'autostrada campionato sui PNG, il tono del confine,
il `multiply` delle curve, la dimensione del singolo triangolo di cima. Un
errore tipico e' eguagliare un CONTEGGIO di pixel: se il riferimento ha dodici
cime e noi otto, pareggiare i pixel totali significa ingrandire i simboli
oltre misura.

**Quando il CartoCSS e il PNG divergono, vince il PNG.** Le tile di
riferimento sono piu' vecchie dei `.mss` che abbiamo scaricato, e lo stile e'
cambiato nel frattempo. Esempio: `road-colors-generated.mss` dichiara
`@secondary-fill: #ffffff`, ma nel riferimento le provinciali sono gialle —
`rgb(231,200,125)` a z11, cioe' `#e7c87d` esatto. L'obiettivo dichiarato e' la
verosimiglianza al PNG, quindi si segue il PNG e si annota perche'.

Le due metriche globali: **delta luminosita' media** e **delta deviazione
standard**, che misura il contrasto — cioe' in pratica quanto si legge il
rilievo. Vanno guardate insieme, e sempre insieme a un confronto visivo.

Cancella sempre gli screenshot prima di un giro: uno screenshot residuo di una
versione precedente dello strumento e' stato letto come misura vera piu' di
una volta. E ritaglia i pannelli dai loro `boundingBox` — includere la barra
dei controlli sposta le misure anche del riferimento.

### Pipeline dei dati

Tutti gli script girano dentro container (nessun tool geospaziale installato
sull'host) e scrivono in `data/`, che e' gitignored.

```bash
# planetiler -> osm.pmtiles (schema OpenMapTiles, z0-14)
pipeline/build-osm.sh <in.pbf> <out-dir> [maxzoom]

# gli altri girano nell'immagine GDAL, con data/ e pipeline/ montati:
docker run --rm -v "$PWD/data":/work -v "$PWD/pipeline":/pipeline \
  --entrypoint bash ghcr.io/osgeo/gdal:ubuntu-small-latest \
  /pipeline/build-terrain.sh /work/dem 8 16 4
```

### Rigenerare su un'area nuova

La sequenza completa, nell'ordine (misurata su 0,9° x 0,88°, ~7.000 km²):

```bash
# 1. ritaglio del PBF: gli estratti Geofabrik seguono i confini amministrativi,
#    quindi un bbox a cavallo di due regioni ne vuole due          (~1 min)
bash pipeline/merge-extracts.sh <W> <S> <E> <N> data/sources/area.osm.pbf \
  data/sources/centro.osm.pbf data/sources/nord-est.osm.pbf

# 2. OpenStreetMap                                                  (~2 min)
bash pipeline/build-osm.sh data/sources/area.osm.pbf data/archives/<versione> 14

# 3. sentieri, strade dei livelli bassi, POI                        (~3 min)
bash pipeline/build-hiking-full.sh data/sources/area.osm.pbf <W> <S> <E> <N> \
  data/archives/<versione>/hiking.pmtiles 10 14
bash pipeline/build-roads-lowzoom.sh data/sources/area.osm.pbf <W> <S> <E> <N> \
  data/archives/<versione>/roadslz.pmtiles 8 11
bash pipeline/build-osmpoi.sh data/sources/area.osm.pbf <W> <S> <E> <N> \
  data/archives/<versione>/osmpoi.pmtiles 11 14

# 4. DEM e terrain                                                 (~13 min)
#    (gdalbuildvrt -r cubicspline, gdalwarp sul bbox, build-terrain-zoom)

# 5. curve di livello, tipizzate come quelle di TGen               (~13 min)
bash pipeline/build-contours-tipizzate.sh data/dem3857.tif \
  data/archives/dem/contours.pmtiles
```

**Quaranta minuti in tutto** per quell'area, con i pezzi pesanti in parallelo.
DEM e curve sono i colli di bottiglia e scalano con la SUPERFICIE; planetiler
no. Per l'Italia (43x la terraferma) l'ordine di grandezza e' 12-15 ore e
**130 GB di solo DEM se lo si genera fino a z16** — ma fino a z14 bastano
~8 GB e meno di un'ora, e l'ombreggiatura ai livelli alti regge benissimo
l'overzoom da quando le quote si interpolano correttamente.

**Attenzione a quale file sostituisci.** Il server apre
`data/archives/dem/contours.pmtiles`, NON `contours-tgen.pmtiles`: sostituendo
il secondo le tile rispondono `HTTP 204` e le curve spariscono dalla mappa
senza alcun errore.

**Cosa non serve rigenerare**: `clc`, `toponimi` e `rifugi` sono importati da
TGen con un bbox molto ampio (l'Italia o quasi) e coprono gia'. L'uso suolo
REGIONALE invece segue il bbox dell'importazione: per un'area nuova va
riletto da TGen, in sola lettura (`pipeline/sql/usotoscana-bbox*.sql`, cambia
solo l'envelope in EPSG:3857).

- `build-dem-mosaic.sh W S E N out` — mosaico multi-DEM -> `dem3857.tif`
- `build-terrain.sh out [zmin] [zmax] [passo]` — tile Terrarium
- `build-terrain-zoom.sh out zmin zmax [W S E N]` — come sopra, ma il passo lo
  ricava dal livello massimo (`156543.03 / 2^z`), cosi' il tiling e' 1:1

**Il ricampionamento del DEM va fatto con `cubicspline`, mai `bilinear`, e
serve `-r` anche su `gdalbuildvrt`.** L'ombreggiatura non dipende dalla quota
ma dalla sua DERIVATA, quindi amplifica gradini invisibili nel dato: si
vedono come un reticolo fitto da z13 in su.

La causa era a monte di tutto, in `build-dem-mosaic.sh`. Con
`-resolution highest` il VRT assume la risoluzione del riquadro piu' fine
(`pradarena_5m`, 5 m) e ricampiona il DEM di base — **Copernicus a 30 m** —
col default `nearest`, duplicando ogni quota per 3-5 pixel (`1443.099` tre
volte di fila, `1440.462` quattro). Il `-r` del `gdalwarp` successivo arriva
troppo tardi: i gradini sono gia' dentro il VRT. Ombreggiare `dem3857.tif`
direttamente con `gdaldem hillshade` mostra il reticolo gia' nel dato — e' la
verifica da fare per prima, prima di sospettare il rendering.
Misure con `shade-grid-test.mjs`: a z17 da 183 a 4,9; a z16 da 7,0 a 3,2.

**Limite del dato, non della pipeline:** il DEM di base e' Copernicus GLO-30,
a **30 m**. A z16 (2,39 m/px) e z17 (1,19 m/px) lo si ingrandisce di oltre
dieci volte, e nessuna interpolazione crea un dettaglio mai misurato: l'ombra
resta morbida anche dopo il fix. Per ombre nitide a quei livelli serve un DEM
piu' fine (in `data/dem-hr/` c'e' solo `pradarena_5m.tif`, che copre una
zona). E' una decisione da prendere a monte della pipeline nazionale, perche'
pesa su banda e spazio.
- `build-osm.sh in.pbf out-dir [zmax]` — planetiler, schema OpenMapTiles
- `build-osmpoi.sh pbf W S E N out [zmin] [zmax]` — cime, valichi, sorgenti
  (`kind` si compone con jq: OGRSQL non ha COALESCE ne' CASE)
- `build-contours-tipizzate.sh dem.tif out.pmtiles` — curve con `quota` e
  `type` (`cp` direttrici ogni 100 m, `cs` secondarie), la convenzione su cui
  lo stile sceglie larghezze ed etichette
- `build-contours.sh`, `build-landcover-vector.sh`, `build-hiking.sh`
- `build-sprite.mjs` (sharp), `get-glyphs.sh` (glifi pre-generati)

## Architettura

### Il server (`src/`)

`server.js` espone i tile sotto `/t/:version/:set/:archive/:z/:x/:y.:ext`, piu'
`/manifest`, `/style.json?set=`, `/glyphs`, `/sprite`, `/dem/*`, `/preview/`.
Gli archivi sono file **PMTiles** letti con range-request posizionali
(`archive/store.js`); non c'e' un database di tile.

**Il controllo di accesso ai layer sta in un solo punto**: `tiles/filter.js`.
Ogni shard decide quali gruppi di layer una app puo' ricevere; il server
consegna solo quelli, e il frontend spegne o accende dentro quel
sottoinsieme. La ragione e' commerciale, non tecnica: esporre tutti i layer e
lasciare al client la scelta regalerebbe dati che non vanno regalati. Il
filtro opera **sui byte del protobuf** (`Tile.layers` e' il campo 3,
`Layer.name` il campo 1): copia o scarta il sotto-messaggio integralmente,
quindi e' lossless e non decodifica geometrie (0,0104 ms/tile).

I gruppi disponibili sono in `manifest/layers.v1.json`; un `set` e' un
insieme di gruppi identificato dallo SHA-256 dei loro id ordinati (12 hex).

**Lo sprite ha l'URL versionato** (`/sprite/v<mtime>/webmapp`): cambia ogni
volta che si aggiunge o si ricolora un'icona, e un browser che ne tiene una
copia vecchia non trova i simboli nuovi — li salta in silenzio, senza errori.
Gli scudi stradali sono rimasti invisibili al committente per questo, mentre
in un browser pulito comparivano. Attenzione: **modificare `Cache-Control`
non basta**, una risposta gia' memorizzata con `max-age` lungo resta valida e
il browser non la rivalida; serve un URL diverso. La versione sta nel
percorso e non in un parametro perche' lo Style Spec accoda `.json` e `.png`
all'URL dichiarato, e un `?v=1` diventerebbe `?v=1.json`.

**Cache-Control non e' un dettaglio qui**: i tile sono `immutable` per un anno
perche' il path contiene la versione, ma `/style.json`, `/manifest` e
`/version` devono restare `no-cache`. Uno stile cachato che punta a una
versione ritirata fa chiedere tile inesistenti: mappa vuota, zero errori.

### La preview (`src/preview/`)

Due pannelli in **OpenLayers** che condividono lo stesso oggetto `ol.View`,
cosi' le scale coincidono per costruzione: a sinistra il vettoriale locale, a
destra `ol.source.XYZ` su TGen. Parametri utili: `?area=`, `zoom`, `set`,
`only`, `off`, `single=left|right`. Il debug passa da `window.__wm`.

Gli screenshot vanno presi con **Playwright headless**, non con un tab in
background: senza `requestAnimationFrame` la mappa non renderizza e lo
screenshot esce vuoto.

### Lo stile e' generato, non scritto

**`style/webmapp.json` e' un file prodotto: non modificarlo a mano.**

```bash
npm run cartocss   # data/tgen-style/*.mss -> data/tgen-cartocss.json
npm run profile    # + style/tgen-mapping.json -> style/zoom-profile.json
npm run style      # + style/base-layers.json -> style/webmapp.json
npm run validate
```

- **`style/zoom-profile.json`** e' la fonte di verita': per ogni livello di
  zoom dichiara quali layer si vedono, in che ordine, e quale set di parametri
  usa (ombra, palette delle superfici, modello stradale). Il riferimento
  cambia per fascia quasi ogni parametro, quindi tenerli sparsi nei layer
  significa correggere un livello e romperne un altro.
- **`style/base-layers.json`** tiene la struttura dei layer (source, filtri,
  paint) senza soglie di zoom: quelle vengono dal profilo.
- **`style/tgen-mapping.json`** e' la sola parte scritta a mano: la
  corrispondenza fra i nostri layer e i selettori del riferimento. Mapnik
  interroga PostGIS e costruisce campi propri
  (`feature = 'highway_motorway'`, `code_12`), noi leggiamo MVT con schema
  OpenMapTiles (`class = 'motorway'`).

`pipeline/parse-cartocss.mjs` legge i `.mss` **elencati da `project.mml`, nel
suo ordine** — non la cartella: esistono varianti alternative dello stesso
file (`road-colors-generated.mss` da' `@motorway-low-zoom #ffe37e`,
`road-colors-no-hiking.mss` da' un grigio) e prendere la variante sbagliata
porta fuori strada. Espande le variabili e le funzioni di colore
(lighten/darken/saturate), appiattisce il nesting e valuta le condizioni sullo
zoom.

**La visibilita' effettiva di un layer del riferimento e' l'intersezione fra
le soglie del `.mml` e le condizioni dei `.mss`**, e leggere solo i secondi
inganna: `contourlines_lr` ha `[zoom>=10][zoom<=12]` nel `.mss` ma
`minzoom: 12, maxzoom: 12` nel `.mml`, quindi a z10 e z11 il riferimento non
disegna curve di livello. Allo stesso modo `track` e `path` compaiono da z10,
e la rete fitta che il riferimento mostra a z10 e' fatta di piste e sentieri,
non di strade secondarie.

I colori restano l'eccezione da misurare, non da copiare: il verde del
riferimento a z10-z12 ha saturazione (g-b) 41 e nessun colore verde di
`webmapp.mss` supera 31, e il `multiply` dell'ombra scala i canali in
proporzione senza poter saturare. Le tiles in produzione sono state
renderizzate con una versione dello stile diversa da quella oggi sul server.
Dove `.mss` e PNG divergono **vince il PNG**, che e' l'obiettivo dichiarato:
`tools/ref-palette.mjs` campiona il colore dominante del riferimento e del
locale per ogni livello.

Mapnik compone l'ombreggiatura in `multiply`, cosa che OpenLayers non
riproduce. La compensazione e' **additiva** — `c' = c + (255-c)*f` — perche' la
compensazione moltiplicativa satura a bianco i toni gia' chiari e cancella le
distinzioni fra le classi agricole.

## Trappole di ol-mapbox-style

Verificate sul campo, ognuna e' costata un ciclo di debug:

- **La versione conta.** `ol-mapbox-style` **11.0.0** con `ol` **>= 7.3.0** e'
  l'unica combinazione in cui il `paint` del layer `hillshade` viene
  applicato: 10.4.0 lo ignora, 13.4.3 non disegna il layer. `map-core` pinna
  `ol` 7.1.0, quindi serve un bump minor.
- **`minzoom` e' una soglia esclusa**: un layer con `minzoom: 12` e'
  invisibile *a* zoom 12. Tutte le soglie lette dai `.mss` vanno abbassate
  di 1. Sono stati 28 layer silenziosamente assenti.
- **Un layer `symbol` con `icon-image` non rende il testo**: l'icona vince.
  Icona ed etichetta vanno su due layer distinti (`*-icon` / `*-label`).
- **Layer di stile consecutivi con la stessa source finiscono in un solo
  layer OpenLayers**, quindi `?only=` non riesce a separarli.
- **Lo Style Spec ammette una sola sottoespressione `interpolate`/`step` su
  zoom per espressione**: `["case", c, ["interpolate"...], ["interpolate"...]]`
  fa rifiutare lo stile intero. Invertire l'annidamento.
- **Lo sfasamento di un livello vale anche DENTRO le espressioni.** Una soglia
  scritta `["step", ["zoom"], a, 12, b]` fa scattare `b` a vista z13, non z12.
  Verificato contando i pixel di un colore noto ai tre livelli. **Non
  compensarlo a mano nei sorgenti**: ci ha portato ad avere alcune soglie
  nominali e altre gia' scalate, indistinguibili rileggendo il file.
  `build-style.mjs` ha `scalaZoom()`, che toglie un livello a tutte le soglie
  di `step`/`interpolate` in `paint` e `layout` — nei sorgenti si scrivono
  SEMPRE le soglie nominali del CartoCSS.

## Un layer OpenMapTiles va filtrato come lo filtra il CartoCSS

L'errore piu' frequente e piu' costoso: prendere un `source-layer` di
OpenMapTiles e disegnarlo intero, mentre TGen ne seleziona una parte. Il
risultato non e' un colore leggermente diverso, e' roba in piu' sulla mappa.
Casi trovati, tutti segnalati dall'utente guardando la preview:

- **`landuse-park` senza filtro** riempiva OGNI area protetta con `#d5f7d7` al
  20%, Parco Nazionale compreso: un velo verde chiaro su mezza mappa. In
  `landcover.mss` quel colore vale solo per `[feature = 'leisure_park']`, i
  parchi urbani. Filtro corretto: `class == 'park'`.
- **`park-band-a/b`** disegnavano le bande anche sui SIC/ZPS. Il layer di TGen
  e' alimentato da `WHERE (boundary = 'national_park' OR leisure =
  'nature_reserve')`: solo quelle due classi.
- **`park-label`** etichettava i siti `conservation` (19 su 29 nella tile z10),
  che TGen non nomina mai.

Prima di dare un colore a un layer, cercare nel `.mss` il selettore che lo
governa e replicarne il filtro. Il colore giusto sull'insieme sbagliato di
geometrie resta un difetto.

## Ogni livello di zoom ha il suo set di ombreggiatura

`shadeSets` tiene `hs-z8` … `hs-z16`, uno per livello, non fasce condivise: le
opacita' che ne risultano non seguono una curva liscia (0,21 · 0,39 · 0,36 ·
0,26 · 0,32 · 0,28 · 0,34) e nessuna fascia potrebbe rappresentarle. Con le
fasce, tarare z12 spostava z11.

Tararle sulla **luminosita' media**, non sul tono dominante di
`element-diff`: a z11 quel tono e' instabile e salta da -44 a +6 per 0,10 di
opacita', perche' cambia picco nell'istogramma.

## L'ombreggiatura: come e' fatta e cosa e' costato farla

Il DEM arriva come PNG **Terrarium** (`R*256 + G + B/256`), ma la sorgente e'
una `DataTile` che **decodifica le quote in JavaScript**, una volta per tile,
e le espone in virgola mobile. Non e' un vezzo: la GPU interpola le texture, e
il canale blu avvolge a ogni METRO di dislivello — a ogni giro l'interpolazione
produce un valore privo di senso, e su un versante regolare quei giri cadono a
distanza regolare, disegnando strisce parallele alle curve di livello. Con le
quote decodificate l'interpolazione e' invece **necessaria** (`interpolate:
true`), perche' oltre il maxzoom del DEM un texel copre piu' pixel e i suoi
bordi diventano un reticolo: a z17 si passa da 49,8% di righe anomale a 1,2%.
L'opzione `interpolate` su `ol.source.XYZ` non ha alcun effetto con
`WebGLTile` — verificato misurando, acceso o spento gli stessi numeri.

Il gradiente usa la **formula di Horn su 3x3**, la stessa di `gdaldem`:

    dz/dx = ((c + 2f + i) - (a + 2d + g)) / (8 * passo)

Si combinano DIFFERENZE di quota, mai quote: sono esatte anche col wrap.
Il **passo e' quello del DEM** (`passoDem`, variabile di stile), non della
vista: in overzoom un texel vale piu' pixel, e dividendo per la risoluzione
della vista il gradiente cresce con l'ingrandimento fino a saturare in bande
nere.

**I segni vanno insieme.** `dz/dx` e' colonna sinistra meno destra, `dz/dy` e'
riga sopra meno sotto. Invertirne uno solo SPECCHIA l'esposizione e la
correlazione con gdaldem crolla senza diventare negativa — sembra un problema
di qualita' quando e' un segno. Invertirli entrambi ruota di 180 gradi: le
vette si leggono come valli, senza errori e senza scarti nelle medie.

La **pendenza** (il secondo layer, in `overlay`) si calcola su una finestra
piu' larga (`P = 3`): e' il modulo del gradiente, non ha la direzionalita'
della luce a mascherare le irregolarita', e con la stessa finestra della luce
disegnava strisce diagonali mentre la luce da sola era gia' liscia.

Sul canvas c'e' un `filter: blur(0.5px)`, l'equivalente del
`raster-scaling: lanczos` del riferimento: leviga il RISULTATO invece di
inseguire il gradiente. Come per `mix-blend-mode`, serve `!important`.

**Gli strumenti che tengono in piedi tutto questo:**

```bash
node tools/ombra-vs-gdal.mjs 16   # correlazione con gdaldem: forma E segno
node tools/verso-ombra.mjs        # il lato verso il sole dev'essere piu' chiaro
node tools/ombra-scala.mjs        # un punto fisso, tutti gli zoom
node tools/avvio-check.mjs        # l'avvio non deve "lampeggiare"
```

`ombra-vs-gdal.mjs` e' il metro oggettivo — gdaldem applica Horn sul dato in
float, senza texture: il suo hillshade e' la risposta giusta per definizione.
**Azzera `vert`, `gamma` e `slope` prima di misurare**, altrimenti confronta
una relazione non lineare e il valore crolla senza che ci sia un difetto
(0,557 contro 0,998). Una correlazione negativa significa ombra invertita, e
nessuna delle metriche globali se ne accorge.

`shade-grid-test.mjs` e `ombra-scala.mjs` contano righe e colonne anomale.
Attenzione al loro limite: **oltre una certa scala non distinguono le strisce
dalle pieghe del dato**. A z15 segnano 7% dove a occhio non c'e' nulla — sono
le celle del DEM a 30 m, larghe sei pixel. Sopra il 10% e' un difetto vero;
fra 5 e 10 va guardata l'immagine.

**Il limite resta il dato.** Il DEM e' Copernicus a 30 m: a z16 lo si ingrandisce
dodici volte, e l'ombra si ammorbidisce da sola. E' il motivo per cui lo stesso
identico calcolo e' fedele a z13 e faticoso a z16. TGen aggira il problema con
**tre DEM** (100 m, 25 m, 10 m per fascia) e hillshade pre-calcolati; noi
calcoliamo sulla GPU del client, quindi ci basterebbe **un solo DEM piu' fine**
(TINITALY copre l'Italia a 10 m) e i livelli bassi lo userebbero rimpicciolito,
che e' il verso che non crea artefatti.

## Cose che sembrano configurate e non lo sono

Tre volte in un giorno, e ogni volta invisibile alle misure. Il tratto comune:
nessun errore, lo stato si dichiara corretto, e le tarature successive
compensano il difetto invece di rivelarlo.

- **Una funzione usata e mai definita.** `grigioPendenza` era chiamata ma non
  esisteva: `applyStyle` catturava l'eccezione nel suo `try/catch` e la
  scriveva nel riquadro `#err`, che negli screenshot di misura viene nascosto
  via CSS. L'ombreggiatura non veniva disegnata per giorni. **`tile-diff.mjs`
  ora LEGGE quel riquadro** invece di limitarsi a nasconderlo.
- **`mix-blend-mode` mai applicato.** Il canvas aveva la classe giusta, la
  regola era nel CSSOM, e il computed restava `normal`: `ol.css` — caricato
  due volte, la seconda con `document.write` dopo il nostro `<style>` — porta
  un selettore piu' specifico. Serve `!important`. L'ombra si e' composta in
  modo normale invece che in `multiply`, e le opacita' erano circa il doppio
  del necessario. **`tile-diff.mjs` ora confronta il blend calcolato con
  quello atteso.**
- **Un layer rimosso e mai reinserito.** `posizionaOmbra` toglieva il layer
  della pendenza e poi usciva se quello della luce era gia' a posto: alla
  prima chiamata funzionava, dalla seconda in poi (evento `add` piu' due
  `setTimeout`) la pendenza spariva. Attenzione a riscriverla: reinserire
  sempre scatena `add`, che richiama la funzione — serve un flag di
  rientranza.

- **Un layer WebGL riposizionato togliendolo dalla mappa** perde il contesto e
  per qualche frame non disegna: all'avvio si vedeva un lampo, due volte
  (`posizionaOmbra` era richiamata dopo il caricamento differito dei layer).
  L'ordine si governa con `zIndex`, senza mai rimuovere.
- **`filter: blur()` sullo stesso canvas**: stessa storia del blend, stesso
  `ol.css`, stesso `!important`. Terza volta nello stesso punto.

Regola pratica: quando un parametro non ha l'effetto atteso, **verificare che
sia arrivato a destinazione** prima di cambiarne il valore. Contare i pixel di
un colore noto, leggere il `getComputedStyle`, elencare i layer della mappa.

## Trappole GDAL / PostGIS

- **`gdalbuildvrt` scarta in silenzio** (solo warning) i file con proiezione
  diversa dal primo: porta tutto in EPSG:4326, mosaica, e riproietta solo il
  risultato.
- **Le quote Terrarium non si interpolano**: i canali RGB codificano un
  numero, non un colore, quindi il tiling usa `--resampling=near`. Ma tilare
  con `near` un DEM grosso fa nascere gli zoom alti dall'overzoom di pochi
  pixel, e il rilievo calcolato su quei gradini mostra un pattern a blocchi
  con bordi sui confini di tile. Interpola il DEM **in float, prima** della
  codifica (`gdalwarp -tr 4 4 -r bilinear`).
- **Codifica il DEM a blocchi di righe** (`encode-terrarium.py`): un DEM
  regionale a passo fine supera i 500 milioni di pixel e caricarlo intero in
  float fa uccidere il processo dal kernel.
- **`gdal2tiles` sovrascrive il canale alpha** — lo usa come maschera dei
  pixel validi — quindi un'ombra codificata in alpha esce nera e opaca. Non
  aggirabile: e' la ragione per cui l'hillshade e' calcolato e non precotto.
- **GDAL Python: non concatenare** `gdal.Open(...).GetRasterBand(1)`; il
  dataset viene garbage-collected e la banda muore con lui.
- **`COPY ... TO STDOUT` in formato testo usa il backslash come escape**, e i
  nomi con virgolette (`Rifugio "La Faggeta"`) arrivano con JSON rotto. Per
  poche righe usa `psql -Atc "SELECT ..."`; per volumi grandi
  `COPY ... WITH (FORMAT csv)`, che quota invece di sfuggire.
- **`ogr2ogr -sql` senza la colonna geometrica** produce geometrie `null`, e
  `-overwrite` **non tronca** un GeoJSONSeq (le righe raddoppiano): `rm -f`
  prima. `COALESCE` non esiste nel dialetto OGR SQL.

## Le fonti dei dati, e perche' sono due per fascia di zoom

Rilevante per la pipeline nazionale, e non deducibile dal codice: in
`project.mml` di TGen l'uso suolo cambia fonte con lo zoom. **Corine
(`clc12_version_18_5`) copre z7-13**; **da z14 subentrano 12 tabelle
regionali** piu' `land_cover_hr`, che pero' copre solo il Sud. Le tabelle
regionali hanno nomi diversi da quelli del `.mml` (`usotoscana` ->
`usotoscana2013`, `usoemilia` -> `uso_emilia_2008`) e colonne diverse
(`lv3_13`, `cod_tot`, `ur_cd`, `cod_uso`, ...), tutte normalizzate in `coduso`
dalle CASE del `.mml`: le query di normalizzazione sono in `pipeline/sql/`.

Altre due cose da sapere: **i sentieri numerati richiedono le relazioni
`route=hiking`**, che OpenMapTiles non estrae — vanno prese a parte con il
driver OSM di GDAL. E `names_along_lines` e `rifugi_bivacchi` esistono su TGen
ma **non sono in produzione** (nessun riferimento nei `.mml`/`.mss`): sono
asset pronti e mai attivati, quindi il locale puo' mostrare cose che il
riferimento non ha.

**Le curve di livello servite sono `contours-tgen.pmtiles`**, con i campi
`quota` e `type` (`cp*` direttrice, `cs*` secondaria: `cp50/cs50` a z13,
`cp25/cs25` da z14). Accanto c'e' `contours-copernicus.pmtiles`, che ha invece
`ID`/`ele` e nessun `type`: leggere quello per sbaglio porta a concludere che
le direttrici non esistano e a riscrivere le larghezze con un modulo su `ele`,
facendo sparire le direttrici e con loro le etichette delle quote. L'archivio
arriva a **z15**: la sorgente deve dichiarare `maxzoom: 15`, con 14 le curve a
z15 vengono da tile sovraingrandite e risultano meno fitte del riferimento.

**Una sola palette per le superfici.** I colori stanno in
`zoom-profile.json > surfaceSets`, e `landcover-osm` li legge da li'. Quando
aveva una sua palette copiata a mano si e' disallineata: le zone umide OSM
usavano `@zumide` (l'azzurrino dei codici CLC 411-423) mentre in
`landcover.mss` `wetland_marsh` va su `@grass`, `wetland_swamp` su `@forest`,
`wetland_bog` su `@heath` — tutti verdi.

**La palette Corine sono i valori di `webmapp.mss` con rosso -5 e blu -14, e
nient'altro.** Le correzioni empiriche precedenti (saturazione x0,81, blu -15,
rotazione di tinta) erano state tarate su un solo tono — il verde del bosco a
z10 — mentre l'ombreggiatura non veniva disegnata affatto: applicate a tutta
la palette rendevano acidi i toni chiari (il pascolo usciva `#e4f9cb` invece
di `#ecf3e0`). Ripartendo dai valori dichiarati il canale verde e' risultato
gia' corretto a -1/-2. **Non tarare una palette intera su un tono solo.**

Per l'estratto OSM nazionale usa `europe-latest.osm.pbf` +
`osmium extract -b 4.39,35.37,22.11,48.06`: `italy-latest` e' tagliato al
confine e produce tile incomplete sull'arco alpino.

## Documentazione della feature

`docs/features/server-tiles-osm/` contiene `overview.md` (cosa cambia,
requisiti, rischi), `plan.md` (i task) e `notes.md` (deviazioni e decisioni prese
strada facendo). Le deviazioni dal piano vanno in `notes.md`.
