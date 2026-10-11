# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Lingua

Rispondi sempre in italiano. La documentazione, i commenti nel codice e i
messaggi di log di questo repo sono in italiano: mantieni quella lingua.

## Cos'e' wm-tiles

Server di tiles derivate da OpenStreetMap che sostituisce TGen, la cui
produzione e' oggi fatta a mano. wm-tiles produce **due uscite dalla stessa
sorgente**: le tile vettoriali e i PNG ricavati da quelle con lo stesso stile.

1. **Prima i PNG**: aggiornano quelli gia' prodotti da TGen e serviti da
   `https://api.webmapp.it/tiles/{z}/{x}/{y}.png`. Il frontend resta com'e'.
2. **Poi i vettoriali**, quando il frontend (webapp e app mobile, tramite
   `map-core`) sara' aggiornato per leggerli.

Il vettoriale non e' un'alternativa al PNG ma la sua sorgente: un solo stile,
nessuna seconda resa da tenere allineata.

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

1. **TGen e' sola lettura.** La regola, posta dall'utente per la fase di
   prototipo, e' stata confermata il 10 ottobre 2026: wm-tiles non girera' su
   TGen (sistema fuori supporto) ma su una macchina separata, e da TGen si
   copiano una volta i dati che servono (vedi `docs/stato.md`). I dati
   cartografici migliori (uso suolo
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
   "Trappole di ol-mapbox-style". Il vincolo riguarda il frontend, perche' le
   app disegnano le mappe con OpenLayers (chiarito dall'utente l'11 ottobre
   2026): il motore che produce i PNG lato server e' una scelta tecnica, oggi
   maplibre-native (vedi "I PNG li disegna maplibre-native").
4. Nessun commit senza conferma esplicita. Nessun ticket Orchestrator, nessuna
   stima.

## Come lavorare qui

**Sul Mac solo le prove dei casi d'uso, tutta l'Italia sul server nuovo**
(regola dell'utente, 10 ottobre 2026). Qui si lavora sulle celle di prova
(Pisa, Caltanissetta): copie da TGen limitate alla cella, generazione,
confronto. Cio' che riguarda l'Italia intera — la copia completa da TGen, la
generazione nazionale — si lancia sul server dedicato, mai sul Mac: richiede
ore e decine di GB. Il server e' `ssh wm-tiles` (Hetzner Cloud): repo in
`/srv/wm-tiles`, dati sul Volume in `/data/wm-tiles`, preparato da
`infra/prepara-server.sh`. Il repo su GitHub e' pubblico: chiavi e
credenziali non entrano mai nei file.

**Emulare TGen e' un algoritmo, non una serie di domande** (regola
dell'utente, 10 ottobre 2026). TGen e i suoi PNG sono la specifica: cio' che
dichiarano si legge e si replica, senza chiedere all'utente e senza report da
fargli leggere. Le fonti sono quattro e si leggono, non si esplorano:
`project.mml` (quali dati, a quali livelli), i `.mss` e i PNG (lo stile),
l'inventario `general.grid_1x1` (quali celle e quali livelli generare). Una
differenza fra locale e riferimento si classifica con la regola fondante:
stile, e si corregge; contenuto o dato mancante a TGen, e si ignora. Il
confronto automatico con TGen e' un controllo interno, come un test. Il
codice si ferma, e rumorosamente, solo quando incontra qualcosa che non sa
mappare (un layer del `.mml` senza corrispondenza): e' l'unico caso in cui
serve una persona.

**In `/loop` dinamico non schedulare attese.** La cadenza lunga di quel comando
serve a chi aspetta un evento esterno — una build, un deploy, una coda remota.
Qui gira tutto in locale, il collo di bottiglia sono gli screenshot Playwright,
e si puo' incatenare un giro dopo l'altro: una pausa lascia la macchina ferma
mentre c'e' lavoro pronto. Fermarsi solo per mostrare un risultato o per una
decisione che spetta all'utente.

**Le modifiche automatiche ai file JS vanno mirate.** Due volte in un giorno una
sostituzione con espressione regolare ha colpito il punto sbagliato: una ha
inserito una virgola dentro un getter rompendo l'intero script della preview,
l'altra e' fallita in silenzio lasciando una funzione mai definita. Se
un'ancora non si trova, il comando deve fallire rumorosamente.

**Lo stato del lavoro e le decisioni aperte stanno in `docs/stato.md`**, non
nella memoria di sessione: cosi' li vede il team e sopravvivono alla sessione.

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
node tools/colore-per-classe.mjs mediana osm transportation "p.class === 'primary'" 12/2207/1587  # colore di TGen per classe
node tools/tgen-copertura.mjs            # layer di TGen senza alcun layer locale (esce 1 se ce ne sono)
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


`https://api.webmapp.it/tiles` risponde **404 da z17 in su** quasi ovunque (in
alcune celle toscane esistono z18 del 2018, residui di vecchi lavori). Un client che
zooma oltre mostra la tile z16 ingrandita, quindi in quel pannello i toponimi
sembrano piu' grandi e le icone enormi: e' sfocatura, non stile. Inseguirla
peggiora una resa vettoriale che a z18 e' gia' corretta e nitida.
`tile-diff.mjs` rifiuta gli zoom oltre 16; la validazione per livello si ferma
li'.

### Si confronta lo STILE, non il contenuto

**E' la regola fondante del progetto.** Si copia lo stile comandato dai PNG e
da TGen, a qualunque anno risalga — anche se fosse del 2012 — e non il
contenuto, che nel frattempo puo' essere cambiato: un'autostrada con un
percorso diverso, un sentiero nuovo. L'eta' di un PNG non e' mai un motivo per
allontanarsene nello stile.

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

**I buchi di TGen sono contenuto, non stile.** TGen genera a mano, una cella e
un livello per volta: z0–z12 sono del 2018, z13–z16 di settembre 2025 in
Italia; da z14 il rilievo c'e' solo dove un lavoro l'ha costruito e l'uso
suolo solo dove esiste la tabella regionale (Valle d'Aosta e Abruzzo restano
bianchi). Sono dati mancanti, non scelte di stile: non si imitano. Il limite di
Corine a z13 invece e' scritto nello stile e si imita. Un caso che inganna:
sull'Etna, a z13, TGen non disegna il grande poligono Corine 333 (che pure e'
nella sua tabella e nella nostra copia) e lascia vedere l'uso suolo OSM che
sta sotto, colate in bianco e boschi; misurata per classe, la 333 risultava
"bianca" invece che `@pascolo`. Un poligono che Mapnik non disegna e'
contenuto: la classe si tara sulle altre tile.

**Quando il CartoCSS e il PNG divergono, vince il PNG** — a ogni livello,
anche dove il PNG e' del 2018. Esempio: `road-colors-generated.mss` dichiara
`@primary-fill: #ffffff`, ma nel PNG a z12 le strade primarie sono arancio
chiaro, `rgb(242,217,162)`: si segue il PNG e si annota perche'.

**I PNG hanno due stili, con il confine fra z12 e z13.** z0–z12 sono stati
resi nel 2018 con uno stile che non esiste piu': li' la specifica sono i PNG,
e si misurano. z13–z16 sono di settembre 2025 e oltre, resi con
`data/tgen-style/project.xml` del 23 febbraio 2025 — l'XML compilato che
Mapnik legge davvero: li' e' la specifica esatta, colore per colore (lo stile
`clc` di quel file da' i valori di `webmapp.mss` senza alcuna correzione). Fra
i due stili cambia molto, e a volte si inverte: l'acqua e' `#acd4ea` fino a
z12 e `#dce7f7` da z13; i confini comunali sono verdi a z12 e lilla da z13,
le bande dei parchi il contrario; i boschi del 2018 erano tre verdi distinti,
oggi quasi uno. Una taratura che attraversa z12/z13 con un solo valore e'
sbagliata da una parte o dall'altra: il colore diventa uno `step` a 13, e le
superfici hanno due set (`corine-2018` per z7–z12, `corine` per z13).

**Prima di misurare un colore della fascia z13–z16, cercalo in
`project.xml`.** `grep` sul nome del layer (`<Style name="clc">`) da' il
valore esatto e le soglie in scale denominator; misurare serve solo dove l'XML
non arriva (2018) o per il rilievo, che e' un raster.

**Campiona per classe e su molte tile, mai su una strada sola.** Una prima
misura aveva concluso "le provinciali sono gialle a z11" e colorato di giallo
tutte le secondarie: quella provinciale nel 2018 era classificata primaria. Su
93 tile delle due celle le secondarie a z11 risultano grigie e sottili, le
primarie gialle `#e7c87d`. Lo strumento giusto rasterizza le NOSTRE geometrie
di una classe come maschera e legge i pixel del PNG sotto di essa.

Le due metriche globali: **delta luminosita' media** e **delta deviazione
standard**, che misura il contrasto — cioe' in pratica quanto si legge il
rilievo. Vanno guardate insieme, e sempre insieme a un confronto visivo.

Cancella sempre gli screenshot prima di un giro: uno screenshot residuo di una
versione precedente dello strumento e' stato letto come misura vera piu' di
una volta. E ritaglia i pannelli dai loro `boundingBox` — includere la barra
dei controlli sposta le misure anche del riferimento.

### PNG e aggiornamento incrementale

```bash
# il ciclo completo: OSM aggiornato -> archivi OSM -> confronto -> PNG cambiati -> consegna
bash pipeline/aggiorna-png.sh <dest|host:percorso> <copie> [--bbox W,S,E,N] <nome>:<W,S,E,N>:<pbf> ...
# i pezzi, uno per uno
bash pipeline/aggiorna-osm.sh in.osm.pbf out.osm.pbf     # modifiche Geofabrik mancanti
bash pipeline/build-celle.sh --solo-osm <versione> <celle...>  # solo archivi OSM
bash pipeline/consegna-png.sh <png> <dest> <copie>       # rsync senza --delete, con copia di sicurezza
WM_CLOUDFRONT_ID=<id> bash pipeline/consegna-png.sh <png> s3://<bucket> <registro>  # su S3 + CloudFront
bash pipeline/ripristina-png-s3.sh <registro>/<ora> s3://<bucket> <id>   # torna alla versione di prima
# quali PNG rifare fra due versioni degli archivi (elenco su stdout)
node pipeline/diff-versioni.mjs data/archives/<vecchia> data/archives/<nuova> > tile.txt
# rendere un elenco, o un'area intera; serve il server acceso
node pipeline/render-png.mjs --tiles tile.txt --out data/png
node pipeline/render-png.mjs --bbox W,S,E,N --zoom 8-16 --out data/png
bash pipeline/render-png-docker.sh --bbox W,S,E,N --zoom 8-16 --out data/png  # Linux: stesse opzioni
# l'ombra dei PNG deve coincidere con quella delle app (esce 1 se divergono)
node tools/ombra-native-vs-ol.mjs
# PNG resi a confronto con TGen, per livello, con foglio di provini
node tools/png-vs-tgen.mjs tile.txt nativo=data/png [ol=data/png-ol] --foglio provini.png
```

Il confronto vale perche' **planetiler e' deterministico**: a parita' di PBF
le tile sono identiche byte per byte, quindi un byte diverso e' un dato
diverso. `render-png.mjs` rende con maplibre-native lo `style.json` del
server, cioe' la versione CORRENTE: prima si pubblica, poi si confronta e si
rende. Il confronto non vede i cambi di
stile, sprite o DEM: in quei casi si rifa' tutto con `--bbox`.

**Una tile cambiata conta solo dove lo stile disegna il suo archivio**
(`src/raster/visibilita.js`, dai livelli di `zoom-profile.json`). Senza quel
limite le strade dei livelli bassi, disegnate fino a z11, propagavano ogni
modifica fino a z16: 70 tile cambiate diventavano 101.119 PNG, ora 183.

**La consegna non cancella mai**, come `generate_map_tiles.sh` di TGen: sul
server di `api.webmapp.it` ci sono anche tile estere e livelli che non
rifacciamo. Prima di sovrascrivere, `consegna-png.sh` salva le versioni
attuali delle tile cambiate; per tornare indietro si riconsegna quella
cartella. Su S3 (`tiles.webmapp.it`, `infra/tiles-png.yaml`) la copia la fa il
versioning del bucket, e il divieto di cancellare sta anche nei permessi di
chi consegna. **`aggiorna-osm.sh` legge da dove ripartire dall'intestazione del
PBF** (`osmosis_replication_*`) e ve la riscrive: non c'e' un registro a parte
da tenere allineato.

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

- `build-celle.sh <versione> <nome>:<W,S,E,N>:<pbf> ...` — genera le celle di
  prova: OSM, dati di TGen (dalle copie), curve, TINITALY fino a z16; pubblica
  una versione nuova e scambia DEM e curve, lasciando da parte i precedenti
- `copia-da-tgen.sh dest` — copia da TGen, in sola lettura, i layer non OSM
  del `project.mml` (query generate da `tgen-layer-sql.py`), l'inventario
  `grid_1x1` e TINITALY; vedi `docs/import-da-tgen.md`
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
  OpenMapTiles (`class = 'motorway'`). Due campi in piu': **`livelli`**
  (`[da, a]`) fissa la visibilita' dove i PNG del 2018 smentiscono il `.mss`
  di oggi, e `npm run profile` la rispetta — senza, rigenerare il profilo
  cancellava in silenzio 28 eccezioni, fra cui piste e sentieri a z10-z12;
  **`ordine`** da' a un layer senza selettore la posizione di un layer del
  `.mml`, che per le etichette e' la priorita'. `node
  pipeline/build-zoom-profile.mjs` senza `--scrivi` deve dire "0
  scostamenti": se ne trova, una soglia sta solo nel profilo.

`pipeline/parse-cartocss.mjs` **non legge i selettori di classe** (`.stations`,
`.text`, `.text-low-zoom`, `.country`, `.state`, `.barriers`): le stazioni, i
nomi di regioni e nazioni, le barriere risultavano "senza regole" e
`tools/tgen-copertura.mjs` non li segnalava. Per quei layer si legge il `.mss`
a mano: `grep -n "^\." data/tgen-style/*.mss` li elenca.

**Le soglie di TGen spesso dipendono dal dato, non dal livello**: `way_pixels`
(superficie in pixel) per parchi, boschi, acque, edifici, ponti, regioni; il
punteggio di popolazione per le citta'. Si scrivono nel dato (`zpx`,
`tippecanoe.minzoom/maxzoom`, `pipeline/parchi-soglia.py`) e, quando decidono
anche la precedenza fra etichette, nell'ordine delle feature nella tile: a
parita' di layer OpenLayers premia la feature che viene prima, e TGen ordina
per punteggio (`--preserve-input-order` in tippecanoe).

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

Mapnik compone l'ombreggiatura in `multiply` fino a z13 e in modo NORMALE da
z14 (`#hs10m` ha solo `raster-opacity: 0.3`, senza comp-op): da z14 i versanti
al sole schiariscono, cosa che `multiply` non puo' fare. Il `multiply`
OpenLayers non lo riproduce da solo. La compensazione e' **additiva** — `c' = c + (255-c)*f` — perche' la
compensazione moltiplicativa satura a bianco i toni gia' chiari e cancella le
distinzioni fra le classi agricole.

## I PNG li disegna maplibre-native

**Le app disegnano con OpenLayers, i PNG con maplibre-native, dallo stesso
`style.json`** (decisione dell'11 ottobre 2026, in `notes.md`). Senza GPU
maplibre-native e' circa 60 volte piu' veloce di OpenLayers in Chromium —
64 tile z14 in 4,7 s contro 349 — e non ha le corse del browser. Il prezzo,
accettato dall'utente: qualche etichetta disposta diversamente da come la
disporra' un'app col vettoriale. **Si tara sempre lo stile, e lo si tara su
OpenLayers**: e' quello che vedranno le app; i PNG lo seguono da soli.

`src/raster/stile-nativo.js` adatta lo stile in automatico. Ogni regola
viene da un difetto trovato, e senza nessun errore:

- **maplibre-native carica le tile vettoriali un livello piu' in basso.** Le
  considera da 512 px (lo Style Spec accetta `tileSize` solo per i raster):
  disegnando a zoom N-1 per avere la scala di una tile zN, carica le tile
  N-1, e parchi, scudi e citta' che entrano nel dato a zN comparivano un
  livello dopo. Si disegna a zoom N con **pixel ratio 0,5**: stessa scala,
  tile giuste. Di conseguenza le grandezze in pixel raddoppiano — compresi
  i default, una linea senza `line-width` usciva larga mezzo pixel — e le
  soglie di zoom salgono di uno, perche' OpenLayers valuta lo stile a N-1.
- **Il contorno sfumato dei poligoni** (`fill-antialias`) disegna attorno a
  ogni poligono un bordo di un pixel del suo colore: i poligoni dell'uso suolo
  piu' piccoli di un pixel restavano visibili come anelli bianchi. Spento
  sulle superfici.
- **Il testo lungo le linee**: OpenLayers lo ripete ogni `symbol-spacing x
  2`, maplibre-native ogni `symbol-spacing`. Il valore raddoppia.

**L'ombreggiatura dei PNG e' una seconda implementazione delle stesse
formule**: maplibre-native non ha un layer equivalente, quindi la calcola
`src/raster/ombra.js` sulla CPU, con i parametri di
`metadata['wm:hillshade']`, e la compone come il browser — sopra le
superfici, sotto le curve di livello. Una modifica a `hillshade.js` va
riportata li': `node tools/ombra-native-vs-ol.mjs` rende le sole superfici
con i due renderer ed esce 1 se l'ombra diverge (oggi meno di 1,1 livelli di
grigio su 255). `pipeline/render-png-ol.mjs`, il renderer OpenLayers, resta
per questo e per vedere un PNG come lo vedra' un'app.

**Il binario precompilato vuole le librerie con cui e' costruito.**
maplibre-native 6.2.0 (fissata: la 6.4 vuole Node 20, sul Mac c'e' il 18) e'
compilata su Ubuntu 22.04 e cerca ICU 70: su un sistema piu' recente non si
carica. Sui server Linux si usa `pipeline/render-png-docker.sh`, che fissa
l'immagine, e `aggiorna-png.sh` ci ricade da solo se il modulo non si carica.
Il container parte con `--init`: senza, `xvfb-run` e' il processo 1 e resta
fermo per sempre in attesa di Xvfb, senza errori.

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
- **Un'icona su una LINEA compare solo se la linea occupa piu' di 150 pixel.**
  `stylefunction.js` di ol-mapbox-style 11 ha la soglia scritta nel codice
  ("FIXME Do not hard-code a size of 150"); sotto, niente icona e niente
  testo, senza errori. I cartellini di OpenMapTiles funzionano perche'
  planetiler unisce i tratti con lo stesso nome; le vie OSM grezze alle scale
  basse sono lunghe pochi pixel. Per i cartellini dei livelli bassi si
  calcolano in anticipo i PUNTI (`pipeline/punti-cartellini.py`: il centro di
  ogni via, a 250 pixel dagli altri con lo stesso numero a ogni livello, come
  `shield-min-distance`, con il livello d'ingresso in `tippecanoe.minzoom`). Per capirlo e' servito
  interrogare la funzione di stile nella pagina
  (`layer.getStyle()(feature, resolution)` su `getFeaturesInExtent`): una
  prova su un tratto lungo funziona e su uno corto no, e porta fuori strada.
- **La priorita' delle etichette e' rovesciata rispetto a Mapnik.** Mapnik
  piazza le etichette nell'ordine dei layer e scarta quelle che urtano le gia'
  piazzate: vince chi viene PRIMA. ol-mapbox-style da' a ogni layer di stile
  uno `zIndex` pari alla sua posizione e il declutter di OpenLayers premia lo
  `zIndex` piu' alto: vince chi viene DOPO. Con l'ordine del `.mml`, a z13 i
  nomi delle vie cancellavano quelli dei paesi. `build-zoom-profile.mjs` mette
  quindi i layer `symbol` in fondo e in ordine inverso al `.mml` (campo
  `ordine` del mapping per quelli senza selettore). Conseguenza da ricordare:
  un'icona con `icon-allow-overlap` ma senza `icon-ignore-placement` e' un
  ostacolo, e se sta sopra il proprio nome lo cancella (le cime a z14).
- **`symbol-spacing` vale il doppio.** ol-mapbox-style ripete il testo lungo
  una linea ogni `symbol-spacing x 2` pixel (`text.setRepeat(symbolSpacing *
  2)`): per il `text-spacing` di Mapnik il valore va dimezzato. Con 300 i nomi
  delle strade si ripetevano ogni 600 px invece di 300.
- **Lungo le linee OpenLayers non cerca posto.** Prova le posizioni a
  intervallo fisso e scarta quelle troppo curve; Mapnik sposta l'etichetta
  (`text-label-position-tolerance`). I numeri dei sentieri su tracciati
  tortuosi a volte mancano: e' un limite del motore, non dello stile.
- **Niente `["zoom"]` nei filtri.** ol-mapbox-style li valuta con lo stesso
  livello di scarto delle espressioni, ma `scalaZoom` corregge solo `paint` e
  `layout`: `[">=", ["zoom"], 16]` scattava a z17, cioe' mai. `build-style`
  ora si ferma se ne trova uno; le soglie vanno nel profilo o nel dato
  (`tippecanoe.minzoom`).
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
- **Bande ed etichette dei parchi senza soglia di superficie.** TGen le
  disegna solo se `way_pixels > 3000`, e l'etichetta cresce sopra 12.000 e
  48.000 pixel. La superficie in pixel quadruplica a ogni livello, quindi ogni
  area ha un primo livello `zpx` e le due soglie dell'etichetta cadono a
  `zpx+1` e `zpx+2`: `pipeline/parchi-soglia.py` lo scrive nel dato
  (`tippecanoe.minzoom` e la proprieta' `zpx`). Il dato e' la strada giusta
  perche' la preview chiede le tile allo stesso zoom della vista: lo
  sfasamento di un livello riguarda solo le espressioni dello stile.

Prima di dare un colore a un layer, cercare nel `.mss` il selettore che lo
governa e replicarne il filtro. Il colore giusto sull'insieme sbagliato di
geometrie resta un difetto.

Il caso opposto costa altrettanto: **un selettore di TGen senza alcun layer
locale.** Le ferrovie (`railway_rail` dentro `roads-fill`, da z8) e le uscite
autostradali (`#junctions`, da z11) mancavano del tutto, e nessuna misura per
elemento poteva accorgersene: si confronta solo cio' che esiste da entrambe le
parti. Si trovano guardando le tile affiancate, non le medie.

## Ogni livello di zoom ha il suo set di ombreggiatura

`shadeSets` tiene `hs-z7` … `hs-z16`, uno per livello, piu' `hs-z0-6` per i livelli sotto il profilo (`shadeSotto`), non fasce condivise: le
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

```bash
node tools/taratura-ombra.mjs gamma 1,0.85,0.7 14/8668/5972 14/8686/5995   # un parametro, molti valori
```

`taratura-ombra.mjs` carica la tile una volta e cambia il parametro nella
pagina: sedici misure in 36 secondi invece di un quarto d'ora, e coincide con
`zoom-diff` (stessi valori al decimo). Serve a scegliere; la verifica finale
resta `zoom-diff` su tutta la scala. Attenzione a `vert`: agisce anche sul
layer della pendenza, che lo strumento aggiorna insieme a quello della luce —
aggiornarne uno solo sottostimava lo scurimento.

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
- **Il cambio di composizione fra livelli non e' mai arrivato al canvas.**
  `hillshade.js` cercava `getRenderer().getCanvas()`, che in OpenLayers 7 non
  esiste: la classe del layer sta sul canvas WebGL dell'helper
  (`getRenderer().helper.getCanvas()`). In piu' segnava la composizione come
  applicata anche quando non trovava il canvas, e non riprovava. Finche' tutti
  i set erano `multiply` non se n'e' accorto nessuno; con `normal` da z14 la
  mappa restava in `multiply` e risultava piu' scura di 13 punti. Ora la classe
  si riallinea dopo ogni disegno, e `tile-diff.mjs` e `render-png-ol.mjs`
  confrontano la classe con la composizione VOLUTA dal motore, non solo con
  il calcolato: classe e calcolato coincidevano anche quando erano sbagliati.
- **L'ombra di z16 sotto z8.** Un livello senza fascia ricadeva sull'ULTIMA
  fascia, pensata per z17 e oltre: z7 (che nel profilo non aveva set) e z0–z6
  prendevano la composizione normale a 0,3 di z16, un velo grigio al posto del
  `multiply` di TGen. Ora sotto la prima fascia vale la prima, z7 ha `hs-z7` e
  z0–z6 `hs-z0-6` (`shadeSotto` nel profilo).

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
asset pronti e mai attivati. Nello stile i layer che li leggono (`toponimi`,
`rifugi-icon`, `rifugi-label`) restano quindi **spenti di serie**
(`visibility: none`): un'app vettoriale puo' accenderli, un PNG no. I rifugi
che TGen disegna davvero vengono da OSM (`hut-icon`, `hut-label`,
`shelter-icon`, sorgente `osmpoi`).

**Le curve di livello servite sono `contours-tgen.pmtiles`**, con i campi
`quota` e `type` (`cp*` direttrice, `cs*` secondaria: `cp50/cs50` a z13,
`cp25/cs25` da z14). Accanto c'e' `contours-copernicus.pmtiles`, che ha invece
`ID`/`ele` e nessun `type`: leggere quello per sbaglio porta a concludere che
le direttrici non esistano e a riscrivere le larghezze con un modulo su `ele`,
facendo sparire le direttrici e con loro le etichette delle quote. L'archivio
arriva a **z15**: la sorgente deve dichiarare `maxzoom: 15`, con 14 le curve a
z15 vengono da tile sovraingrandite e risultano meno fitte del riferimento.

**Una sola palette per le superfici.** I colori stanno in
`zoom-profile.json > surfaceSets`, uno per fascia (`corine-2018` z7–z12,
`corine` z13, `regionale` da z14). `clc-fill` e `landcover-fill` li prendono
per codice; gli altri layer li citano per nome, `"pal:bosco"`, e
`build-style.mjs` li risolve livello per livello (uno `step` se il layer
attraversa piu' set). `landcover-osm` per mesi ha avuto invece una palette sua
copiata a mano, benche' questo file dicesse il contrario: le zone umide usavano
`@zumide` mentre in `landcover.mss` `wetland_marsh` va su `@grass`, e mancavano
rocce e ghiaioni (`@bare_ground: @bianco`) e sabbia. Ora segue `landcover.mss`
sottoclasse per sottoclasse.

**Le palette Corine si misurano classe per classe, sui pixel.**
`tools/colore-per-classe.mjs mediana clc clc "p.code === '313'" --locale
<png>` confronta la mediana di TGen e quella locale sotto la stessa maschera,
cosi' l'ombra pesa uguale sui due lati. Su 96 tile del 2018 gli scarti
cambiano segno da una classe all'altra (oliveti e bosco misto da scurire,
conifere e pascolo da schiarire): nessuna correzione unica li sistema. Una
correzione unica (rosso -5 e blu -14, poi -2 e -5) aveva funzionato solo in
media. **Non tarare una palette intera su un tono solo, ne' su una media.**

Per l'estratto OSM nazionale usa `europe-latest.osm.pbf` +
`osmium extract -b 4.39,35.37,22.11,48.06`: `italy-latest` e' tagliato al
confine e produce tile incomplete sull'arco alpino.

## Documentazione della feature

`docs/features/server-tiles-osm/` contiene `overview.md` (cosa cambia,
requisiti, rischi), `plan.md` (i task) e `notes.md` (deviazioni e decisioni prese
strada facendo). Le deviazioni dal piano vanno in `notes.md`.
