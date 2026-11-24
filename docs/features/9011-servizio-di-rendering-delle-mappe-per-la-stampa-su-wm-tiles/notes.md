> Ticket: oc:9011
> Overview approvata il 2026-11-23 · impronta `b86918471fd35f451b22f40847a5433aba87ee12`

# Notes — Servizio di rendering delle mappe per la stampa, su wm-tiles

## Modifiche ai requisiti

### 2026-11-23 — il fattore tipografico parte da 1,5, non da 3,1
- **Requisito:** [R5](overview.md#r5)
- **Effetto:** modificato
- **Decide:** agente, sulla misura del Task 1
- **Perche':** il 3,125 scritto nell'overview veniva da una derivazione teorica
  (300 / 96, il rapporto fra il pixel di schermo e quello di stampa) e la misura
  lo smentisce. Il testo piu' piccolo dello stile a z14 esce **20 px, cioe'
  1,69 mm** a 300 dpi; con il fattore 3,125 diventerebbe 62 px, **5,3 mm**, che
  su una carta escursionistica e' fuori scala (i toponimi stanno sui 2-3 mm).
  Il fattore che porta a 2,5 mm e' **1,48**; a 2 mm basta 1,18, per 3 mm serve
  1,77. La derivazione teorica pareggiava la dimensione percepita a schermo,
  dove un'etichetta di 16 px CSS e' 4,2 mm: su carta, tenuta piu' vicina e senza
  pixel visibili, si legge piu' piccolo. E' il motivo per cui [R5](overview.md#r5)
  chiede i millimetri e non un fattore.
- **Testo nuovo:**
  > Il testo piu' piccolo della mappa resta leggibile sulla carta: la taratura e'
  > sulla dimensione in **millimetri** di etichette e simboli, non sul numero di
  > pixel. E' il requisito che decide se la scheda serve a qualcosa, e non lo
  > misura nessuna metrica di tempo o memoria: serve uno strumento che misuri i
  > millimetri su un PNG a formato pagina, come ogni altra questione di resa in
  > questo repo ha il suo.
  >
  > Il fattore di ingrandimento della tipografia si tara **sulla misura**, non su
  > una derivazione: a 300 dpi un millimetro vale 11,81 px, il testo piu' piccolo
  > dello stile esce 20 px (1,69 mm) e il fattore che lo porta a 2,5 mm e'
  > **1,48**. Agisce sulle sole grandezze di `IN_PIXEL`; `PIXEL_RATIO` resta 0,5
  > (vedi i rischi). Effetto atteso da verificare: etichette piu' grandi a parita'
  > di area significa che il declutter ne scarta di piu', quindi la mappa stampata
  > porta meno nomi di quella a schermo, e le due manopole — fattore e zoom — si
  > tarano insieme.

### 2026-11-23 — il fattore tipografico dipende dal pixel ratio: 3,2 a ratio 0,5
- **Requisito:** [R5](overview.md#r5)
- **Effetto:** modificato
- **Nota:** supera la voce precedente, che resta per memoria del percorso
- **Decide:** dev, sulla misura di `tools/print-legibility.mjs`
- **Perche':** la voce precedente indica 1,48 senza dire a quale pixel ratio: valeva a
  ratio 1 (misura del Task 1 a 2 volte la scala di una tile), dove `renderFrame` carica le tile
  di un livello piu' basso e la pagina perde i nomi di localita', corsi d'acqua, strade minori e
  sentieri. Il fattore **dipende dal ratio**: a `PIXEL_RATIO` 0,5, l'unico che carica le tile del
  livello giusto, il fattore e' **3,2**, equivalente a 1,6 a ratio 1 (il 3,125 = 300/96 della prima
  stesura non era sbagliato, era riferito a ratio 0,5).
- **Testo nuovo:**
  > Il testo piu' piccolo della mappa resta leggibile sulla carta: la taratura e' sulla dimensione
  > in **millimetri** di etichette e simboli (almeno 2,5 mm di corpo, misurati su un PNG a formato
  > pagina), non su un fattore. Il fattore di ingrandimento della tipografia (`typeScale`)
  > dipende dal pixel ratio di maplibre-native: **3,2 a ratio 0,5**, equivalente a 1,6 a ratio 1.
  > Un ratio diverso da 0,5 cambia il livello delle tile caricate, e quindi il contenuto della
  > pagina: non e' una variante estetica. Fattore e zoom si tarano insieme sulla misura.

## Divergenze dal piano, task per task

### Task 5

- Piu' severo di prima: `pipeline/render-png.mjs` contava gli `ERROR` di maplibre-native ma scriveva comunque il PNG; ora lo stesso errore fa fallire il metatile (`renderFrame` rifiuta) e i suoi PNG non vengono scritti. E' coerente con [R17](overview.md#r17); non e' "identico a prima", e il gate dei PNG (4 tile) non lo vede.
- Sprite, glifi, stile e sorgenti che rispondono 404/204 sono ora un errore; solo le tile (kind `Tile`) fuori copertura restano vuote, come prima.
- Il ratio e' della mappa maplibre, non della vista: `createMaps(style, ratio)`; `renderFrame` rifiuta mappe con ratio diverso e mappe occupate da un altro frame.

### Task 8

- **Gli ingressi del corredo si validano, come in `src/print/fit.js`.** Senza
  validazione `zoom`, `center` o `dpi` non numerici non fanno rumore: la scala
  esce `1:NaN` e, peggio, `drawMapInfo` restituisce un PNG regolare in cui la
  barra e le sue etichette non ci sono, perche' librsvg scarta in silenzio le
  geometrie `NaN`. Una pagina senza scala che non segnala niente viola
  [R17](overview.md#r17). Ora `checkMapInfo` controlla `zoom` (numero finito),
  `center` (coppia di numeri finiti, longitudine entro 180 e latitudine entro
  85,0511287798 come il resto del repo) e `dpi` (positivo), in entrambe le
  funzioni esportate, piu' `width`/`height` in `drawMapInfo`. I messaggi nominano
  il campo e mai il valore ([R11](overview.md#r11)).
- **Il testo delle attribuzioni e' ancorato a destra** (`text-anchor="end"` sul
  bordo interno del riquadro). `textWidth` stima 0,52 em per carattere senza
  misurare i glifi, ed e' una stima per difetto con i font piu' larghi: misurato
  l'inchiostro reale per famiglia, Helvetica sta su 0,534 em e **Verdana su
  0,608**; con Verdana e un A4 l'attribuzione ancorata a sinistra arrivava a
  `x = 2479` su una pagina larga 2480, cioe' tagliata dal bordo. Ancorata a
  destra l'eventuale eccedenza cresce verso l'interno della mappa. Il font del
  container (`fonts-dejavu-core`) non e' installato sul Mac e non e' stato
  misurato: e' il motivo per cui la soluzione non e' alzare la stima.
- **Barra e attribuzioni non si sovrappongono piu' su pagine strette.** A
  600x800 — la fixture del test — i due riquadri si toccavano e il corredo
  risultava di due componenti connesse invece di tre. Ora, se il riquadro delle
  attribuzioni invaderebbe quello della barra, sale sopra di esso restando a
  destra. Su A4 e A5 a 150-300 dpi la condizione non scatta.
- **`formatLength` scrive il separatore decimale all'italiana**: «2,5 km», non
  «2.5 km».
- **`drawMapInfo` e' ora misurata, non campionata.** I test leggono i pixel con
  `sharp(...).raw()` e verificano: la lunghezza della barra disegnata contro i
  metri dichiarati (il conto dei metri per pixel e' rifatto nel test, per non
  confrontare il codice con se stesso), la presenza dell'inchiostro delle
  attribuzioni dentro il loro riquadro e la sua assenza fuori, la forma del
  riquadro (piu' largo che alto), il margine residuo a destra come prova
  dell'ancoraggio, l'apice della freccia del nord sopra la sua base, le tre
  componenti connesse del corredo e, su A4, nessun inchiostro sull'ultima riga e
  sull'ultima colonna. Quattro mutazioni che prima passavano tutte ora cadono
  (attribuzioni mai disegnate, `width`/`height` scambiati, barra lunga il doppio
  dei metri che dichiara, freccia capovolta).
- **Divergenza accettata:** le attribuzioni restano ridichiarate in
  `src/print/map-info.js` e non importate da `src/server.js`, dove la costante e'
  nella forma lunga e non e' esportata. Resta la decisione del 2026-11-23 sulla
  forma breve.
- **Limite noto, non risolto:** `niceBarLength` con `maxMeters < 1` non trova
  nessun passo valido e resta sul default di 10 m, che in quel caso deborda dallo
  spazio concesso. Agli zoom plausibili per una scheda (fino a z22 la barra ha
  comunque piu' di un metro nello spazio disponibile) il caso non si raggiunge; il
  commento della funzione ora lo dichiara invece di annunciare un minimo di 10 m
  che non esiste.

### Task 9

- **Il corpo della richiesta ha una forma dichiarata e CHIUSA.** L'overview
  nomina l'operazione (`POST /v1/print/map`) ma non elenca i campi, e in oc:8982
  non c'e' uno schema da seguire: qui si fissa
  `{geometry, page: {format, orientation, dpi}, styleId, set, padding, maxZoom,
  mapInfo}`. Un campo in piu' e' un **errore**, non un campo ignorato: e' la
  difesa pratica di [R10](overview.md#r10), perche' un `styleUrl` o un
  `spriteUrl` che il servizio ignorasse oggi potrebbe essere letto domani da chi
  non sa perche' non c'era. Da concordare con lo shard: se li' i nomi sono altri,
  si cambiano qui.
- **Le proprieta' delle feature si riducono a `stroke` e `stroke-width`.**
  L'overlay usa solo quelle, e tutto il resto — nomi, id, descrizioni di sentieri
  non pubblicati — non ha ragione di entrare nel processo
  ([R11](overview.md#r11)). Un valore fuori formato (colore non esadecimale,
  spessore negativo o enorme) e' un `400`, non un frame che fallisce
  ([R17](overview.md#r17)).
- **L'ombreggiatura della pagina e' la terza copia del mosaico del DEM**
  (`pipeline/render-png.mjs`, `tools/page-cost.mjs`, ora `demShade` in
  `src/print/route.js`). Estrarla toccherebbe lo script che produce i PNG di
  `api.webmapp.it`, garantiti identici byte per byte: non si e' fatto dentro
  questo task. Due differenze tecniche rispetto alle tile, dovute al fatto che
  qui lo zoom esce da `fitBounds` ed e' **frazionario**: la fascia dell'ombra si
  sceglie con la regola della preview (`floor(zoom + 0,585)`, il cambio di
  livello di TGen) invece che con `fasciaDi(fasce, zoom)`, che a zoom 14,42 non
  troverebbe nessuna fascia e ricadrebbe sull'ultima (il difetto gia' noto
  «l'ombra di z16 sotto z8»); e il gradiente si misura su un numero **intero** di
  pixel della vista, perche' `grigi` usa quel valore come scarto di indice,
  dividendo per la distanza vera in metri fra i campioni.
- **Il PNG con il corredo ha quattro canali, quello senza ne ha tre.** La
  composizione dell'SVG in `drawMapInfo` lascia un canale alfa costante a 255:
  l'immagine e' corretta e piu' pesante di circa un terzo. Normalizzarla vorrebbe
  dire ricodificare il PNG (circa mezzo secondo su un A4) o toccare
  `map-info.js`, che e' del Task 8: lasciato com'e'.
- **Gli header `x-wm-*` si scrivono in byte UTF-8.** Node scrive gli header in
  latin1, quindi `©` e `·` uscivano come UN byte ciascuno (`0xA9`, `0xB7`): legale
  come latin1, ma un job PHP che decodifica UTF-8 vede due byte malformati, e
  [R15](overview.md#r15) («lo shard li stampa dove preferisce senza doverli
  ricostruire») non era servita. Ora il valore si converte
  (`Buffer.from(v, 'utf8').toString('latin1')`), che e' quello che fa la maggior
  parte delle API. Scartate: RFC 8187 (obbligherebbe lo shard a decodificare) e
  l'ASCII puro `(c) OpenStreetMap` (perderebbe la forma concordata). **Il test
  guarda i byte letti dal socket**, non la stringa riletta dal client di Node: la
  conversione andata e ritorno dentro lo stesso runtime si compensa da sola e il
  difetto restava invisibile.
- **Il divieto di core dump e' scritto nell'unita' systemd**
  (`infra/pubblica-dominio.sh`: `LimitCORE=0`), che e' dove il processo gira
  oggi, insieme a `PRINT_TOKENS_PATH`. L'`ulimit -c 0` **del container** resta al
  Task 10, che il container lo crea: sono lo stesso provvedimento in due
  deployment, non uno al posto dell'altro. File fuori dall'elenco del task:
  segnalato nel report perche' non sfugga alla review.
- **Il rate limit conta anche le richieste rifiutate**, perche' sta prima della
  lettura del corpo: un chiamante che sbaglia forma non puo' usare la validazione
  come un giro gratis.

#### Fix round 1 (dopo la review indipendente)

- **Alla scadenza il rendering continua, e va contato a parte.** `run()` libera
  lo slot in un `finally` mentre il lavoro vero prosegue — non c'e' modo di
  annullare una `render()` di maplibre-native — e non esisteva nessun contatore
  dei rendering **in volo**: otto richieste in fila con `renderTimeoutMs: 50` e
  due slot davano otto `renderFrame` vivi insieme, con `freeSlots()` di nuovo a 2.
  A ~925 MB di RSS per un A4 a 300 dpi (misura del Task 1) bastano tre scadenze
  per superare i 2,5 GB chiesti al container: [R7](overview.md#r7) diventava falsa
  proprio quando [R16](overview.md#r16) scattava, e il tetto di memoria del Task
  10 non avrebbe prevenuto il guasto — avrebbe fatto uccidere il processo. Ora
  `createLimits` tiene **due** contatori, `inUse` (lo slot, chi aspetta ancora una
  risposta) e `inFlight` (il rendering vero), e finche' quelli abbandonati non
  rientrano si risponde `503`. `inFlight` cala nel `.then` del lavoro, non nel
  `finally`: il `finally` corre alla scadenza, il lavoro no. Scartata l'alternativa
  «marcare il processo come avvelenato e riciclarlo»: richiede un supervisore che
  oggi non c'e'.
- **Il `Retry-After` del `504` e' una costante**
  (`RETRY_AFTER_TIMEOUT_SECONDS = 60`), non `timeoutMs / 1000`. Il tempo massimo
  del rendering dice quanto si e' aspettato, non quando ha senso riprovare, e
  rimandare il job Horizon esattamente a 120 s lo faceva tornare mentre il
  rendering abbandonato era ancora in volo.
- **Il `400` esce solo da un `BadRequestError`.** La classe c'era ma non filtrava
  niente: il `catch` prendeva tutto e scriveva `{error: e.message}`, cosi' una
  `LineString` con 20.000 livelli di annidamento faceva esplodere la ricorsione di
  `countCoordinates` e il chiamante riceveva
  `400 {"error":"Maximum call stack size exceeded"}` — un `RangeError` interno
  consegnato come messaggio di validazione. Ora: `if (!(e instanceof
  BadRequestError)) throw e` (Express 5 lo porta al gestore degli errori, che
  risponde `500` generico e tiene il dettaglio nel log), un tetto di profondita'
  in `countCoordinates` (`MAX_COORD_DEPTH = 8`: un MultiPolygon ne usa 4), e
  `asBadRequest()` per le validazioni di `formats.js` e `fit.js`, che nominano il
  campo ma lanciano `Error` semplici — un `RangeError` o un `TypeError` passano
  oltre invece di diventare un `400`.
- **La chiave di un campo sconosciuto non si ripete piu'.** Un corpo con la chiave
  `"44.1234,10.5678"` produceva `400 {"error":"campo sconosciuto nel corpo:
  44.1234,10.5678"}` e la stessa stringa a log: una chiave puo' essere essa stessa
  un dato, e [R11](overview.md#r11) vale anche li'. Ora si elencano i campi
  **ammessi**.
- **Lo schema `Bearer` si confronta senza maiuscole** (RFC 9110): `bearer <token>`
  dava `401`.
- **Gli identificatori italiani nel codice nuovo sono passati in inglese**
  (`recenti`, `attesa`, `lavoro`, `scadenza` in `limits.js`, e quelli dei test).
  I commenti e i messaggi di log restano in italiano.
- **`infra/pubblica-dominio.sh` crea `/etc/wm-tiles` e dice come riempirlo.**
  Prima puntava a `/etc/wm-tiles/print-tokens.json` senza che niente creasse la
  cartella ne' lo dicesse all'operatore: il deploy partiva, loggava «print:
  nessun token» e rispondeva `401` a tutti. E' il fallimento sicuro voluto, ma ora
  lo script stampa il comando per creare il file con `chmod 600`.

**Le prove che mancavano.** Cinque mutazioni su undici sopravvivevano all'intera
suite: il rate limit per token reso **globale**, la validazione di `set`
disattivata, il tetto del corpo portato a 1 kB (il test del `413` mandava sempre
piu' di 2 MiB, quindi falliva con qualunque tetto: serviva l'assert complementare,
un corpo fra i 100 kB di Express e il tetto dichiarato che deve dare `200`),
`Object.hasOwn` sostituito da `in` (le chiavi del prototipo — `toString`,
`constructor` — diventavano stili), e un log del `400` con dentro
`JSON.stringify(req.body)`, perche' **nessun test guardava i log** mentre [R11](overview.md#r11)
parla di log almeno quanto di messaggi d'errore. Oggi ognuna delle cinque fa
cadere almeno un test. Coperti anche i due moduli che non avevano alcun test:
`tokens.js` (`test/print-tokens.test.js`, i sei rami piu' la promessa che
l'errore citi la **posizione** e mai il token) e `demShade`
(`test/print-dem-shade.test.js`: il livello a N - 0,585, `steps` intero e il
divisore `(steps * PIXEL_Z0) / 2**zoom`, che e' l'unica differenza vera con
`pipeline/render-png.mjs`; `grigi` si sostituisce, il resto della catena e'
quello vero).

**Debito dichiarato, non risolto qui.** La terza copia del mosaico del DEM resta
(estrarla tocca i PNG di produzione garantiti byte per byte). Il tetto del corpo
non vale per un `Content-Type` diverso da JSON: li' la difesa e' il reverse
proxy, ed e' una consegna al Task 10. La forma del corpo resta da allineare con
oc:8982.

### Task 10

- **Il container ha il codice dentro, non montato** (`Dockerfile.print`). Parte
  dalla stessa base di `pipeline/render-png.Dockerfile` — Ubuntu 22.04 e' un
  vincolo, non una scelta: il binario di maplibre-native 6.2.0 e' precompilato
  li' e cerca ICU 70 — ma l'immagine e' l'unita' di deploy, quindi `COPY` di
  `src/`, `manifest/`, `style/`, `tools/` e `npm ci --omit=dev`. **Niente
  `data/`**: il renderer legge stile, glifi, sprite, tile e DEM dal server delle
  tile via HTTP (`PRINT_BASE_URL`, e `localizza` riscrive ogni URL su quel
  server), quindi il container non ha nessun archivio e nessun DEM.
- **`fontconfig` e `fonts-dejavu-core` ci sono, e cambiano la resa.** Senza, il
  corredo (barra di scala, attribuzioni, nord), che e' un SVG composto da
  librsvg, esce a quadratini senza alcun errore. Misurato **dentro il
  container**: `fc-match sans-serif` da' DejaVu Sans (e il Bold, che la barra di
  scala usa), e il corredo si legge.
- **Le attribuzioni sporgevano dal loro riquadro di 4,1 mm, e solo nel
  container.** `textWidth` di `map-info.js` stimava 0,52 em per carattere;
  DejaVu Sans ne occupa **0,601** (misurato sull'inchiostro: 40,6 mm contro i
  35,1 mm di spazio riservato), quindi il testo usciva a sinistra del pannello,
  fuori dallo sfondo che lo rende leggibile sopra la mappa. Sul Mac, dove
  `sans-serif` e' Helvetica, sono 0,535 em: sporgeva di 1 mm e il padding del
  bordo destro lo nascondeva — per questo il difetto era invisibile fuori dal
  container, e con lui lo era il test «fuori dal riquadro non c'e' inchiostro»,
  che nel container sarebbe fallito. Fattore portato a **0,62**, che copre
  entrambi i font; il testo resta ancorato al bordo destro perche' con un font
  ancora piu' largo l'eccedenza cresca verso l'interno della pagina. File fuori
  dall'elenco del task (`src/print/map-info.js`, `test/print-map-info.test.js`):
  segnalato qui perche' non sfugga alla review.
- **La leggibilita' del testo di mappa non dipende dai font di sistema.** Nel
  container `tools/print-legibility.mjs` misura **2,53 mm** di corpo per il layer
  piu' piccolo (`road-label-track`), lo stesso numero del Task 7 sul Mac: le
  etichette della mappa sono glifi SDF serviti da `/glyphs` (Noto Sans), non font
  di sistema. DejaVu riguarda il solo corredo.
- **Il tetto di memoria e' 3 GB, non 2,5.** Nel container un A4 a 300 dpi ha
  toccato **1021 MB** di RSS contro i 925 del Task 1 sul Mac: due slot fanno
  2,04 GB, e 2,5 GB lascerebbero 460 MB per il runtime di Node, il contesto GL
  di Mesa, i buffer nativi di sharp e il PNG di uscita. E' un limite del
  CONTAINER: `--max-old-space-size` non vede niente di tutto questo.
  `memswap_limit` uguale alla memoria, o sotto pressione il kernel scambia
  invece di uccidere e un leak diventa una macchina lenta per tutti.
- **Il riciclo periodico e' un timer systemd, non compose.** Compose non sa
  schedulare: `infra/pubblica-dominio.sh` installa `wm-print-recycle.timer`
  (ogni 6 ore) e lo script che chiama. Scelto il riciclo e non un controllo di
  salute «degradato» perche' `/health` non puo' vedere `inFlight` senza una
  rotta nuova, e un controllo che rendesse davvero una pagina occuperebbe uno
  slot e 1 GB. **Residuo dichiarato:** un servizio bloccato dai rendering
  abbandonati resta tale fino al riciclo successivo, cioe' al massimo 6 ore, se
  nessuno guarda i log.
- **I due `503` adesso si distinguono nei log.** La risposta resta la stessa, ma
  `print: slot pieni` porta `freeSlots`, `inFlight` e `cause`: con `freeSlots` a
  0 il servizio e' **carico**, con slot liberi e `inFlight` pieno e' **rotto** —
  rendering scaduti che non sono mai rientrati. Dall'esterno erano, e restano,
  indistinguibili.
- **Il comando del timer sta in uno script, non nell'`ExecStart`.** systemd
  sostituisce da solo i `$VAR` dentro un `ExecStart`: un `$C` o un `$(...)`
  scritti li' arrivano a `sh` gia' svuotati, e il riciclo sarebbe fallito in
  silenzio.
- **Il codice da cui gira il container e' una copia separata**
  (`/srv/wm-print`), non `/srv/wm-tiles`: un `git checkout` la' cambierebbe i
  file sotto il server delle tile, che e' vivo, ed e' esattamente l'errore che
  il `CLAUDE.md` vieta.
- **Il processo delle tile non monta nemmeno il router di stampa.**
  `pubblica-dominio.sh` non mette `PRINT_TOKENS_PATH` nell'unita' systemd: il
  file lo monta il container. Dal fix round 1 quella variabile decide anche se
  il router ESISTE (`src/server.js`): senza, `/v1/print/map` risponde **404**.
  Prima il router c'era sempre e mancava solo l'autenticazione, quindi [R6](overview.md#r6) valeva
  per configurazione e non per costruzione — la review ha avviato
  `src/server.js` con la variabile impostata e ha ottenuto un PNG in-process.
  Da fuori quel percorso Caddy lo manda comunque al container.
- **Il tetto del corpo per i `Content-Type` non JSON e' nel site block**, come
  il Task 9 aveva lasciato in consegna: `request_body { max_size 2MiB }` dentro
  `handle /v1/print/*`. Verificato davvero con Caddy 2.11.7 e un backend che
  legge il corpo: 3 MB `text/plain` -> `413`, 1 MB -> `200`, e gli altri percorsi
  non sono toccati. Non e' un rifiuto anticipato ma un tetto a cio' che il
  processo PUO' leggere, che e' la difesa che serviva.
- **La rete del container e' `host`.** Il server delle tile ascolta solo su
  127.0.0.1:8080: dalla rete bridge quell'indirizzo non si raggiunge, e aprirlo
  al bridge sarebbe esporlo. Sul Mac Docker Desktop la rete host **non**
  raggiunge il loopback dell'host (verificato: connection refused, mentre dal
  bridge con `host-gateway` risponde), quindi `compose.yml` tiene il modo in una
  variabile e il collaudo locale passa dal bridge. In produzione, su Linux, e'
  la stessa rete che usa gia' `pipeline/render-png-docker.sh`.
- **Il deploy non parte da solo.** `.github/workflows/print.yml` costruisce
  l'immagine a ogni push (e controlla, dentro l'immagine, che il modulo nativo si
  carichi e che DejaVu ci sia: un cambio di base si vedrebbe altrimenti solo al
  primo rendering in produzione), ma il deploy e' `workflow_dispatch`. Un push su
  main non deve riavviare un servizio in produzione. L'immagine si costruisce
  **sull'host** invece di passare per un registry, come il repo fa gia' per il
  renderer dei PNG; host, utente, chiave e chiave d'host stanno nei secret,
  perche' il repo e' pubblico.

#### Fix round 1 (24 novembre 2026)

- **`stop_grace_period` da solo non faceva NIENTE, e tre posti affermavano il
  contrario.** Il SIGTERM non arrivava mai a Node: `grep -rn SIGTERM src/` dava
  zero, e node era il **nipote** di tini, non il figlio — l'entrypoint faceva
  `exec xvfb-run`, e tini segnala solo il proprio figlio diretto, che era lo
  script di shell di `xvfb-run`. `docker stop -t 20` tornava in zero secondi e
  `docker compose restart print` durava 3 s invece dei 150 dichiarati,
  troncando i rendering in volo. La cura e' in due pezzi, e servono **entrambi**:
  l'entrypoint avvia **Xvfb in background** e poi fa `exec node` (verificato con
  `docker exec ... ps`: node e' PID 7 con PPID 1, cioe' figlio diretto di tini),
  e `src/server.js` ha `spegnimentoMite`, che chiude l'ascolto — comprese le
  connessioni keep-alive inattive, altrimenti `close()` non ritorna mai — e poi
  aspetta che `inFlight` torni a zero. Misurato dopo: con un A4 in volo,
  `docker stop -t 60` dura **2,37 s**, il log segna `inFlight: 1` all'arrivo del
  segnale, il client riceve il PNG **completo** (200, 4.559.619 byte) e il
  container esce 0. Senza rendering in volo esce in 0,21 s.
  `test/print-spegnimento.test.js` sorveglia il gestore; che il segnale arrivi
  dipende dall'albero dei processi e si misura solo con `docker stop`.
- **Il Caddyfile si scriveva prima di essere validato.** Con `set -e` una
  validazione fallita lasciava sul disco un Caddyfile rotto e non ricaricava:
  il Caddy vivo continuava a servire dalla memoria, ma il primo riavvio o reboot
  avrebbe portato giu' **tutti i siti dell'host**, wm-routing compreso. Ora si
  scrive su `Caddyfile.nuovo`, si valida **quello** e solo se e' valido si fa
  `mv` (atomico, stessa partizione). Provato introducendo un errore di sintassi
  apposta: lo script esce 1, il file buono resta identico (stesso sha1) e ancora
  valido, e quello rifiutato resta sul disco per essere guardato.
- **`POST /v1/print` senza barra finale scavalcava il blocco** e finiva al server
  delle tile. Ora il matcher e' `@print path /v1/print /v1/print/*`. Provato con
  Caddy 2.11.7 e due backend veri: `/v1/print` e `/v1/print/map` vanno alla
  stampa, `/v1/printx` e `/manifest` alle tile.
- **Il fattore unico di larghezza del testo non copriva il NERETTO.** Letti gli
  avanzamenti veri (tabella `hmtx`, non l'inchiostro) dentro il container:
  DejaVu Sans 0,5625 em per carattere sulla riga delle attribuzioni, ma **DejaVu
  Sans Bold arriva a 0,6955** sulle stringhe corte di cifre («500 m», «250 m»),
  ed e' il font delle etichette della barra di scala (`font-weight="bold"`). Due
  fattori quindi: 0,62 per il chiaro, **0,70** per il neretto. Misurato il
  margine fra l'inchiostro dell'ultima etichetta e il bordo del suo riquadro
  (300 dpi, `pad` = 1,50 mm): con 0,70 **1,86 mm**, con 0,62 1,27 mm, con 0,52
  0,51 mm; sul Mac, con Helvetica, 2,79 mm. Il `pad` assorbiva la sottostima per
  fortuna, non per progetto.
- **La suite gira dentro l'immagine, nel workflow.** Era il rilievo piu' grave:
  la regressione che questo task ha corretto non era sorvegliata da nessuna
  parte. `npm test` non girava in CI, e il difetto del font **non e' visibile
  sul Mac** — riportandolo nel sorgente, sul Mac passano 35 test su 35 mentre
  nell'immagine il nuovo test fallisce (`expected 15 to be greater than or equal
  to 17.7`). `Dockerfile.print` ha ora uno stage `test` (non l'ultimo, cosi' un
  `docker build` senza `--target` produce ancora l'immagine di produzione) con
  `npm ci --include=dev` — esplicito, perche' la base dichiara
  `NODE_ENV=production` e con quella npm salta le devDependencies e lo stage si
  costruiva senza vitest. Nel container girano **286 test su 289** (3 skip):
  si escludono `style-per-renderer`, `dem-versione` e `png-identity`, che
  chiedono `data/` o un server acceso, cose che il container per progetto non
  ha.
- **L'immagine ha un tag, e la precedente resta.** `image: wm-tiles-print:${PRINT_TAG:-latest}`;
  il deploy scrive `PRINT_TAG=<sha>` in `/srv/wm-print/.env`, che compose legge
  da solo, e tiene il valore di prima in `.env.precedente`. Senza, ogni
  `--build` sovrascriveva `:latest` e la versione precedente restava senza nome:
  se la nuova fosse partita rotta non ci sarebbe stato niente a cui tornare. Il
  passo di salute stampa il comando esatto per tornare indietro, ma non lo
  esegue: un rollback automatico su un avvio solo lento e' peggio del guasto.
  **`docker image prune` sull'host cancella quella via di ritorno.**
- **Il deploy ora e' legato a `main`** (`github.ref == 'refs/heads/main'`): un
  `workflow_dispatch` si puo' lanciare da qualunque ref. La **chiave d'host**
  arriva da un secret (`PRINT_SSH_KNOWN_HOSTS`) invece che da `ssh-keyscan`, che
  era TOFU a ogni giro con stderr buttato: un dirottamento del DNS al momento
  del deploy avrebbe ricevuto la chiave privata. Lo script remoto passa da
  `bash -s` perche' `set -euo pipefail` e' bash e su un host con `dash` il
  deploy falliva con un errore opaco. Aggiunti `permissions: contents: read`, il
  controllo `fc-match sans-serif:bold` (la barra di scala usa quello) e la porta
  del controllo di salute letta da `.env` invece che inchiodata a 8081.
  L'`environment` si chiama ora `production`, in inglese come gli altri
  identificatori nuovi.
- **C'e' un `.dockerignore`.** Con BuildKit il contesto e' gia' 62 kB, ma con
  `DOCKER_BUILDKIT=0` il client spedirebbe al demone la cartella intera, cioe'
  43 GB di `data/`.

**Il container reso misurato** (Mac, arm64, cella di Pisa, con il server delle
tile sull'host): `tools/page-cost.mjs` A4 300 dpi 3234 ms al centro
dell'Appennino e 5229 ms su Pisa, contro i 3928 ms dello stesso comando
sull'host — circa un terzo piu' lento, che e' Mesa llvmpipe dentro la VM di
Docker Desktop, e comunque un sesto dei 30 s del criterio. `POST /v1/print/map`
dal container: `200`, PNG 2480x3508 in 4,4 s, con gli header `x-wm-*` giusti.

### Task 11

- **La finta non e' un secondo servizio: e' il router vero con il rendering
  sostituito.** `fakePrintApp()` monta `printRouter({renderFrame: fakeFrame,
  getStyle: <stile minimo>, shadeFactory: null})`, quindi token, limite al
  minuto, slot, tempo massimo, codici di stato e header del corredo sono quelli
  di produzione, non una loro imitazione. `fakePrint(body)`, la via per un test
  in JavaScript, condivide `parseRequest` e `fitBounds`. **Non e' servito
  toccare `src/print/route.js`:** `parseRequest` era gia' esportata, e con lei
  `fitBounds`, `pageSize` e `PAGE_FORMATS`. L'unica validazione che la finta
  deve rifare e' il **tetto del corpo**, che nel servizio vero applica
  `express.json` e che in una chiamata di funzione non esiste: senza quel
  controllo la finta avrebbe accettato una richiesta che il servizio rifiuta con
  `413`.
- **Il test di parita' e' piu' forte del test di rifiuto.** Non basta che la
  finta rifiuti: diciotto richieste cattive vanno sia al `printRouter` vero
  (con il rendering sostituito) sia a `fakePrint`, e il test pretende lo stesso
  `400` **e lo stesso messaggio**. Cosi' una validazione che divergesse — un
  campo aggiunto alla rotta e non alla finta — fa cadere il test invece di
  restare scoperta fino alla produzione. C'e' anche l'assert di [R11](overview.md#r11) sui
  messaggi della finta: nessuno riporta le coordinate ricevute.
- **`removeAlpha()` dopo la composizione dell'SVG, o il frame ha 4 canali.** La
  pagina finta scrive le dimensioni con un SVG composto da sharp, e la
  composizione aggiunge il canale alfa: senza toglierlo il frame non ha i pixel
  che la rotta si aspetta e il controllo di [R17](overview.md#r17) (`rgb.length !== w*h*3`) lo
  rifiuta. Il difetto sarebbe uscito come «il frame non ha i pixel della
  pagina», cioe' come un guasto del renderer.
- **La pagina finta ha le diagonali e la scritta, non e' grigia e basta.** Una
  pagina uniforme, dentro una scheda PDF, sembra un rendering riuscito e vuoto:
  chi la vede deve capire al primo sguardo che e' la finta. Costo: un quarto di
  secondo per un A4 a 300 dpi, contro i 3-5,2 s del rendering vero.
- **Il token della finta non e' nel codice** (il repo e' pubblico): arriva da
  `PRINT_FAKE_TOKEN` e, se manca, se ne genera uno a caso a ogni avvio e lo si
  stampa. E' lo stesso gesto del servizio vero, dove il token sta in un file
  fuori dal repo; un token di esempio plausibile, scritto qui, prima o poi
  verrebbe copiato da qualcuno che lo crede valido.
- **`GET /health` anche sulla finta**, stesso percorso e stessa forma del
  servizio vero, con in piu' `fake: true`: lo shard punta li' il suo controllo
  di salute senza cambiare codice, e un test capisce con chi sta parlando.
- **La procedura (`docs/howto/stampa-mappe.md`) dichiara la forma del corpo come
  PROPOSTA.** Non e' una cautela retorica: l'allineamento con oc:8982 e' il
  debito aperto dal Task 9, e il documento lo mette in evidenza come prima cosa
  da confermare o cambiare, con la ragione (nessun campo e' in produzione, quindi
  cambiarlo adesso non costa niente).
- **Le cinque sorprese documentate sono quelle misurate, non quelle immaginate**:
  la scala che esce dall'inquadratura (tabella misurata: 10 km -> 1:35.600,
  12 km -> 1:42.700, cioe' un sentiero medio su un A4 viene circa 1:40.000 e non
  1:25.000); `mapInfo` acceso di serie e gli header `x-wm-*` presenti comunque;
  i due `503` indistinguibili dal di fuori e il `Retry-After` da rispettare;
  3-5,2 s e circa 1 GB per pagina con 2 slot, cioe' non un endpoint sincrono; le
  proprieta' di disegno dentro il GeoJSON (simplestyle-spec) e tutto il resto
  delle `properties` scartato.
- **Lo step 6 del brief (il commit) non e' stato eseguito**, come da istruzione:
  il primo commit lo fa il dev.

#### Task 11, giro di correzioni dopo la review

- **Una `GeometryCollection` aggirava il tetto delle coordinate, e il difetto
  era nel servizio VERO.** `countCoordinates` legge `f.geometry.coordinates`,
  che una `GeometryCollection` non ha — le sue geometrie stanno in `geometries`
  — quindi il conto tornava 0 e la review ha fatto passare **200.000
  coordinate** in un corpo sotto il tetto di byte. **Scelta: si rifiuta**, con
  un `400` che nomina il campo, invece di contare anche `geometries`
  ricorsivamente. Le ragioni, nell'ordine: nessuno shard ne ha bisogno (una
  traccia e' una `LineString`, un waypoint un `Point`: una Feature per
  geometria); e' un tipo annidabile dentro se' stesso, cioe' una seconda via di
  ricorsione da limitare accanto a `MAX_COORD_DEPTH`; ed e' la strada gia'
  presa per l'antimeridiano — si rifiuta invece di indovinare. Da li' i tipi di
  geometria sono una **mappa chiusa** (`GEOMETRY_TYPES`) come quella degli
  stili: un `type` che non e' uno dei sei semplici e' `400` e non piu' un
  errore di `fitBounds`. Nasce nel Task 4/9, chiuso qui.
- **Un test di parita' NON puo' vedere una fuga di dati**: le due parti
  eseguono lo stesso codice, quindi se la rotta riporta il valore ricevuto lo
  riporta anche la finta e il confronto resta verde. L'assert di [R11](overview.md#r11) cercava
  tre letterali scritti a mano (`179.9`, `10.12`, `44.08`) e la review l'ha
  dimostrato facendo restituire al chiamante
  `http://169.254.169.254/latest/meta-data/` senza che nessuno dei 12 test
  cadesse. Ora i valori vietati si **ricavano dal corpo**: le coordinate
  (sempre) piu' i valori e le chiavi che quel corpo INTRODUCE rispetto a quello
  valido, tolto il vocabolario dell'interfaccia (tipi GeoJSON, formati,
  orientamenti, stili), che un messaggio puo' legittimamente nominare. Lo
  stesso controllo gira anche sulla RISPOSTA del servizio vero. Rifatta la
  mutazione, cadono due test e il messaggio nomina il valore sfuggito.
- **Il tetto del corpo di `fakePrint` e' un limite INFERIORE, e ora lo
  dichiara.** La funzione riceve un oggetto gia' deserializzato e puo' misurare
  solo la ri-serializzazione **minificata**, mentre il servizio conta i byte sul
  filo: misurata la stessa richiesta, 748.840 byte compatta e 5.069.090
  indentata, cioe' `200` dalla finta e `413` in produzione. Non si e' aggiunta
  l'opzione «passami il testo crudo» (una terza via d'ingresso che nessuno
  userebbe): si e' scritto il limite nel docstring e nella procedura, con il
  rimando a `fakePrintApp()`, dove il 413 lo da' `express.json` del router vero.
- **Il confronto fra `import.meta.url` e `file://` piu' `process.argv[1]` non e' un controllo
  affidabile**, ed era il punto d'ingresso documentato per i dev degli shard:
  con uno **spazio** nel percorso un lato percent-codifica e l'altro no, e il
  processo usciva 0 senza output e senza server. Verificato anche il caso del
  **symlink**, che la forma di `tools/png-identity.mjs` (`resolve` sui due lati)
  NON risolve: Node realpatha il modulo ma non `argv[1]`, e lanciando un symlink
  alla finta non partiva niente. Serve `realpathSync` su entrambi i lati
  (`lanciatoComeProgramma()`); provato in una cartella con lo spazio e passando
  da un symlink, parte e risponde a `/health`.
- **La finta era piu' larga della produzione in due punti**, e tutti e due
  spostavano il difetto in deploy: `rpm = 600` contro `DEFAULT_RPM = 30` (ora e'
  `DEFAULT_RPM`, con `PRINT_FAKE_RPM` per alzarlo in una suite lunga) e nessun
  minimo sul token, mentre `loadTokens` ne impone 24 caratteri — un token di sei
  funzionava contro la finta e faceva **fallire l'avvio** del servizio vero. Ora
  la finta rifiuta di partire e lo dice in una riga, senza stack.
- **Tre messaggi divergevano su un corpo non-oggetto**: `null`, `"ciao"` e `7`
  danno «corpo non valido: atteso JSON» dal servizio (`express.json` e' in modo
  strict) e davano «il corpo deve essere un oggetto JSON» dalla finta. Nel
  confronto non c'era nessun corpo scalare: ora ci sono tutti e tre, e vanno
  mandati come TESTO JSON perche' superagent, se gli si passa un numero, cambia
  il tipo del contenuto e la richiesta non arriva mai a `express.json`.
- **Nessun test guardava i pixel della finta.** Il controllo di [R17](overview.md#r17) della rotta
  (`rgb.length !== w*h*3`) non copre `fakePrint`, che non passa dal router:
  togliendo `removeAlpha()`, `fakePrintApp` rispondeva 502 mentre `fakePrint`
  restituiva in silenzio una pagina con il contenuto slittato. Si becca dai
  pixel, e l'assert buono non e' la media ma il fatto che la pagina finta e'
  **grigia**: carta 232, cornice `#bdbdbd`, scritte `#8a8a8a`, corredo `#1a1a1a`
  su bianco, quindi i tre canali di colore devono coincidere **esattamente**
  (media 230,47; con la mutazione 236,3 e i canali diversi fra loro).
- **La tabella delle scale era il caso MIGLIORE, non il peggiore: la
  preoccupazione 4 del report era rovesciata.** Su un A4 **verticale** il lato
  corto e' l'orizzontale, quindi una traccia est-ovest sta a un denominatore
  fino a **~1,45 volte** quello della stessa estensione nord-sud: 10 km danno
  1:35.615 nord-sud e **1:51.531** est-ovest, 20 km danno 1:71.230 e
  **1:103.063**. Di conseguenza il «circa 6-7 km a 1:25.000» valeva per il
  nord-sud (7,03 km) e sbagliava di circa il 30% nell'altro verso (4,85 km). La
  tabella ora e' marcata come misurata nord-sud, con la colonna est-ovest
  accanto. Corretto anche il 5 km: **1:20.300**, non 1:20.400 (misurato
  1:20.287; le altre righe coincidevano).
- **La procedura non portava a una chiamata funzionante**: mancavano come
  rendere eseguibile la finta (clone, `npm ci`, Node 18 o 20 — il container usa
  20.18.1) e un `curl` da copiare e incollare. Aggiunti e **provati dall'inizio
  su questa macchina**: la finta parte, il `curl` scrive un PNG 2480x3508 e
  stampa `1:20703`, `300` e l'attribuzione.
- **La procedura ora e' citata**: riga in `docs/README.md` (tabella e diagramma)
  e in `CLAUDE.md`, sotto «Documentazione della feature». Prima la nominavano
  solo il piano e queste note, cioe' nessuno che non stesse gia' leggendo il
  ticket.

### Task 12

Il task aggiunto dal dev (vedi [Follow-up / Task 12](#task-12) per il perche' e
per la decisione architetturale, che non e' dell'implementatore).

- **Lo schema e' `openapi.json`, non `openapi.yaml`.** Il piano diceva YAML; un
  YAML lo si deve PARSARE per validarci contro, e in questo repo non c'e' un
  parser YAML fra le dipendenze. Metterne uno a runtime per leggere un file che
  si puo' scrivere in JSON e' una dipendenza in piu' sul percorso della
  validazione di una rotta pubblica, cioe' il contrario di quello che il task
  chiede. In JSON il documento si legge con `JSON.parse`, si serve cosi' com'e' e
  Ajv lo compila senza trasformazioni: **il file che sta nel repo e il file
  contro cui si valida sono lo stesso byte per byte.** Chi preferisce il YAML lo
  ottiene con `redocly bundle`, dall'esterno.
- **La validazione e' `src/print/schema.js`**, che compila con Ajv (versione
  **esatta**, `ajv@8.17.1`, build `2020` perche' OpenAPI 3.1 e' JSON Schema
  2020-12) lo schema `#/components/schemas/PrintMapRequest` preso dal documento
  intero. Ajv gira con `strict: false` — `openapi`, `paths`, `info` e le
  estensioni `x-wm-*` non sono parole chiave di JSON Schema — e con
  `useDefaults: false`: i valori di serie NON si scrivono nel corpo ricevuto,
  perche' `parseRequest` deve distinguere un campo assente da un campo uguale al
  suo default (`padding` il suo lo ricava dal dpi).
- **I messaggi di Ajv non escono mai**, ed e' il punto fragile del task: ogni
  errore di Ajv riporta il percorso dei DATI e in certi casi il valore. Qui
  l'errore si traduce in una tabella di messaggi per PERCORSO DEL CAMPO
  (`MESSAGES`), con dentro solo i numeri e gli elenchi letti dallo schema. Il
  valore ricevuto si puo' guardare — serve a distinguere una
  `GeometryCollection` da un tipo inventato — ma non riportare. I messaggi sono
  gli STESSI di prima, parola per parola: i 43 test della rotta e la parita' con
  la finta sono la rete del task, e un messaggio riscritto non sarebbe una
  validazione piu' giusta, solo una garanzia persa.
- **Un errore senza traduzione viene contato, non nascosto.** `unmappedErrors()`
  conta i casi in cui la tabella non ha un messaggio (la risposta nomina allora
  il solo campo); `test/print-openapi.test.js` viola uno per uno tutti i vincoli
  dello schema e pretende che il conto resti **zero**. E' la forma locale della
  regola del repo: il codice si ferma rumorosamente quando incontra qualcosa che
  non sa mappare.
- **I numeri hanno smesso di essere in due posti.** `limits.js` non li dichiara
  piu': li legge da `x-wm-limits` e dai vincoli dello schema (`LIMITS` in
  `schema.js`) e si limita a dar loro il nome con cui il codice li usa. Lo stesso
  `MIN_TOKEN_LENGTH` di `tokens.js`, che ora viene da
  `securitySchemes.shardToken.x-wm-min-token-length`. Nessun valore e' cambiato:
  corpo 2 MiB, dpi 72-600, `maxZoom` 0-19, `stroke-width` fino a 40, `set` 12
  esadecimali, 2 slot, 120 s, 30 richieste al minuto, token da 24 caratteri.
- **Tre regole JSON Schema non le esprime**, e stanno in
  `x-wm-regole-aggiuntive` con il numero che usano: il totale delle coordinate
  (e' una somma su TUTTE le feature), i pixel della pagina (dipendono da formato,
  orientamento e dpi presi insieme — per questo `dpi: 600` e' dichiarato ammesso
  ma su ogni formato sfora il tetto dei pixel) e l'inquadratura (antimeridiano,
  `padding` che non lascia area utile). Le applica `parseRequest` subito dopo la
  validazione, con gli stessi `400`. Il test non si limita a controllare che
  siano scritte: **verifica che siano vere**, perche' una regola dichiarata e non
  applicata e' esattamente il danno che il task voleva evitare.
- **La profondita' delle coordinate e' nello schema**, come catena
  `CoordinatesDepth1` … `CoordinatesDepth8`: otto livelli, l'ultimo dei quali
  rifiuta gli array. Non e' elegante — JSON Schema non sa dire «al massimo N
  livelli» — ma e' l'unico modo di mettere nel documento un tetto che prima
  esisteva solo nel codice, e la lunghezza della catena E' `MAX_COORD_DEPTH` (il
  test pretende che coincida con `x-wm-limits.maxCoordDepth`). Il controllo di
  ricorsione in `countCoordinates` resta come seconda serratura: se la catena si
  accorciasse, il conteggio non deve tornare a essere un `RangeError` che esce
  come messaggio di validazione.
- **Lo schema vincola la profondita', non la forma per tipo.** Un `Point` con le
  coordinate di un `Polygon` passa la validazione e lo rifiuta `fitBounds`, come
  prima: scriverlo per tipo (`if/then` su `type`) sarebbe piu' bello nel
  documento ma cambierebbe quale errore riceve il chiamante, e i test di oggi
  descrivono quello.
- **`/v1/print/openapi.json` e `/v1/print/docs` stanno PRIMA
  dell'autenticazione.** E' il documento che si manda a chi deve ancora scrivere
  il chiamante: chiederglielo con un token che non ha sarebbe un giro a vuoto.
  Non contiene segreti — e' lo stesso file del repo pubblico — e il test
  controlla che non ci sia dentro nessuna stringa che somigli a un token, perche'
  un esempio plausibile prima o poi viene copiato da qualcuno che lo crede
  valido. Vivono dentro il router di stampa, quindi sul processo che serve le
  tile (senza `PRINT_TOKENS_PATH`) non esistono: e' la stessa costruzione di
  [R6](overview.md#r6), non una dimenticanza.
- **La pagina di lettura non aggiunge dipendenze**: `src/print/docs.html` prende
  Redoc da jsDelivr a **versione esatta** e chiede il documento per percorso
  RELATIVO, cosi' funziona ovunque il router sia montato. Se la CDN non si
  raggiunge, la pagina lo dice e rimanda a `openapi.json`, che e' il documento
  vero. Nessun pacchetto npm per la UI, come chiesto.
- **Nessuno dei 43 test della rotta e' stato modificato**, ne' i 19 della finta:
  la sostituzione della validazione si e' chiusa con i test di prima tutti verdi,
  compresi quelli che la review aveva aggiunto (chiavi del prototipo, ricorsione,
  `GeometryCollection`, byte UTF-8, limite per token, log senza coordinate).
  L'unico scostamento di comportamento noto e' l'ORDINE in cui due difetti
  insieme vengono segnalati: prima un campo sconosciuto nel corpo vinceva su un
  campo obbligatorio mancante, con Ajv e' il contrario (`required` si valuta
  prima di `additionalProperties`). Restano entrambi `400` con un messaggio che
  nomina solo il campo, la finta e la rotta restano in parita', e nessun test
  descriveva quell'ordine.

## Bug trovati

### 2026-11-23 — i PNG non sono identici byte per byte nemmeno ai livelli interi

Il `CLAUDE.md` afferma che ai livelli interi i PNG sono identici byte per byte. La
misura lo smentisce: rendendo piu' volte la stessa tile con `pipeline/render-png.mjs`,
la 13/4334/2986 esce con quattro varianti ricorrenti e intermittenti; confrontate pixel
per pixel, due varianti differiscono in 1 pixel su 65.536, di al massimo 1 livello.
Viste anche sulla 14/8668/5972; la 15/17335/11944 e la 16/34672/23888 sono stabili.
Non e' la compressione parallela di libvips (`VIPS_CONCURRENCY=1` non le elimina) ne'
l'ombra (i grigi sono identici fra le rese): il buffer del "sopra" (curve ed etichette)
di maplibre-native cambia da una resa all'altra. Conseguenza: il gate del Task 2
(`tools/png-identity.mjs`) confronta i pixel con una soglia dichiarata (8 pixel, delta 1),
non i byte. Il `CLAUDE.md` non e' stato toccato.

## Decisioni

### 2026-11-23 — fattore tipografico 3,2 a ratio 0,5, zoom 15 (Task 7)
- **Decide:** dev, sui numeri misurati dall'agente con `tools/print-legibility.mjs` (A4, 300 dpi, Monte Serra `10.55,43.78`)
- **Valori:** `PIXEL_RATIO` **0,5** (invariato), `typeScale` **3,2**, zoom cartografico **15**. Il testo
  piu' piccolo esce **2,53 mm** di corpo (gate a 2,5 mm: ok).
- **Perche' non ratio 1 con 1,6:** a ratio 1 `renderFrame` disegna a `zm = zoom - 1` e carica le tile
  z14 ingrandite 2x (richieste: z14 e z13, nessuna z15). Le soglie e i dati di z15 non
  entrano, e la pagina esce senza i nomi che a quella scala servono. Stessa area, stesso
  millimetraggio (1,6 x 2 = 3,2), componenti di testo per layer, ratio 1 contro ratio 0,5:
  `place-minor` 0 contro 59, `waterway-label-stream` 0 contro 58, `road-label-minor` 0
  contro 51, `road-label-track` 0 contro 14. Su una carta escursionistica i sentieri sono il
  prodotto: una pagina che non li nomina non e' una versione piu' leggera, e' un'altra cosa.
- **Costo accettato:** circa il doppio di richieste (570 contro 1226-1408), circa il 30% di memoria
  in piu' (378 contro 496 MB), 0,6 contro 0,7 s: trascurabile per un job in coda.
- **Effetti:** `typeScale` moltiplica anche tratti e icone (traccia di default 0,68 mm a typeScale 1,
  1,08 mm equivalenti a ratio 1 con 1,6): restano in proporzione.
- **Sprite:** maplibre-native chiede l'1x anche a ratio 0,5 e non sceglie mai l'`@3x`; per la stampa
  lo stile deve avere `sprite` = `<sprite>@3x`. A 3,2 volte la dimensione nominale l'icona chiede 1,07
  volte i pixel dell'@3x: nitida, un @4x non serve (Task 9).

### 2026-11-23 — niente tag su Orchestrator
- **Decide:** dev
- **Perche':** richiesta esplicita («procedi senza tag»), sia per i tag di
  ambiente sia per quelli di contenuto. Lo script `tag-candidati.sh` non e' stato
  eseguito.

### 2026-11-23 — stima saltata
- **Decide:** dev
- **Perche':** richiesta esplicita a stima prodotta. L'agente aveva dato
  **1,22 h misurate di pianificazione + 9,4 h stimate = 10,6 h**, con confidenza
  bassa per via del buffer di novita' (container di rendering, pagina a 300 dpi e
  rotta in scrittura sono prime volte nel repo) e del costo del render non ancora
  misurato. `estimated_hours` su Orchestrator resta vuoto.

### 2026-11-23 — attribuzione in forma breve
- **Decide:** dev
- **Perche':** delle cinque costanti di attribuzione del server si usano solo
  `ATTRIBUTION` e `ATTRIBUTION_WM`, e la prima in forma breve, «© OpenStreetMap».
- **Scartato:** la forma estesa «© OpenStreetMap contributors» con il riferimento
  alla licenza, che e' quella chiesta dalle linee guida di OSM. Segnalato al dev,
  che ha scelto comunque la forma breve.

### 2026-11-23 — il `set` dei layer lo manda lo shard
- **Decide:** dev
- **Perche':** simmetria con l'endpoint delle tile, dove il `set` arriva libero
  dalla query (`src/server.js:430`).
- **Scartato:** legare il `set` al token, cosi' che un token non possa chiedere
  gruppi di layer che non gli spettano. Il rischio — un token valido ottiene una
  stampa con dentro layer fuori contratto — e' scritto nei rischi dell'overview
  come accettato.

### 2026-11-23 — rate limit nel servizio, non in Caddy
- **Decide:** agente, confermato dal dev
- **Perche':** verificato sull'host che Caddy e' la 2.11.7 dei pacchetti senza
  alcun modulo `rate_limit` (`caddy list-modules`). Metterlo in Caddy
  richiederebbe un binario ricompilato con `xcaddy`, che serve anche i siti di
  wm-routing e che un aggiornamento di sistema rimetterebbe com'era, spegnendo il
  limite in silenzio. Un limite per token e' anche piu' utile di uno per
  indirizzo.

### 2026-11-23 — il rilievo c'e' dal primo giro
- **Decide:** dev
- **Perche':** scelto di generalizzare `src/raster/ombra.js` da frame quadrato a
  rettangolare subito, invece di consegnare una prima versione senza
  ombreggiatura.
- **Scartato:** mappa stampata senza rilievo nel primo giro, per non toccare
  codice che produce i PNG di produzione. Mitigazione adottata: il gate di
  identita' byte (Task 2) precede la modifica (Task 3).

### 2026-11-23 — criterio di accettazione del costo di un A4 a 300 dpi
- **Decide:** agente (Task 1), scritto prima di misurare
- **Criterio:** un A4 a 300 dpi (2480x3508) si rende **sotto i 30 s**, con un
  picco di RSS **sotto 2 GB**, e con il testo piu' piccolo **non inferiore a
  2,5 mm** sulla carta.
- **Perche' prima:** scriverlo prima serve a non far diventare il numero che
  esce il metro di se stesso. Se la misura non ci sta si scende di dpi
  (300 -> 250 -> 200) dichiarando di quanto e perche'; sotto i 200 si esce da
  WEBSITE-21 e lo decide il dev.

### 2026-11-23 — misura del costo di un A4 a 300 dpi (Task 1)
- **Decide:** da decidere (controller e dev): la misura rispetta tempo e
  memoria ma NON il testo, e il criterio sopra non e' stato toccato.
- **Misura** (`tools/page-cost.mjs`, 2480x3508, ratio 2, z14, centro
  10,55,43,78 sulla cella di Pisa, Mac, tre giri a caldo): 3,2-3,3 s, picco
  RSS 920-930 MB, PNG 9,2 MB. Senza ombra 0,7 s e 5,9 MB. L'ombra (quote,
  `grigi`, `componi`) e' il costo dominante: circa 2,6 s, resa su un quadrato
  3508x3508 invece che 2480x3508, quindi sovrastimata di circa il 40%.
- **Testo:** il piu' piccolo dello stile a z14 e' 10 px di stile, che a ratio 2
  sono 20 px = 1,7 mm di corpo a 300 dpi (altezza delle maiuscole circa 1,2 mm).
  Non raggiunge i 2,5 mm. Per 2,5 mm serve il doppio di ingrandimento
  (ratio 4 dal livello precedente: stessa estensione a terra, z13 ratio 4, testo
  40 px = 3,4 mm), con il contenuto di z13 invece di quello di z14.
- **Soglia di dpi:** non scelta qui; il dpi non risolve il testo (e' una
  questione di scala e di livello), e il tempo e la memoria stanno nel criterio
  con ampio margine.

## Follow-up

- **Refactor dei nomi italiani nel codice.** Sono 125 identificatori unici di
  primo livello su 98 file JS, di cui oltre la meta' italiani o ibridi
  (`adattaStile`, `componi`, `grigi`, `sfoca`, `quoteVista`, `coloreAlPixel`,
  `grigioPendenza`, `inchiostro`, …). **Il ticket lo apre il dev**, in un'altra
  sessione: non rinominare di propria iniziativa. Il criterio di correttezza di
  quel lavoro sara' «i PNG non cambiano di un byte e i test passano», quindi va
  tenuto fuori da ogni diff che modifichi anche il comportamento. In oc:9011 vale
  la regola intermedia: ogni nome **nuovo** in inglese, anche dentro file che
  hanno nomi italiani.
- **La soglia minima di dpi sotto la quale si esce dal capitolato** (WEBSITE-21
  chiede 300 dpi) non e' ancora scritta: va fissata nel Task 1, prima della
  misura.
- **La mappa d'insieme a 1:25.000 non contiene un sentiero di 14 km** su un A4:
  o si scende di scala o servono piu' fogli. Da verificare durante il Task 1, non
  deciso.

### Task 12

Task **aggiunto dal dev** il 24 novembre 2026, a undici task chiusi e prima del
primo commit: «voglio che sia fatto adesso in questo rilascio». Non e' nel piano
approvato il 23 novembre, quindi il piano diverge dalla versione approvata di un
task intero.

**Perche' non e' decorativo:** il debito aperto della feature e' che la forma del
corpo non e' mai stata concordata con lo shard di [oc:8982](https://orchestrator.maphub.it/resources/developer-stories/8982).
Uno schema OpenAPI e' cio' che si manda a quel dev al posto di una sezione di
prosa, e che si puo' validare dalle due parti.

**Decisione presa dal controller, non dall'implementatore:** lo schema **e'** la
validazione, non un secondo posto che descrive le stesse regole. In questo repo
la seconda strada ha gia' prodotto danni misurati — il CLAUDE.md affermava «i PNG
sono identici byte per byte» mentre `tools/png-identity.mjs` lo smentisce, e
`docs/README.md` dice «renderer raster: non ancora» mentre `pipeline/render-png.mjs`
esiste da mesi. Uno schema scollegato diventa la stessa cosa, con l'aggravante
che il dev dello shard ci crede.

**Il rischio dichiarato in partenza:** i messaggi di Ajv contengono i valori e i
percorsi dei dati ricevuti, e [R11](overview.md#r11) vieta che un valore del
chiamante torni in un messaggio. La traduzione dell'errore nel solo percorso del
campo e' un requisito del task, non un dettaglio di stile.

#### Task 12, giro di correzioni dopo la review

La review ha approvato con riserva: [R10](overview.md#r10) ha retto a 46 corpi
ostili e [R11](overview.md#r11) a un fuzz di 29 corpi con marcatore, zero fughe,
e i 62 test di rotta e finta passano senza una riga cambiata. La riserva stava in
**due gate ciechi con la stessa radice**: Ajv gira con `strict: false` — deve, il
documento non e' uno schema — quindi una parola chiave scritta male viene
ignorata in silenzio, e i test confrontavano ogni costante con la stessa
espressione che il codice usa per leggerla.

- Tolto `maxItems: 500` dal documento: **75 test verdi e 600 feature accettate**.
  Il test si auto-confermava in un modo non ovvio: costruiva
  `Array.from({length: MAX_FEATURES + 1})`, e con `MAX_FEATURES` a `undefined`
  quel `length` e' `NaN`, cioe' un array **vuoto** — il 400 arrivava da
  `minItems`. Verificato dal controller: `Array.from({length: undefined + 1}).length === 0`.
- Tolto il `default` di `styleId`: 75 test verdi, ma una richiesta che lo omette —
  **il secondo esempio del documento** — chiede uno stile inesistente e risponde 502.

**Correzioni:** un controllo all'import di `schema.js` che pretende ogni valore di
`LIMITS` finito, la catena `CoordinatesDepth*` lunga quanto `maxCoordDepth` e il
valore di serie di `styleId` dentro il suo enum, e si ferma rumorosamente come fa
gia' il confronto `STYLE_IDS`/`STYLE_ID_VALUES` in `route.js`. Nei test, i
**numeri letterali** (500, 72, 600, 19, 16, 40, 24) al posto della rilettura dello
schema, piu' il confronto esplicito nell'altro verso. Rifatte dal controller
entrambe le mutazioni: ora fermano il processo all'avvio.

**Minor chiusi:** `MAX_COORD_DEPTH` era codice morto in `route.js` (terza
dichiarazione dell'8: proprio la doppia residenza che il task elimina altrove),
tolto; `docs.html` ha ora `integrity` e `crossorigin` sul bundle Redoc, con il
comando per rifare l'hash nel commento.

**Minor respinto con prova:** il revisore proponeva `additionalProperties: false`
su `Geometry` («basta una riga») per chiudere gli extra che oggi arrivano fino al
`data` della source geojson, dove nessuno li legge. Provato: **cadono tre test**,
perche' il campo `geometries` di un `GeometryCollection` diventa «campo
sconosciuto» e il messaggio cambia, mentre il rifiuto che nomina il tipo e' una
scelta deliberata del Task 11. Annullato. Il difetto e' preesistente al Task 12 e
senza conseguenze note: resta cosi'.

**Validazione formale del documento:** `redocly lint` **non e' stato eseguito** —
il classificatore dei permessi ha negato `npx --yes`, che scarica ed esegue codice
da internet. Al suo posto un controllo strutturale scritto per l'occasione
(versione 3.1.x, `info.title`/`version`, tutti i `$ref` risolti, `operationId`
presenti e unici, risposte dichiarate, nessun segreto negli esempi): nessun
problema su 4 operazioni e 16 schemi. **Non equivale a un lint**: resta da fare
una volta prima di mandare il documento allo shard di oc:8982.

**Follow-up:** «coordinate non valide: attesa una lista» non nomina il campo —
difetto preesistente di `fit.js`, fuori dal perimetro.
