# Server cartografico Webmapp (wm-tiles)

## Cosa cambia

Oggi tutte le app Webmapp (webapp e mobile) disegnano lo sfondo cartografico con
tiles **raster PNG** servite da `https://api.webmapp.it/tiles/{z}/{x}/{y}.png`
(256x256, palette 8-bit, 30-50 KB/tile, copertura effettiva **z7-z16**). Lo stile
e' cotto dentro l'immagine: non e' modificabile senza rigenerare l'intero archivio,
non e' personalizzabile per cliente, si sgrana oltre z16 e le etichette non si
riorientano ne' si ridimensionano.

Dopo questa feature esiste un nuovo progetto **`wm-tiles`** che possiede l'intera
filiera cartografica: dati (OpenStreetMap + DEM), **stile** e **serving**.

Il cambio di fondo e' che lo stile smette di essere cotto nell'immagine e diventa
un artefatto versionato, interpretato a valle. Da quello stile il server produce
**due formati dello stesso dato**:

- **vettoriale** (Mapbox Vector Tiles, `.pbf`) — per i client che sanno
  renderizzare: webapp e mobile via map-core. Lo stile viaggia con le tiles e
  l'aspetto diventa configurazione, non build.
- **raster** (`.png`) — reso **server-side dallo stesso stile**, per i consumer
  che non hanno un motore di rendering (servizi PHP, script, app legacy gia'
  installate).

Il formato e' quindi un **tipo di output**, non un'identita' del servizio: il PNG
e' una proiezione del vettoriale, non un archivio parallelo. Questo elimina per
costruzione la divergenza visiva tra una mappa navigata e la stessa mappa
esportata come immagine.

**Scope del primo ciclo: solo backend.** Pipeline, stile, serving, filtro per
set, output raster, e una **pagina di preview** servita dal server stesso con cui
guardare e validare il risultato. Il connettore map-core (basemap vettoriale in
OpenLayers, offline, switcher) e' rinviato a un ciclo successivo. Del frontend
restano in scope soltanto le decisioni di **contratto** — manifest dei gruppi e
forma delle URL — perche' cambiarle dopo obbligherebbe ad aggiornare app gia'
installate.

L'obiettivo del primo rilascio e' quindi **produrre e servire la cartografia**, a
parita' di resa visiva percepita rispetto alle PNG attuali, con un modo concreto
di verificare quella parita'. La gestione dei layer di dati Webmapp (tracce, POI,
overlay) resta **invariata**: continua a passare dagli shard esistenti in
`.pbf`, con il proprio `initVectorTileLayer()` e la propria cache. Questa
feature non li tocca.

Un secondo principio, altrettanto strutturale: **wm-tiles possiede la capacita',
gli shard possiedono la policy.** wm-tiles dichiara cosa esiste (quali livelli,
quali attributi, quali opzioni sono governabili); ogni shard decide, per ogni
singola app, cosa accendere e come. wm-tiles non conosce le app e non ne tiene
un registro: sarebbero centinaia distribuite su N shard, e centralizzarle
duplicherebbe una fonte di verita' che vive gia' negli shard.

Architettura in quattro blocchi:

1. **Pipeline di generazione** (batch, offline) — da estratto OSM Italia a
   `italia-osm.pmtiles`; da DEM Tinitaly a `italia-hillshade.pmtiles` e
   `italia-contours.pmtiles`.
2. **Stile** — stile base Webmapp versionato + override per app, composto e
   servito come style.json.
3. **Serving** — archivi su object storage + CDN, con davanti un adattatore
   stateless che espone `/{set}/{z}/{x}/{y}.pbf` traducendo in range-request sul
   PMTiles, piu' un unico `/style.json` base; e un **renderer raster** che espone
   `/{set}/{z}/{x}/{y}.png` a partire dallo stesso stile.
4. **Pagina di preview** — servita dal server, e' lo strumento con cui si valida
   la parita' visiva e si sviluppa lo stile.

Il **connettore map-core** e' il ciclo successivo.

## Perche'

- **Personalizzazione per cliente a costo nullo.** Ogni app Webmapp ha
  un'identita' visiva propria, ma oggi la basemap e' identica per tutti perche'
  cambiarla significherebbe rigenerare e ospitare un archivio raster dedicato.
  Con il vettoriale la personalizzazione e' un JSON: un archivio di tiles, N stili.
- **Qualita' oltre z16.** Il limite attuale e' fisico: a z16 le tiles finiscono
  (verificato: `camminiditalia/wm-package/docs/features/8183-.../notes.md:204`
  documenta il fallimento silenzioso a z18). Il vettoriale ridisegna a qualsiasi
  scala via overzoom, senza generare nulla in piu'.
- **Peso e costi.** Le tiles vettoriali sono tipicamente molto piu' leggere del
  PNG equivalente e coprono piu' livelli di zoom con lo stesso dato (generazione
  fino a z14, overzoom oltre). Impatta direttamente banda, tempi di caricamento
  e dimensione dei pacchetti offline scaricati sui dispositivi.
- **Controllo della filiera.** Oggi lo stile della basemap `webmapp` vive dentro
  un tile server che non e' versionato in nessuno dei repo del team: non e'
  ispezionabile, modificabile ne' riproducibile. La nuova pipeline mette stile e
  generazione sotto git.
- **Un solo stile per tutti gli output.** Oggi l'immagine di condivisione social
  (`MapRenderService`) e il passaporto camminatore compongono PNG scaricati dal
  tile server: se la webapp migrasse al vettoriale da sola, mappa navigata e
  mappa esportata divergerebbero visivamente. Con il raster derivato dallo stesso
  stile la coerenza e' strutturale, e le personalizzazioni per cliente si
  applicano anche alle immagini generate — cosa oggi impossibile.
- **Indipendenza da terzi.** `AppTiles::satellite` punta a MapTiler con chiave
  API in chiaro nel sorgente. Non e' oggetto di questa feature, ma la direzione
  e' ridurre le dipendenze esterne sul percorso critico della mappa.

## Requisiti

### Pipeline di generazione

- [ ] Generazione di `italia-osm.pmtiles` da estratto OSM **Italia**, schema
      **OpenMapTiles**, livelli **z0-z14 con tiles 512px** (z15+ delegati
      all'overzoom del client). La dimensione della tile va fissata
      esplicitamente e una volta sola: z14@512 equivale in dettaglio a z15@256, e
      ogni ambiguita' su questo punto sbaglia di un fattore 4 il conteggio delle
      tile per bbox nell'offline.
- [ ] Rigenerazione **settimanale** schedulata e non presidiata, con log e
      notifica di esito.
- [ ] Rigenerazione **on-demand su bounding box** arbitrario, che produce un
      archivio ritagliato aggiornato senza attendere il ciclo settimanale.
      **Autenticata, con limite di area e quota**: e' un job batch pesante, e
      esposto senza vincoli e' un vettore di consumo di risorse e di costo.
- [ ] **Provenienza registrata** nei metadati dell'archivio: versione
      dell'estratto OSM, del DEM, del generatore e della configurazione di build.
      Non si richiede riproducibilita' byte-a-byte: i generatori reali non sono
      deterministici (parallelismo, ordinamento, timestamp di compressione), e un
      requisito cosi' formulato non sarebbe verificabile.
- [ ] **Mirroring degli input**: l'estratto OSM e il DEM sono download da terzi su
      cui non abbiamo leva (il provider dell'estratto va dichiarato
      esplicitamente; Tinitaly e' un download una-tantum dall'INGV). Vanno
      conservati in copia, altrimenti la ricostruzione di un archivio dipende da
      server altrui che possono cambiare formato o sparire.
- [ ] Pubblicazione **atomica**: i client non devono mai vedere un archivio
      parzialmente scritto (scrittura su nome temporaneo, promozione finale).
- [ ] Ogni archivio pubblicato porta una **versione** interrogabile dai client.

### Rilievo (DEM)

- [ ] `italia-hillshade.pmtiles` — ombreggiatura del terreno da DEM **Tinitaly
      10 m** (INGV), tiles **raster**, generato una volta e immutabile.
- [ ] `italia-contours.pmtiles` — curve di livello vettoriali da stesso DEM, con
      **equidistanza variabile per zoom** (curve piu' rade a scala piccola).
- [ ] Attribuzione della fonte DEM presente nello stile e visibile in mappa.
- [ ] Gli archivi di rilievo sono **indipendenti** dal ciclo OSM: la
      rigenerazione settimanale non li ricalcola.

### Stile

- [ ] Uno stile base **Webmapp** che replica l'aspetto attuale dei PNG: fondo
      beige, boschi verde salvia, hillshade tenue, curve di livello marroni,
      strade bianche bordate. Riferimento visivo: tiles reali campionate a z9,
      z12, z14 (famiglia OpenTopoMap/OpenMapSurfer).
- [ ] Lo stile e' un **artefatto versionato** nel repo, in formato Mapbox/MapLibre
      Style Specification.
- [ ] **Personalizzazione grafica per app** (palette, densita' etichette): resta
      lato client, applicata da map-core sopra lo stile base. Non richiede
      composizione server-side ne' un artefatto di stile per app: e' rendering,
      non dati. Da distinguere dall'**abilitazione** dei livelli, che e' invece
      necessariamente lato server (vedi "Governance dei livelli").
- [ ] Lo stile compone hillshade (raster, sotto), basemap OSM e contours in un
      unico risultato coerente.
- [ ] Copertura **z7-z16** utilizzabile alla prima release, con z15+ ottenuti
      per **overzoom** dei dati z14. Limite accettato esplicitamente: l'overzoom
      non aggiunge informazione, quindi a z15-z16 il dettaglio e' quello di z14
      (≈ z15@256). Sul vettoriale l'effetto e' contenuto perche' linee ed
      etichette si ridisegnano nitide a ogni scala; **sul raster no**: il PNG a
      z16 avra' meno dettaglio dell'attuale, che e' generato nativamente a z16.
      Scelta deliberata: l'output PNG e' di secondo ordine rispetto alla
      navigazione, e il costo di generare un livello in piu' (×4 tile, storage e
      tempo di build) non lo giustifica.
- [ ] Glifi (font) e sprite (icone) serviti dal server e referenziati dallo stile.

### Governance dei livelli: capacita' / abilitazione / visibilita'

Il modello ha tre stadi, ciascuno con un proprietario diverso. Tenerli distinti
e' la decisione architetturale centrale di questa feature.

| Stadio | Chi decide | Dove si applica | Esempio |
|---|---|---|---|
| **Capacita'** | la cartografia (wm-tiles) | pipeline e manifest | wm-tiles espone 15 livelli |
| **Abilitazione** | lo shard, per singola app | **filtro sui dati, lato server** | l'app 1 di Cammini d'Italia ne puo' usare 10 |
| **Visibilita'** | l'utente finale | rendering, lato client | tra quei 10 l'utente sceglie cosa vedere |

- [ ] **Capacita'** — wm-tiles pubblica un **manifest dei livelli**: quali
      esistono, a quali zoom, quali attributi trasportano. E' il contratto che gli
      shard leggono per sapere cosa possono abilitare, e va **versionato**: un
      manifest che cambia in modo incompatibile rompe configurazioni salvate in
      database che wm-tiles non controlla e non puo' migrare.
- [ ] Il manifest organizza i livelli tecnici in **gruppi di senso**, ciascuno
      con **nome tradotto** nelle lingue del repo (es. "Sentieri", "Rifugi",
      "Curve di livello"). Un gruppo puo' comporre piu' livelli tecnici a zoom
      diversi. Il gruppo e' l'unita' di abilitazione e di visibilita': serve in
      Nova (chi governa un cliente non deve vedere decine di nomi tecnici) e serve
      al pannello utente del secondo ciclo (senza duplicare conoscenza
      cartografica in map-core).
- [ ] I **confini dei gruppi devono coincidere con i confini commerciali**: se un
      livello e' a valore aggiunto, non puo' stare in un gruppo che contiene anche
      livelli base, altrimenti non sara' separabile senza rifare il manifest.
- [ ] **Abilitazione** — ogni app di ogni shard dichiara **quali gruppi puo'
      ricevere**. E' un **filtro sui dati applicato dal server**: i gruppi non
      abilitati **non sono presenti nel protobuf** servito a quell'app. Non e' una
      preferenza di rendering: e' l'unico punto in cui "non esposto" significa
      davvero non esposto.
- [ ] Motivazioni dell'abilitazione lato server, entrambe non ottenibili dal
      client: **non esporre pubblicamente dati che non si vogliono dare
      gratuitamente** (un client che riceve un livello e non lo disegna lo ha
      comunque, ed e' estraibile), e **non far pagare all'utente il peso** di dati
      che non vedra' mai (banda, memoria, dimensione dell'offline).
- [ ] Punto d'innesto lato shard: la pivot **`app_tile`** (`wm-package`), che e'
      gia' la sede della relazione app-basemap con `sort_order`. L'abilitazione e'
      un attributo di quella relazione, quindi due app dello stesso shard possono
      avere abilitazioni diverse sulla stessa basemap.
- [ ] Governance da **backoffice Nova** sullo shard, senza deploy: esistono gia'
      `src/Nova/Tile.php`, `TilePolicy`, `TileObserver` su cui innestarsi.
- [ ] **Visibilita'** — per ogni gruppo abilitato, la configurazione dell'app
      dichiara se e' **fisso** (l'utente non lo tocca) o **spegnibile
      dall'utente**. Il secondo stato non ha UI in questo ciclo, ma **il modello
      dati lo trasporta dal primo giorno**: introdurlo dopo significherebbe
      cambiare il manifest in modo incompatibile quando N shard hanno gia' salvato
      configurazioni che lo referenziano.
- [ ] L'utente puo' solo **spegnere** cio' che l'app gli ha abilitato, mai
      accendere altro: la visibilita' e' un sottoinsieme dell'abilitazione, per
      costruzione.

### Filtro dei dati e cache

- [ ] L'archivio generato contiene **tutti** i livelli (uno solo, nazionale). Il
      filtro avviene **in servizio**, non in generazione: l'adattatore rimuove dal
      protobuf i layer non abilitati e ricodifica. E' manipolazione di protobuf,
      non rendering: costo nell'ordine dei millisecondi, incomparabile col
      renderer raster.
- [ ] Nessuna moltiplicazione degli archivi per combinazione di livelli: un solo
      archivio da generare, mantenere e aggiornare settimanalmente.
- [ ] Serve un **identificatore del set di livelli abilitati**, stabile e
      derivato dal contenuto dell'insieme. Copre poche decine di combinazioni
      reali (le configurazioni delle app, non combinazioni arbitrarie di utenti).
      Non contiene palette, font, etichette: quelli restano puro client.
- [ ] **Cache per `(versione_archivio, set_livelli, z, x, y)`**: la versione
      dell'archivio e' parte della chiave, non solo il set. Senza di essa la
      rigenerazione settimanale non si propaga: cache CDN e cache raster
      persistente continuerebbero a servire tile della settimana precedente
      **potenzialmente per sempre**, senza errori e senza alert — la mappa si
      congela in silenzio ed e' il fallimento piu' probabile del sistema.
- [ ] Con la versione in chiave, la pubblicazione di un nuovo archivio **non
      richiede purge**: le nuove URL sono semplicemente altre. Il costo e' che
      il renderer raster riparte da cache fredda ad ogni build settimanale, e va
      dimensionato per quel picco (o pre-scaldato sui livelli piu' richiesti).
- [ ] Le app con lo stesso set e la stessa versione condividono la cache; un
      cambio di abilitazione produce un set nuovo. Nessuna invalidazione da
      orchestrare in nessuno dei due casi.
- [ ] La versione corrente e' **annunciata ai client** (endpoint di versione), che
      la usano per costruire le URL: un client che resta su una versione vecchia
      continua a funzionare fino alla scadenza dell'archivio precedente, senza
      rotture.
- [ ] **Ritenzione degli archivi precedenti** dichiarata: e' cio' che permette a
      un client fermo su una versione vecchia — e domani a un pacchetto offline
      gia' scaricato — di continuare a funzionare in modo coerente, con stile e
      tile della stessa versione. Un archivio ritirato troppo presto rompe i
      client lenti; uno mai ritirato costa storage per sempre.
- [ ] Un set **non valido o non piu' risolvibile** non lascia la mappa vuota:
      fallback a un insieme base definito.
- [ ] Il **filtro dell'abilitazione e' la stessa cosa** per il vettoriale e per il
      raster: e' l'invariante che rende il PNG una proiezione e non un archivio
      parallelo.

### Predisposizione a livelli protetti (nessuna implementazione ora)

Oggi non esistono livelli a valore commerciale, ma lo scenario e' considerato
probabile. Le voci seguenti **non implementano** alcuna protezione: fissano forme
di URL e campi di contratto che dopo non sarebbero introducibili senza rompere le
app gia' installate e le configurazioni gia' salvate negli shard. Costo oggi:
nessuno.

- [ ] L'identificatore del set **non e' auto-descrittivo** e viene **risolto
      server-side**. Un set in chiaro nel path (es. `/sentieri,rifugi/...`) si
      forgia a mano, e in quel caso il controllo di accesso non esiste nemmeno in
      potenza.
- [ ] **Due namespace di URL dal primo giorno**: uno per le tiles pubbliche
      (cache CDN piena, nessuna verifica) e uno destinato alle tiles verificate,
      oggi inutilizzato. Introdurre il secondo dopo renderebbe necessario un
      aggiornamento delle app installate per accedere ai livelli protetti — cioe'
      l'unica cosa non governabile da remoto.
- [ ] Il manifest dichiara per ogni gruppo una **classe** (`pubblico` /
      `protetto`), con l'insieme dei protetti oggi vuoto. E' un campo, non una
      funzionalita'.
- [ ] **Un solo punto di applicazione del filtro** in tutto il sistema
      (l'adattatore). Regola vincolante: non deve nascere un secondo punto in cui
      i livelli vengono selezionati, perche' due punti di applicazione producono
      prima o poi due comportamenti diversi e un'esposizione silenziosa.
- [ ] **L'archivio PMTiles non e' pubblicamente accessibile.** Contiene *tutti* i
      livelli: se il bucket fosse raggiungibile, il filtro si aggirerebbe con una
      singola range-request diretta e l'intera protezione sarebbe teatro.
      L'adattatore deve essere **l'unico lettore autorizzato** dell'archivio, e
      questo vale dal primo giorno — anche prima che esistano livelli protetti,
      perche' un bucket aperto e' difficilissimo da chiudere dopo che qualcosa lo
      referenzia.
- [ ] La CDN e' davanti all'**adattatore**, non davanti allo storage.
- [ ] Quando servira', l'autorizzazione e' emessa dallo **shard** (autentica gia'
      gli utenti e sa chi ha diritto a cosa) come riferimento firmato a scadenza,
      trasportato dal canale della config dell'app che esiste gia'. wm-tiles lo
      verifica **senza conoscere utenti ne' clienti**: resta stateless.
- [ ] Vincolo accettato in anticipo: le tiles protette **non sono cacheabili
      dalla CDN pubblica**, perche' la risposta dipende da chi chiede. E' la
      ragione dei due namespace separati: i livelli pubblici restano sulla via
      veloce, solo i protetti pagano quel prezzo.

### Contenuto informativo dei livelli

- [ ] Le tiles vettoriali trasportano gli **attributi** necessari a rendere la
      basemap interrogabile (nome, tipo, e dove serve quota, superficie,
      `osm_id`), non solo geometrie da disegnare. E' il salto rispetto al PNG,
      dove la basemap e' un'immagine muta.
- [ ] La scelta degli attributi e' **misurata, non esaustiva**: ogni attributo
      pesa su tutte le tiles e quindi sui pacchetti offline sui dispositivi. Si
      includono gli attributi che servono a un caso d'uso dichiarato.
- [ ] Il manifest dichiara **quali attributi** ogni gruppo espone, cosi' che il
      client sappia su cosa puo' contare senza ispezionare le tiles.
- [ ] Se esistono attributi a valore aggiunto, valgono per essi le stesse regole
      dell'abilitazione: il filtro li rimuove lato server, non li nasconde lato
      client.

### Output raster (PNG)

- [ ] Endpoint `/{z}/{x}/{y}.png` che rende **server-side dallo stesso stile** e
      dagli stessi dati delle tiles vettoriali. Nessun archivio raster parallelo,
      nessuna pipeline di generazione separata.
- [ ] **Formato identico** all'attuale `api.webmapp.it/tiles/{z}/{x}/{y}.png`:
      256x256, Web Mercator, PNG. Il **path cambia** perche' contiene il set:
      migrare un consumer significa cambiare dominio *e* forma della URL, quindi
      una modifica di configurazione (non solo di dominio) nei consumer
      server-side. Va previsto un set di default documentato per i consumer che
      non hanno un'app di riferimento.
- [ ] Variante **per set di livelli**: `/{set}/{z}/{x}/{y}.png` rende solo i
      livelli abilitati per quell'app. Oggi impossibile col raster precotto.
      L'indirizzamento per contenuto del set rende la cache permanente e condivisa
      tra app con abilitazioni identiche.
- [ ] **Cache persistente** delle tiles rese: il rendering e' l'unica operazione
      costosa in CPU del sistema e non deve ripetersi per la stessa tile.
- [ ] Copertura di zoom **almeno z7-z16** come oggi, senza il fallimento
      silenzioso oltre il massimo: una tile fuori range risponde in modo
      esplicito, non con un errore non-2xx silenzioso (vedi
      `camminiditalia/wm-package/docs/features/8183-.../notes.md:204`).
- [ ] Dimensionamento e limiti di richiesta: il renderer e' l'unico componente
      con costo di calcolo, va protetto da richieste massive accidentali
      (es. uno script che scarica un bbox intero).
- [ ] Verifica sui **consumer reali** prima di dichiararlo pronto:
      `MapRenderService` (immagine di condivisione social) e gli script del
      passaporto camminatore producono immagini identiche o accettabilmente
      equivalenti a quelle attuali.

### Licenze e attribuzione

- [ ] **Attribuzione OpenStreetMap obbligatoria (ODbL)** su ogni output, non solo
      nella mappa navigata: vale anche per le **immagini PNG generate**
      (condivisione social via `MapRenderService`, passaporto camminatore), dove
      oggi non esiste un posto previsto in cui collocarla. Va risolto in questa
      feature, non lasciato al consumer.
- [ ] Attribuzione della fonte **DEM Tinitaly** (INGV) con la formula richiesta
      dalla licenza, negli stessi output.
- [ ] L'attribuzione e' dichiarata nello **stile** (cosi' viaggia col dato) e
      resa disponibile in forma testuale per i consumer che compongono immagini e
      non renderizzano lo stile.
- [ ] Verifica delle condizioni di licenza degli input (estratto OSM, DEM) e
      registrazione della provenienza nei metadati degli archivi pubblicati.

### Serving

- [ ] Archivi PMTiles su **object storage + CDN**; nessuno stato applicativo sul
      percorso dei dati.
- [ ] **Adattatore stateless** che espone `/{set}/{z}/{x}/{y}.pbf` (e
      l'equivalente per hillshade e contours) traducendo in range-request sul
      PMTiles. Il contratto verso map-core resta "una tile = una URL", ma la URL
      contiene **sempre** il set: e' l'unico modo perche' la CDN possa cachare
      correttamente. Un set dedotto da header o token richiederebbe `Vary` e
      aprirebbe la porta a servire la tile filtrata di un'app a un'altra.
- [ ] CORS e cache header corretti per consumo da webapp e da WebView Capacitor.
- [ ] Endpoint di **health** e di **versione degli archivi**.
- [ ] **Osservabilita'** su un componente che sara' sul percorso critico di tutte
      le app: metriche di latenza (con **budget misurato** per il filtro sul
      protobuf — il costo va misurato, non assunto), hit-rate della cache,
      dimensione degli archivi, esito e durata dei build.
- [ ] **Alert** su build fallito, su archivio non promosso e su cache fredda
      prolungata.
- [ ] **Ogni fallback emette un segnale osservabile.** Un set non risolvibile che
      cade silenziosamente su un insieme base significa che un cliente riceve
      meno livelli senza che nessuno lo sappia: per costruzione non c'e' errore,
      quindi il segnale va prodotto esplicitamente.
- [ ] **Tracciabilita' di cio' che e' stato servito** per set e versione. Serve al
      caso peggiore: se un bug del filtro lasciasse passare un livello protetto,
      correggere il codice non basta — bisogna sapere *quali* set e quali tile
      sono contaminati per invalidarli.
- [ ] **Procedura di purge della CDN e della cache raster**, verificata. Il
      rollback dell'archivio da solo non basta: senza purge, una versione corrotta
      gia' distribuita resta servita.

### Pagina di preview

E' il deliverable che rende verificabile tutto il resto: senza di essa la
"parita' di resa visiva" resta un requisito senza modo di essere controllato, e
lo stile si sviluppa alla cieca.

- [ ] Pagina web servita da wm-tiles che rende la basemap vettoriale con
      **MapLibre GL JS** — renderer di riferimento della style spec, nessun
      vincolo con Angular o OpenLayers. Se lo stile rende bene qui, il problema
      residuo di map-core sara' di integrazione, non di cartografia.
- [ ] **Confronto affiancato con le PNG attuali** (`api.webmapp.it/tiles`) sulla
      stessa area e allo stesso zoom, con vista sincronizzata. E' il modo in cui
      si valuta la parita' durante lo sviluppo dello stile, ogni giorno e non
      alla fine.
- [ ] Selezione del **set di livelli** e visualizzazione di quali gruppi contiene:
      serve anche come endpoint di ispezione in forma leggibile.
- [ ] Confronto tra **output vettoriale e output raster** dello stesso set, per
      verificare l'invariante che il PNG e' una proiezione dello stesso stile.
- [ ] Accensione/spegnimento dei livelli e delle sorgenti (hillshade, contours)
      per isolare problemi di composizione.
- [ ] Indicazione della **versione dell'archivio** e del set in uso, cosi' che
      chi guarda sappia sempre cosa sta guardando.
- [ ] Zone campione preconfigurate (montagna, citta', costa, pianura) per non
      dover cercare a mano le aree di confronto.
- [ ] Non e' un prodotto per il cliente finale: e' uno strumento interno di
      sviluppo e verifica. Nessun requisito di design, nessuna compatibilita' con
      browser vecchi.

### Migrazione

- [ ] Il tile server PNG attuale resta **intatto e in servizio**: questo ciclo
      non tocca alcuna app e non modifica alcuna configurazione esistente.
- [ ] Confronto visivo documentato (stessa area, stesso zoom, PNG attuale vs
      nuovo output) su un insieme di zone campione — montagna, citta', costa,
      pianura — prodotto con la pagina di preview e **approvato** prima di
      dichiarare concluso il ciclo.
- [ ] Il contratto verso i client (forma delle URL, manifest, set) e' considerato
      **pubblico e stabile** al termine di questo ciclo, perche' il ciclo
      successivo lo consumera' da app che non si possono aggiornare a comando.

## Rischi

- **Replicare lo stile e' il lavoro nascosto piu' grande.** Lo stile attuale non
  e' disponibile in forma sorgente: va ricostruito per confronto visivo. Un
  style.json completo e' un artefatto di migliaia di righe con centinaia di regole
  per layer/zoom. *Mitigazione:* partire da uno stile OpenMapTiles maturo e
  vicino al target (famiglia OpenTopoMap) e convergere per iterazioni su zone
  campione, invece di disegnare da zero. Accettare esplicitamente che la parita'
  visiva sara' **approssimata**, non pixel-perfect, e concordare in anticipo il
  livello accettabile.
- **Regressione percepita di qualita'.** Anche a stile fedele, il vettoriale
  rende diversamente: antialiasing, resa dei font, ordine di disegno. Su un
  prodotto outdoor gli utenti notano. *Mitigazione:* rollout per app con
  possibilita' di rientro immediato via configurazione, e confronto visivo
  approvato prima di ogni attivazione.
- **Prestazioni su mobile di fascia bassa.** Il costo di rendering si sposta sul
  dispositivo. Con basemap vettoriale + tracce + POI simultanei il rischio e'
  scatti e consumo batteria. *Mitigazione:* misurare su dispositivi reali prima
  del rilascio; limitare la complessita' dello stile (numero di layer, etichette)
  come vincolo di progetto, non come ottimizzazione finale.
- **Offline: il conto delle tiles cambia natura.** Il meccanismo esistente
  funziona per URL singole e sopravvive, ma il numero di tiles per bbox e il loro
  peso cambiano, e vanno aggiunti stile, glifi e sprite alla cache. Un pacchetto
  offline incompleto e' peggio di nessun pacchetto: la mappa si apre vuota.
  *Mitigazione:* trattare "stile + glifi + sprite + tiles" come un pacchetto
  atomico con verifica di completezza prima di dichiararlo scaricato.
- **Range-request e WebView.** Il modello PMTiles+CDN dipende da range-request
  HTTP; l'adattatore le nasconde al client, ma resta un componente sul percorso
  critico di tutte le app. *Mitigazione:* stateless e replicabile, con fallback
  raster attivo.
- **Il manifest dei livelli e' un contratto pubblico verso N shard.** Una volta
  che gli shard salvano configurazioni che referenziano livelli e attributi, il
  manifest non e' piu' liberamente modificabile: rinominare o rimuovere un
  livello invalida configurazioni salvate in database che wm-tiles non controlla
  e non puo' migrare. *Mitigazione:* manifest versionato, cambiamenti additivi,
  e fallback allo stile base per configurazioni non risolvibili. Soprattutto:
  esporre da subito i **gruppi utente** e lo **stato a tre valori** per gruppo,
  perche' sono le due estensioni che si sa gia' che serviranno (pannello utente,
  secondo ciclo) e che dopo non sarebbero introducibili in modo compatibile.
- **L'abilitazione per app frammenta cache e offline.** E' il prezzo inevitabile
  del non esporre i dati, non un difetto del design, ma va pagato
  consapevolmente: tiles e cache diventano per-set, e soprattutto **il pacchetto
  offline diventa per-app**. Due app dello stesso shard installate sullo stesso
  dispositivo scaricano tiles diverse senza condividerle, quindi lo spazio
  occupato sul telefono si somma. *Mitigazione:* contenere il numero di set
  distinti realmente in uso (pochi profili di abilitazione, non uno per cliente),
  e misurare la dimensione dell'offline per set prima del rilascio.
- **Il filtro sul protobuf e' sul percorso critico di ogni tile.** Un errore nel
  filtro ha due facce di gravita' opposta: rimuovere troppo degrada la mappa in
  modo visibile; rimuovere troppo poco **espone dati non abilitati**, in silenzio
  e senza che nessuno se ne accorga. *Mitigazione:* trattarlo come un controllo di
  accesso, non come un'ottimizzazione — test che verificano l'assenza dei layer
  non abilitati nel protobuf servito, non solo la presenza di quelli attesi.
- **La predisposizione ai livelli protetti puo' restare lettera morta.** Sono
  scelte di forma che non producono alcun comportamento osservabile ora: nessun
  test le esercita, nessun utente le nota, e quindi si degradano in silenzio
  (un secondo punto di filtro introdotto per comodita', un set reso
  auto-descrittivo per debug, il namespace verificato mai deployato).
  *Mitigazione:* test che verifichino le invarianti di forma — il set non e'
  auto-descrittivo, entrambi i namespace rispondono, il manifest dichiara la
  classe di ogni gruppo — cosi' che una regressione fallisca subito invece di
  emergere il giorno in cui serve la protezione.
- **Il set di livelli e' un identificatore opaco che nessuno sa leggere.** Se una
  tile e' sbagliata in produzione, risalire da un hash all'app e
  all'abilitazione che l'ha prodotta e' necessario per diagnosticare.
  *Mitigazione:* endpoint di ispezione che, dato un set, restituisce l'elenco dei
  gruppi che contiene.
- **Il costo di storage della cache raster non e' stimato.** Italia z7-z16 sono
  milioni di tile **per set**; "cache persistente" + "una variante per set" e' una
  moltiplicazione che nessun requisito quantifica. E' il tipo di numero che,
  calcolato dopo il rilascio, obbliga a rifare la strategia di cache.
  *Mitigazione:* stimarlo prima di implementare la cache, e decidere in base al
  numero una politica di scadenza invece di una conservazione indefinita — il
  raster e' traffico di nicchia (generazione immagini), quindi una cache parziale
  con rigenerazione su richiesta e' probabilmente sufficiente.
- **Il renderer raster e' l'unico componente costoso in CPU.** Tutto il resto del
  sistema e' banda o batch; questo calcola. Se non e' protetto e messo in cache,
  un singolo script che scarica un bbox ampio puo' saturarlo, e con esso
  degradare la generazione delle immagini di condivisione. *Mitigazione:* cache
  persistente delle tiles rese, limiti di richiesta, e monitoraggio separato dal
  serving vettoriale (che deve restare in piedi anche se il renderer e' sotto
  pressione).
- **Il rilievo e' l'unico dato non-OSM.** Tinitaly ha licenza e attribuzione
  proprie e copre l'Italia: se domani serve cartografia fuori Italia, hillshade e
  contours non ci sono. *Mitigazione:* scoperta accettata, l'ambito e' Italia.
- **Dopo la dismissione del vecchio tile server non esiste piu' alcun fallback.**
  Durante la transizione il rientro al raster attuale regge; dopo, un archivio
  corrotto promosso o una regressione del filtro spegne la basemap di **tutte le
  app insieme**. *Mitigazione:* la dismissione e' subordinata all'esistenza di
  rollback dell'archivio **e** di purge CDN, entrambi verificati — non e' una
  decisione di pulizia ma di rischio. In questo ciclo la questione non si pone
  (il vecchio server resta intatto), ma il vincolo va scritto ora perche' e' il
  ciclo successivo a poterlo violare.
- **Bus factor sulla pipeline.** La generazione e' un processo batch pesante che
  gira una volta a settimana: e' il tipo di componente che si rompe in silenzio.
  *Mitigazione:* notifica di esito obbligatoria e archivio precedente sempre
  conservato, cosi' un build fallito non spegne la mappa.
- **Il contratto di configurazione e' pubblico.** Estendere `AppTiles`/tabella
  `tiles` con un tipo di sorgente tocca tutte le app installate, anche quelle che
  non migreranno. *Mitigazione:* estensione additiva, retrocompatibile, con il
  campo raster esistente sempre valido.

## Out of scope

- **Layer di dati Webmapp** (tracce, POI, overlay): restano sugli shard esistenti
  in `.pbf`, invariati.
- **Basemap `satellite`**: e' imagery raster da MapTiler, non derivabile da OSM.
  Resta com'e'. (La chiave API in chiaro in `AppTiles.php` e il `mute` su `http://`
  non cifrato sono problemi reali ma indipendenti: da tracciare a parte.)
- **Cartografie raster proprietarie** (`mappa_gombitelli`, `374_Roma_3857`):
  restano basemap raster a se'.
- **Dati custom per cliente fusi nella basemap** (confini parchi, aree di
  competenza): se serviranno, saranno archivi PMTiles separati sovrapposti dallo
  stile, non layer dentro l'archivio nazionale.
- **Connettore map-core** (ciclo successivo): basemap vettoriale in OpenLayers,
  applicazione dello style.json, switcher con basemap miste, download offline,
  riscrittura del layer di cache locale e migrazione dei pacchetti gia' presenti
  sui dispositivi. Include lo spike di compatibilita' `ol-mapbox-style` /
  OpenLayers: il repo pinna `ol: 7.1.0` mentre `ol-mapbox-style` 10.x/11.x
  richiede `ol: ^7.3.0` — un bump dentro la stessa major, quindi plausibile, ma
  da verificare empiricamente (espressioni della style spec e `raster-dem` per
  l'hillshade sono i punti dubbi).
- **Modifiche a `wm-package`** (ciclo successivo): `AppTiles`, campi sulla
  tabella `tiles`, abilitazione sulla pivot `app_tile`, esposizione del set nella
  config dell'app, governance in Nova. In questo ciclo il set e' un parametro
  passato a mano nella preview, non un dato di configurazione.
- **Pannello utente per spegnere i livelli in mappa** (terzo ciclo). Il
  manifest, i gruppi tradotti e lo stato `acceso e spegnibile dall'utente` sono
  in scope ora; l'interfaccia in map-core che li legge, applica la visibilita' e
  persiste la scelta dell'utente no. Da affrontare in quel ciclo anche il
  comportamento in offline, dove lo stile e' in cache. Nel vettoriale il costo di
  esecuzione e' vicino a zero (e' visibilita' nello stile applicato, senza
  ricaricare tiles); nel raster resta impossibile e non verra' offerto.
- **Protezione effettiva dei livelli riservati** (autenticazione, firma,
  scadenza, verifica): nessuna implementazione in questo ciclo. In scope solo la
  predisposizione descritta nei requisiti, che ha costo nullo oggi ed evita un
  cambio incompatibile domani.
- **Backoffice grafico per gli stili**: il modello a override lo rende
  costruibile in seguito; non in questo ciclo.
- **Lettura nativa di PMTiles lato client** e offline come "ritaglio unico di
  archivio": ottimizzazione successiva, dopo che il primo rilascio e' in
  produzione e misurabile.
- **Copertura fuori Italia.**
- **Dismissione del tile server PNG attuale**: resta attivo per tutta la
  transizione. (L'output PNG *del nuovo server* e' invece in scope: e' cio' che
  rendera' dismettibile il vecchio, anche per i consumer che non sanno
  renderizzare vettori.)
- **Riscrittura dei consumer server-side** (`MapRenderService`, script del
  passaporto): non vengono toccati. Continuano a comporre PNG, cambiando al
  massimo il dominio in configurazione.
- **Aggiornamento OSM in tempo quasi-reale**: il ciclo e' settimanale, con
  on-demand su bbox come valvola.

## Moduli toccati

### Repo `wm-tiles` (nuovo, da inizializzare)

- Pipeline di generazione OSM -> PMTiles (configurazione generatore, schema
  layer, script di build).
- Pipeline DEM -> hillshade + contours.
- Orchestrazione: job settimanale, comando on-demand per bbox, pubblicazione
  atomica, versionamento archivi.
- Stile base Webmapp e manifest versionato dei livelli (gruppi con nomi tradotti,
  attributi dichiarati).
- Filtro dei livelli sul protobuf in servizio, identificatore del set di livelli,
  cache per `(set, z, x, y)`, endpoint di ispezione di un set.
- Glifi e sprite.
- Adattatore di serving `/{z}/{x}/{y}.pbf` + `/styles/{app}/style.json` + health.
- Renderer raster server-side `/{z}/{x}/{y}.png` e `/{app}/{z}/{x}/{y}.png`, con
  cache persistente e limiti di richiesta.
- Pagina di preview (MapLibre GL JS) con confronto affiancato alle PNG attuali,
  selezione del set, confronto vettoriale/raster, zone campione.
- Osservabilita': metriche, alert, tracciabilita' per set e versione, procedura
  di purge.
- Mirroring degli input (estratto OSM, DEM) e registrazione della provenienza.
- Documentazione operativa e ambiente di sviluppo locale.

### Cicli successivi (nessuna modifica in questo ciclo)

- **`map-core`** — fonte di verita': il **submodule** montato in
  `wm-webapp/src/app/shared/map-core` e in `wm-app` (stesso repo GitHub
  `webmappsrl/map-core`). Il clone standalone in `~/Documents/map-core` e' fermo a
  ottobre 2023 e non contiene `localForage.ts`: non va usato come riferimento. Il
  lavoro si innestera' su **`develop`** (il submodule della webapp e' oggi su un
  branch cliente, `RDO_ass_cammini_italia_2026_2`).
  File coinvolti nel ciclo successivo: `src/utils/ol.ts` (`buildTileLayers()`,
  `buildTileUrl()` riga 731, `tileLoadFn` riga 1172), `src/utils/localForage.ts`
  (riscrittura del layer di cache), `src/readonly/constants.ts`,
  `src/types/model.ts`, `src/components/map/map.component.ts`,
  `src/components/controls/controls.map.ts`,
  `src/components/buttons/btn-tiles/`.
- **`wm-package`** — `src/Enums/AppTiles.php`, migration `tiles` e `app_tile`,
  `src/Models/Tile.php`, `src/Models/App.php` (`tiles()`, riga 92),
  `src/Nova/Tile.php`, `TilePolicy`, `TileObserver`,
  `src/Http/Controllers/Api/AppController.php`.
- **Consumer server-side** — `MapRenderService.php` (legge
  `AppTiles::webmapp['url']` riga 155, scarica PNG in `fetchTile()` riga 410,
  zoom 7-16 righe 46-48) e gli script del passaporto camminatore
  (`10-fetch-tiles-all.py:60`). Consumeranno l'endpoint raster cambiando
  configurazione, non logica.
