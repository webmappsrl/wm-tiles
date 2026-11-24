> Ticket: oc:9011
> Stato: chiusa il 2026-11-24 (approvata il 2026-11-23, commit a39f4bd)

# Servizio di rendering delle mappe per la stampa, su wm-tiles

## Cosa cambia

`wm-tiles` acquista un secondo mestiere: oltre a servire tile, disegna **una
mappa intera a formato pagina** e la restituisce come PNG a chi gliela chiede
via HTTP. Lo shard gli manda le geometrie di uno o piu' sentieri e il formato
della pagina, e riceve l'immagine pronta da incollare nella scheda PDF.

L'operazione e' `map` dell'interfaccia definita in oc:8982: `POST /v1/print/map`.
Il renderer gira in un **container suo**, separato dal processo che serve le
tile, perche' un segfault del modulo nativo non deve spegnere le mappe
interattive di tutti gli shard.

Il PDF resta fuori: lo compila LaTeX dentro lo shard, dove i file gia' stanno.

## Perche'

Il capitolato chiede una mappa a 300 dpi nella scheda stampabile (WEBSITE-21) e
nessuno dei pezzi esistenti la sa produrre: il sito e l'app disegnano nel
browser, e le PNG di `api.webmapp.it/tiles` sono tessere da schermo. Deciso in
call il 18/11 ("non prendi PBF, ma gli dai una geometria e ti torna la mappa"),
ripreso il 19/11 e confermato il 23/11 con la divisione dei compiti: lo shard
chiude la scheda con un riquadro grigio, qui dentro nasce la mappa che lo
sostituisce.

Sta su `wm-tiles` e non negli shard perche' qui ci sono gia' i dati che il
rendering legge (tile vettoriali, glyph, sprite, DEM), il codice che adatta lo
stile al renderer nativo, e margine di memoria. Il modulo
`@maplibre/maplibre-gl-native` apre un contesto OpenGL e dipende da librerie di
sistema: accanto ai worker Horizon di ogni shard non esiste un modo affidabile
di limitarne la memoria fisica. Si costruisce una volta per tutti gli shard.

## Punto di partenza

- `src/server.js` e' Express 5 con rotte scritte a mano (`app.get`). Non ha
  autenticazione, token, rate limit, ne' alcun prefisso di versione. Il `set`
  dei gruppi di layer arriva libero dalla query (riga 430, `req.query.set`); il
  filtro vero e' in `src/tiles/filter.js`, che lavora sui byte del protobuf.
- `pipeline/render-png.mjs` e' solo uno script CLI: nessun `export`, codice a
  livello di modulo, `process.exit`. Costruisce **due** mappe (`mSotto`,
  `mSopra`) perche' l'ombreggiatura e' calcolata sulla CPU in mezzo
  (`src/raster/ombra.js`), e risolve ogni risorsa con `fetch` HTTP verso il
  server (riga 107, callback `richiesta`), mai da file o da PMTiles.
- `src/raster/stile-nativo.js:39` esporta `PIXEL_RATIO = 0.5`, una costante: da
  li' `adattaStile` raddoppia le grandezze in pixel (`scala = 1 / PIXEL_RATIO`)
  e alza di un livello le soglie di zoom.
- `src/raster/tiles.js:96` (`vistaMetatile`) e' sola aritmetica, non renderizza:
  produce frame **quadrati** (`lato * 256 + 2 * margine`, in pratica 1280 px)
  centrati su un angolo di tile. Non esiste nulla che vada da un bbox a
  `center` + `zoom`.
- Nessuna sorgente GeoJSON compare nel codice di rendering: l'overlay delle
  geometrie non esiste.
- Nessun formato pagina, millimetro o dpi in tutto il repo.
- L'unica immagine Docker e' `pipeline/render-png.Dockerfile` (ubuntu:22.04,
  Xvfb, Mesa, Node 20.18.1), che monta il codice da fuori. Non esistono
  `docker-compose`, `.github/workflows/`, ne' un'immagine del server: gira come
  unita' systemd scritta da `infra/pubblica-dominio.sh`, dietro Caddy generato
  in heredoc dallo stesso script.
- Test con Vitest in `test/**/*.test.js`; nessuno carica il modulo nativo ne'
  esercita il rendering PNG.

## Requisiti

- <a id="r1"></a>**R1** — `POST /v1/print/map` riceve una `FeatureCollection`, il
  formato della pagina e lo stile, e risponde con un PNG. Il percorso porta un
  numero di versione perche' `wm-tiles` e gli shard si rilasciano in momenti
  diversi.
  - Verifica: [test/print-route.test.js](../../../test/print-route.test.js) › `con token valido risponde image/png`
- <a id="r2"></a>**R2** — Il formato della pagina si chiede per nome (`a4`,
  orientamento, dpi) e la conversione in pixel la fa il servizio: lo shard non
  ripete il conto. Chiedere la stessa pagina due volte da due shard diversi
  produce immagini della stessa dimensione.
  - Verifica: [test/print-fit.test.js](../../../test/print-fit.test.js) › `i formati sono in millimetri, verticali`
- <a id="r3"></a>**R3** — L'inquadratura la calcola il servizio dalle geometrie
  ricevute, con `padding` e `maxZoom` come parametri della richiesta: e' lo
  `zoomToExtent` che OpenLayers ha e maplibre-native no. La scala non si
  sceglie, esce dal conto, quindi e' diversa per ogni scheda. Una geometria
  degenere — un `EcPoi`, che e' un punto solo — produce comunque una mappa
  leggibile invece di uno zoom senza fine.
  - Verifica: [test/print-fit.test.js](../../../test/print-fit.test.js) › `una traccia larga entra per il lato lungo`
- <a id="r4"></a>**R4** — Le geometrie si disegnano sopra la mappa con le
  proprieta' di `simplestyle-spec` lette dalle singole feature (`stroke`,
  `stroke-width`), cosi' una mappa d'insieme distingue N tracce senza
  parametri aggiuntivi; chi non le passa ottiene la resa predefinita. L'alone
  chiaro sotto la traccia e' deciso dal servizio, perche' e' leggibilita' su
  carta e non identita' visiva del cliente.
  - Verifica: [test/print-overlay.test.js](../../../test/print-overlay.test.js) › `legge stroke e stroke-width dalla feature`
- <a id="r5"></a>**R5** — Il testo piu' piccolo della mappa resta leggibile sulla
  carta: la taratura e' sulla dimensione in **millimetri** di etichette e simboli
  (almeno 2,5 mm di corpo, misurati su un PNG a formato pagina), non su un
  fattore. Il fattore di ingrandimento della tipografia (`typeScale`) dipende dal
  pixel ratio di maplibre-native: **3,2 a ratio 0,5**, equivalente a 1,6 a ratio
  1. Un ratio diverso da 0,5 cambia il livello delle tile caricate, e quindi il
  contenuto della pagina: non e' una variante estetica. Fattore e zoom si tarano
  insieme sulla misura.
  - Verifica: [tools/print-legibility.mjs](../../../tools/print-legibility.mjs) › `--min-mm` — gate che esce 1; misurati **2,53 mm** su `road-label-track`, sul Mac e dentro il container
- <a id="r15"></a>**R15** — `mapInfo`, acceso quando non viene passato, disegna
  sul PNG la barra di scala, l'orientamento e le attribuzioni (`© OpenStreetMap`
  e `© Webmapp`). La barra e' grafica e non una scritta «1:25.000» perche' la
  scala cambia a ogni scheda e resta corretta anche se il foglio viene ridotto.
  Con `mapInfo: false` — il caso della mappa a tutta pagina sotto il titolo — il
  servizio non disegna nulla ma restituisce nella risposta attribuzioni, scala
  effettiva e dpi reale, cosi' lo shard li stampa dove preferisce senza doverli
  ricostruire.
  - Verifica: [test/print-map-info.test.js](../../../test/print-map-info.test.js) › `le attribuzioni hanno inchiostro in basso a destra e in nessun altro quadrante`
- <a id="r6"></a>**R6** — Il rendering gira in un container suo, con tetto di
  memoria e di CPU, riavvio automatico e riciclo periodico del processo: un
  segfault o un leak del modulo nativo non tocca le tile interattive.
  - Verifica: [test/print-route.test.js](../../../test/print-route.test.js) › `senza PRINT_TOKENS_PATH la rotta non esiste: 404, non 401`
- <a id="r7"></a>**R7** — Il servizio serve un numero limitato di rendering
  insieme e oltre la soglia risponde `503` con `Retry-After`, senza accodare
  nulla al proprio interno: chi chiama e' un job Horizon e sa riprovare.
  - Verifica: [test/print-route.test.js](../../../test/print-route.test.js) › `oltre gli slot risponde 503 con Retry-After`
- <a id="r8"></a>**R8** — L'endpoint richiede un token per shard, e il rate limit
  e' **nel servizio, per token**: Caddy sull'host e' la 2.11.7 dei pacchetti e
  non ha alcun modulo `rate_limit` (verificato con `caddy list-modules`), quindi
  il limite in Caddy richiederebbe di sostituire un binario che serve anche
  wm-routing, e un aggiornamento di sistema lo spegnerebbe in silenzio. Un
  limite per token e' anche piu' utile di uno per indirizzo, perche' gli shard
  arrivano da indirizzi diversi ma con identita' note. I token stanno fuori dal
  repo, che e' pubblico; a Caddy restano reverse proxy e TLS.
  - Verifica: [test/print-route.test.js](../../../test/print-route.test.js) › `oltre il limite al minuto risponde 429 con Retry-After`
- <a id="r9"></a>**R9** — La richiesta ha tetti **dichiarati in numero** su
  dimensioni in pixel, peso della `FeatureCollection` e zoom, e li rifiuta con
  un errore esplicito invece di tentare un rendering che non finisce. Il peso
  del corpo non puo' restare il default di Express (100 kB): una mappa
  d'insieme con N tracce lo supera, e il `413` sembrerebbe un difetto dello
  shard.
  - Verifica: [test/print-openapi.test.js](../../../test/print-openapi.test.js) › `ogni tetto del codice e`
- <a id="r16"></a>**R16** — Ogni rendering ha un **tempo massimo**, scaduto il
  quale lo slot si libera e la richiesta fallisce. Senza, una `render()` che non
  richiama mai la callback — e `xvfb-run` in questo repo e' gia' rimasto
  appeso per sempre una volta — occupa uno slot a vita, e dopo pochi casi il
  servizio risponde `503` per sempre con il processo vivo e il controllo di
  salute superato.
  - Verifica: [test/print-route.test.js](../../../test/print-route.test.js) › `un rendering che non finisce libera lo slot e fallisce`
- <a id="r17"></a>**R17** — Una risposta incompleta e' un errore, non un PNG.
  Gli avvisi del modulo nativo arrivano su un gestore di processo
  (`mbgl.on('message')`), non per richiesta: senza correlarli, un rendering a
  cui manca l'ombra, le etichette o un intero layer esce `200` e finisce in una
  scheda consegnata al cliente.
  - Verifica: [test/print-route.test.js](../../../test/print-route.test.js) › `un frame della dimensione sbagliata e`
- <a id="r10"></a>**R10** — Lo stile si sceglie per identificativo. Un URL non si
  accetta in nessun campo: sarebbe un vettore di SSRF verso la rete interna
  dell'host.
  - Verifica: [test/print-route.test.js](../../../test/print-route.test.js) › `uno styleId sconosciuto o un URL sono rifiutati`
- <a id="r11"></a>**R11** — Ne' i log ne' alcuna cache conservano le geometrie
  ricevute: dagli shard escono anche sentieri non pubblicati. Si registra chi ha
  chiamato e quanto e' costato, mai cosa conteneva la richiesta. Comprende le
  tre vie di fuga che un divieto generico non copre: i messaggi di errore di
  validazione non citano i dati che hanno fatto fallire la richiesta, le tracce
  di errore non espongono il corpo, e il container non scrive core dump — un
  segfault del modulo nativo, che [R6](#r6) da' per possibile, scaricherebbe su
  disco la memoria con dentro le geometrie.
  - Verifica: [test/print-fake.test.js](../../../test/print-fake.test.js) › `nessun messaggio di errore riporta i valori ricevuti (R11)`
- <a id="r12"></a>**R12** — Il repo acquista una build e un deploy propri
  (immagine, composizione, workflow), perche' il servizio e' un container e non
  piu' solo un'unita' systemd.
  - Verifica: a mano — implementatore e review, 2026-11-24: `docker compose build` e `docker compose up -d` su `Dockerfile.print`, poi `POST /v1/print/map` nel container (A4 300 dpi in 2999 ms, 200 con il PNG); `.github/workflows/print.yml` letto riga per riga ma **mai eseguito**: vuole quattro secret e l'environment `production`, che non esistono ancora
- <a id="r13"></a>**R13** — Esiste un'implementazione finta dell'interfaccia per
  lo sviluppo locale e i test degli shard, e un modo per un dev di raggiungere
  l'endpoint vero con un token.
  - Verifica: [test/print-fake.test.js](../../../test/print-fake.test.js) › `e le rifiuta con lo stesso messaggio, non con uno suo`
- <a id="r14"></a>**R14** — Gli identificatori del codice nuovo — campi JSON,
  parametri, chiavi di configurazione, nomi di file — sono in inglese. I
  commenti e i log restano in italiano, come il resto del repo.

  - Verifica: a mano — review indipendente, 2026-11-24: letti tutti i moduli nuovi; quattro nomi italiani sfuggiti in `limits.js` portati in inglese, commenti e log in italiano
## Rischi

- **Il costo di un A4 a 300 dpi non e' misurato, ed e' il rischio numero uno.**
  Sono 8,7 megapixel contro i 1280x1280 del frame piu' grande mai renderizzato
  qui, cioe' 53 volte l'area, con due mappe invece di una e senza GPU (Mesa in
  software). La prova a formato pagina e' il primo task del piano. Mitigazione
  gia' decisa: **si scala il dpi finche' il costo e' sostenibile**, e la soglia
  esatta si fissa dopo la misura. Escluse invece due strade: rendere piccolo e
  ingrandire (riporta la sfocatura che il vettoriale serve a togliere) e cucire
  metatile (taglia le etichette in mezzo alla pagina).
- **`PIXEL_RATIO` non e' una manopola di dimensione: decide quali tile si
  caricano.** Il commento in testa a `src/raster/stile-nativo.js` lo dichiara:
  maplibre-native considera ogni tile vettoriale da 512 px e a zoom N carica le
  tile N, quindi disegnare a zoom N con ratio 0,5 da' «stessa scala in pixel,
  tile zN». Da li' discendono il raddoppio di `IN_PIXEL` (riga 102) e le soglie
  alzate di uno (righe 105-106, 131). Alzarlo per la stampa cambierebbe il
  livello di tile, cioe' **quali dati esistono nell'immagine** — quali POI,
  scudi, parchi — non quanto appaiono grandi. Percio' resta 0,5 e la carta si
  governa con il fattore tipografico di [R5](#r5). I PBF e le regole che li
  generano non si toccano: il vettoriale sopra il `maxzoom` di ogni sorgente
  viene gia' overzoommato oggi (OSM si ferma a z14, le curve a z15), ed e' lo
  stesso regime, spinto di circa un livello e mezzo.
- **L'ombreggiatura dei PNG assume un frame quadrato.** `src/raster/ombra.js`
  alloca `new Float32Array(N * N)` in `grigi` (riga 53), `W * W` con
  `W = N + 2*B` in `quoteVista` (riga 97) e `Buffer.alloc(N * N * 3)` in
  `componi` (riga 144): un solo `N`, perche' il metatile e' quadrato per
  costruzione. Una pagina non lo e', quindi quelle funzioni passano da `N` a
  `W`x`H`. Non e' l'estrazione di una funzione: e' codice che produce i PNG di
  `api.webmapp.it`, che il repo garantisce identici byte per byte ai livelli
  interi. Mitigazione: un confronto di hash su tile note come gate, accanto a
  `test/raster-ombra.test.js` e a `tools/ombra-native-vs-ol.mjs`, che gia'
  coprono quelle funzioni. Non tocca le app: la loro ombra e'
  `src/preview/public/hillshade.js`, sulla GPU, e `ombra.js` e' importato solo
  da `render-png.mjs`, due strumenti di misura e un test.
- **Lo sprite arriva a @2x e le icone si ingrandiscono con la tipografia.**
  `pipeline/build-sprite.mjs:99` genera `for (const ratio of [1, 2])`: a densita'
  di stampa le icone verrebbero prese da un atlas meno fitto e stirate, cioe' la
  sfumatura che il vettoriale serve a togliere, proprio su cio' che [R5](#r5)
  misura. Rimedio piccolo: l'indice scrive gia' `pixelRatio` per ogni icona
  (riga 144) e le icone sono 125 SVG resi con `density: 72 * ratio`, quindi
  basta aggiungere una densita' all'elenco. L'unico file bitmap e'
  `tg-military_red_hatch.png`, un retino, che ingrandito resta un retino.
- **300 dpi e' un numero contrattuale, non una preferenza.** Il capitolato lo
  chiede (WEBSITE-21), quindi scendere non e' un degrado ma un'uscita dal
  capitolato. Manca ancora la soglia sotto la quale il requisito non e' piu'
  soddisfatto, e va scritta prima della misura: dopo, il numero che esce
  diventa il metro di se stesso.
- **La stampa dipende dalle tile, e nessun requisito lo dichiarava.**
  `render-png.mjs` risolve ogni risorsa con `fetch` verso il server (riga 107),
  tile vettoriali, glyph, sprite e DEM comprese: il container di stampa non
  produce nulla se quello delle tile e' fermo. [R6](#r6) protegge il verso
  opposto. Rischio accettato: sono due container sullo stesso host, e il caso in
  cui le tile sono giu' e la stampa no non ha valore pratico.
- **Uno stile cachato che punta a una versione ritirata da' una pagina bianca
  senza errori.** E' il fallimento che il `CLAUDE.md` gia' documenta per le
  cache, e con due deploy separati torna possibile fra i due container.
  Presidiato da [R17](#r17), che impone di fallire invece di consegnare
  un'immagine incompleta.
- **Un token valido puo' chiedere qualunque `set` di layer.** Il `set` lo manda
  lo shard, per simmetria con l'endpoint delle tile, quindi il token autorizza
  l'accesso al servizio ma non limita i gruppi di layer. **Rischio noto e
  accettato dal dev** (23/11): il filtro commerciale resta quello che e' oggi
  per le tile, e se un domani andra' stretto si cambiano insieme i due
  endpoint.
- **Il prebuilt di maplibre-native non si carica sull'host.** `ldd` sul binario
  installato riporta cinque librerie mancanti, e `libicu70` non e' installabile
  su Ubuntu 26.04 (c'e' `libicu78`, con i simboli versionati: un symlink non
  basta). Mitigato dal container, che e' percio' obbligato e non una scelta di
  stile; da verificare se la 6.4.1 sia linkata a una ICU presente.
- **Il servizio apre il primo ingresso scrivibile di `wm-tiles`.** Fino a ora il
  server risponde solo a letture di dati gia' prodotti; `POST` con un corpo
  arbitrario e' un'altra superficie. Mitigato da [R8](#r8), [R9](#r9),
  [R10](#r10) e dal container.

## Out of scope

- La compilazione del PDF, la scheda LaTeX e la pagina d'attesa: sono di
  oc:8982, nello shard.
- Il pulsante «Stampa» sul sito WordPress: altro ticket ancora.
- L'autenticazione delle rotte delle tile esistenti, e il fatto che il loro
  `set` sia libero: resta come e'.
- Un output vettoriale della mappa (PDF o SVG), che per la stampa sarebbe
  migliore del PNG: maplibre-native non lo produce, disegna su un framebuffer.
  Il PNG e' una conseguenza del renderer, non una scelta da rimettere in
  discussione.

## Moduli toccati

Previsti, tutti nel repo principale (nessun submodule):

- `src/print/` — nuovo: `renderFrame()`, `fitBounds()`, `PAGE_FORMATS`,
  l'overlay delle geometrie, il corredo di [R15](#r15), il limite per token, la
  rotta.
- `src/server.js` — registrazione della rotta versionata, lettura del corpo
  (prima di questo lavoro il server non aveva ne' `express.json` ne' alcun
  `app.post`: `/v1/print/map` e' la sua prima rotta in scrittura), token.
- `src/raster/stile-nativo.js` — il fattore tipografico; `PIXEL_RATIO` **resta
  0,5**.
- `src/raster/ombra.js` — generalizzazione da `N` a `W`x`H` di `quoteVista`,
  `grigi`, `sfoca`, `componi`. Tocca i PNG di produzione: serve il gate di
  identita' sui **pixel** (non sui byte: vedi i rischi e [notes.md](notes.md)).
- `pipeline/render-png.mjs` — estrazione della costruzione della mappa e del
  frame, che stavano dentro lo script (ora in `src/print/render.js`, condiviso).
- `pipeline/build-sprite.mjs` — una densita' in piu' nell'elenco dei ratio.
- `infra/` — immagine, composizione e il site block di Caddy, che va modificato
  **nello script** e non a mano sul server: `pubblica-dominio.sh` rigenera
  `/etc/caddy/Caddyfile` da capo a ogni esecuzione.
- `.github/workflows/` — nuovo: build e deploy.
- `test/` — rotta, formati, inquadratura (compresi i casi limite:
  `FeatureCollection` vuota, geometria nulla, coordinate invertite, `padding`
  piu' grande della pagina), identita' byte dei PNG, millimetri del testo.
