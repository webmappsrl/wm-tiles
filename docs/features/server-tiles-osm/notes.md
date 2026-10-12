# Notes — Server cartografico Webmapp (wm-tiles)

Nessun ticket Orchestrator: feature tracciata solo in questa cartella.

## Deviazioni dal piano

- **2026-10-11 — Le quote del DEM si generano fino a z14, non z16.** TINITALY ha
  un punto ogni 10 m e a z14 un pixel vale gia' circa 7 m: oltre non c'e'
  dettaglio, solo interpolazione. Sulle celle di prova le PNG z15-z16 con le
  quote fino a z14, ingrandite come fa la preview (`render-png.mjs
  --dem-max 14`), differiscono da quelle con le quote fino a z16 di meno di 0,6
  livelli di grigio su 255 in media. Circa 8 GB invece di 130. Reversibile:
  TINITALY resta, e lo stile e il renderer leggono dai dati fin dove arrivano
  le quote.
- **2026-10-11 — Renderer PNG con maplibre-native, come prevedeva il piano
  (Task 13); sostituisce la decisione del giorno prima.** Lo spike mai fatto,
  rifatto con lo stile gia' tarato: stesse tile, stesso `style.json`,
  maplibre-native contro OpenLayers in Chromium. Misure sulle celle di prova:
  - velocita', 64 tile z14: OpenLayers 61 s con GPU e 349 s senza;
    maplibre-native 3 s con GPU e 4,7 s su Linux senza GPU (Mesa llvmpipe in
    Docker). Senza GPU circa 60 volte piu' veloce: per circa due milioni di
    tile qualche ora su 8 core invece di settimane;
  - fedelta' a TGen, 35 tile z10-z16 in cinque luoghi: scarto medio di
    luminosita' 2,0 OpenLayers e 2,2 maplibre-native, di contrasto 1,2 e 2,0.
    L'ombreggiatura isolata coincide (meno di 1,1 livelli di grigio su 255);
    il resto viene dalle etichette, che ogni motore dispone a modo suo.
  L'utente ha accettato che i PNG differiscano da cio' che le app mostreranno
  col vettoriale (OpenLayers) nella disposizione di qualche etichetta. Lo
  stile resta uno: `src/raster/stile-nativo.js` lo adatta in automatico (zoom
  pieno con pixel ratio 0,5 perche' maplibre-native carichi le tile del
  livello giusto, grandezze raddoppiate, soglie alzate di uno, passo del testo
  lungo le linee, niente contorno sfumato sulle superfici), e l'ombra la
  calcola `src/raster/ombra.js` con le formule e i parametri della preview.
  Il renderer OpenLayers resta come `render-png-ol.mjs` per i confronti.
- **2026-10-10 — Renderer PNG con OpenLayers headless, non maplibre-native
  (Task 13). Superata dalla voce precedente.** La somiglianza al riferimento e' stata tarata su OpenLayers:
  ombreggiatura calcolata in WebGL, compensazione additiva del multiply,
  sfasamento di zoom di ol-mapbox-style. Un renderer nativo disegna in modo
  diverso e richiederebbe di ritarare tutto. `pipeline/render-png.mjs` apre la
  preview in Chromium headless, disegna metatile 4x4 con 128 px di margine e
  ritaglia. La velocita' non e' un criterio: i PNG si rigenerano ogni qualche
  mese. Non c'e' (ancora) la rotta `/t/.../raster/...` del piano: i PNG si
  producono in batch in una cartella `z/x/y.png`.
- **2026-10-10 — Aggiornamento incrementale invece dell'API on-demand.** Il
  Task 15 del piano (API autenticata che rigenera un bbox) resta valido ma non
  e' stato fatto. Si e' fatto prima il confronto fra versioni
  (`pipeline/diff-versioni.mjs`), che dice quali PNG rifare dopo un
  aggiornamento: e' cio' che serve alla prima consegna, i PNG che sostituiscono
  quelli di TGen.

## Bug trovati

Nessuno durante la pianificazione. Due problemi **pre-esistenti** rilevati nel
codice esistente mentre si esplorava il contesto, entrambi **fuori scope** e da
tracciare separatamente:

- `wm-package/src/Enums/AppTiles.php` — la chiave API MapTiler della basemap
  `satellite` e' in chiaro nel sorgente.
- `wm-package/src/Enums/AppTiles.php` — la basemap `mute` punta a
  `http://tiles.webmapp.it/blankmap/...` non cifrato: bloccato come mixed
  content da qualunque webapp servita in HTTPS.

## Decisioni

- **2026-10-10 — Emulare TGen e' un algoritmo.** Parole dell'utente: "di base
  dobbiamo emulare TGen e i vecchi PNG, quindi se cambia qualcosa la cambiamo
  anche noi: diventa algoritmo, niente domande e nemmeno report". Livelli e
  celle li decide l'inventario `grid_1x1`, i dati il `project.mml`, lo stile
  i `.mss` e i PNG. Il metodo per scoperte successive, una lettura e una
  domanda per volta, non scala sull'Italia ed e' abbandonato.

- **2026-10-10 — Aree di prova: Toscana (Pisa) e Sicilia (Caltanissetta).**
  Decisione dell'utente. Si usano le celle di un grado di TGen che le
  contengono (10-11 E, 43-44 N; 14-15 E, 37-38 N). Pisa e' stata rigenerata
  da TGen a febbraio 2026 con i dati completi; Caltanissetta solo nel giro di
  settembre 2025, con rilievo e un uso suolo piu' chiaro (probabilmente
  `land_cover_hr`). Una prima lettura l'aveva data per senza rilievo e con
  lo sfondo bianco: era una tile di citta', dove lo sfondo quasi non si vede.

- **2026-10-10 — Si genera quello che ha generato TGen, solo per l'Italia.**
  Decisione dell'utente: i livelli (z0-z16) li fissa cio' che TGen ha
  prodotto, non una scelta tecnica. TGen ha generato anche zone estere, a
  macchia e in anni diversi (Parigi 2018, Lubiana 2019, Corsica e Zurigo
  2022): "fuori Italia non ci interessa". Sul server di `api.webmapp.it` quelle
  tile restano come sono, quindi la consegna non deve mai cancellare.
- **2026-10-10 — DEM: quello a 10 m di TGen.** Decisione dell'utente: nel
  primo ciclo i dati si copiano tutti da TGen, e il 10 m ha piu' risoluzione
  del Copernicus a 30 m: e' TINITALY, che TGen ha in
  `dem/it_original/tinitaly`. Da z14 TGen usa un'ombreggiatura ad alta
  risoluzione (`hs10m`, pixel di 5 m, solo sull'area dei lavori recenti); a z16
  nell'area di prova la differenza col 30 m e' evidente (creste e fossi
  spariscono). Fino a che livello conservare le quote (z14 o z16) resta da
  decidere, dopo una verifica sull'area di prova. OpenStreetMap resta da
  Geofabrik: quello di TGen e' fermo a febbraio 2026 e in un altro schema
  (osm2pgsql, non OpenMapTiles).

- **2026-10-10 — Un server nuovo e dedicato per wm-tiles.** Scartato un
  server Webmapp esistente: il rendering tiene la CPU occupata per ore e
  planetiler chiede molta memoria, e su una macchina che serve app in
  produzione le rallenterebbe. Requisiti: 8 core, 32 GB di RAM,
  500 GB–1 TB di SSD, sistema recente con Docker, nessuna GPU.

- **2026-10-10 — wm-tiles non gira su TGen.** Valutato e scartato: TGen ha
  risorse sufficienti ed e' ferma, ma il sistema e' fuori supporto (Debian 9
  dal 2022, PostgreSQL 9.6 dal 2021), Node 18+ e Chromium non ci girano, e
  Docker dai repository si ferma alla 19.03. wm-tiles deve sostituire TGen:
  installarlo li' vorrebbe dire spostarlo di nuovo quando TGen andra'
  aggiornata o spenta, e nella fase 2 servire tile alle app da un sistema
  senza aggiornamenti di sicurezza. Da TGen servono solo dati statici, che si
  copiano una volta in sola lettura. Resta da scegliere se macchina nuova o
  un server Webmapp esistente.

- **2026-10-10 — Regola fondante: si copia lo stile, non il contenuto.**
  Parole dell'utente: "lo stile puo' essere anche del 2012: quello che faremo
  e' copiare lo stile e non il contenuto, che in questi anni puo' essere
  cambiato. Per esempio un'autostrada magari fa un percorso diverso, ma lo
  stile e' quello comandato dai PNG e da TGen". Annulla la decisione qui
  sotto, che era una mia lettura sbagliata di "un aggiornamento e' dovuto":
  l'utente intendeva il contenuto, non lo stile. Resta valida la decisione
  originale di imitare i PNG anche a z7-z12. Resta valido anche il principio
  sui buchi da z14 (rilievo e uso suolo mancanti): sono contenuto, non stile,
  e non si imitano.
- **2026-10-10 — [ANNULLATA] A z0-z12 si segue lo stile attuale di TGen, non
  i PNG del 2018.** Sostituiva la decisione qui sotto. Regola dell'utente: si emula
  cio' che lo stile dichiara, non cio' che manca perche' un giro manuale non
  e' stato fatto o rifatto. Secondo l'utente z0-z12 non sono stati rigenerati
  perche' cambiano poco e i clienti chiedono aree circoscritte, quindi chi
  lanciava i lavori a mano li saltava; sono vecchi di quasi dieci anni e un
  aggiornamento e' dovuto. Il riferimento visivo diventa la z13 attuale
  (settembre 2025), disegnata con lo stile attuale e con gli stessi colori di
  Corine. Per lo stesso principio non si emulano i buchi da z14: il rilievo
  assente dove il lavoro non l'ha costruito e il bianco dove manca la tabella
  regionale. Si emula invece il limite di Corine a z13, che e' scritto nello
  stile.
- **2026-10-10 — [VALIDA] A z7-z12 si imitano i PNG serviti, anche se del
  2018.** Le
  tile di `api.webmapp.it` hanno due date: z0-z12 del 2018, z13-z16 di
  settembre 2025 in Italia (febbraio 2026 nell'area di prova): sono stati
  rigenerati solo i livelli alti.
  Lo stile attuale di TGen (`.mss`) a z7-z12 produrrebbe un'altra resa, che
  pero' non esiste da nessuna parte: non ci sarebbe un PNG con cui
  confrontarsi. Decisione dell'utente: "come primo ciclo emuliamo quello che
  esiste come design". Resta aperto chiedere a chi cura TGen se z7-z12 siano
  rimasti al 2018 per scelta o per risparmiare tempo di rendering; se per
  tempo, in un ciclo successivo si ritarano z7-z12 sui `.mss` senza toccare
  il resto.

- **2026-09-04 — Nome del repo: `wm-tiles`, non `osmvectors`.** Il formato
  (vettoriale o raster) e' un tipo di output, non l'identita' del servizio: il
  server produce entrambi dallo stesso stile. Il nome segue anche la convenzione
  `wm-*` degli altri repo in `~/.config/webmapp/repos.json`. La cartella di
  lavoro iniziale `~/Documents/osmvectors` e' stata rinominata.
- **2026-09-04 — Le PNG attuali contengono il rilievo.** Verificato scaricando
  tiles reali da `api.webmapp.it/tiles` a z9, z12 e z14: si vedono hillshade e
  curve di livello, stile della famiglia OpenTopoMap/OpenMapSurfer. Il rilievo
  non e' in OSM, quindi il DEM (Tinitaly 10 m, INGV) e' entrato nello scope del
  primo ciclo invece di essere rinviato: senza, la nuova basemap sarebbe una
  regressione visibile.
- **2026-09-04 — z0-z14, con il limite sul raster accettato.** L'overzoom non
  aggiunge informazione: a z15-z16 il dettaglio resta quello di z14. Sul
  vettoriale l'effetto e' contenuto, sul PNG no — il raster a z16 sara' meno
  dettagliato dell'attuale. Accettato su indicazione del developer: "il png e' di
  secondo ordine, possiamo fermarci a z14".
- **2026-09-04 — Il filtro dei livelli e' lato server, non lato client.** Un
  client che riceve un livello e non lo disegna lo possiede comunque, ed e'
  estraibile: il filtro lato client non e' un filtro. Da qui i tre stadi
  capacita' / abilitazione / visibilita'.
- **2026-09-04 — Scope del primo ciclo ridotto al backend piu' la pagina di
  preview.** Il connettore map-core e le modifiche a `wm-package`/Nova sono
  rinviate: i gruppi di livelli vanno validati guardando la preview prima di
  congelarne il modello dati su N shard, che e' il punto meno reversibile della
  feature.
- **2026-09-04 — Il clone locale `~/Documents/map-core` e' stantio** (ottobre
  2023, branch `develop`, senza `localForage.ts`). La fonte di verita' e' il
  submodule montato in `wm-webapp/src/app/shared/map-core` o in `wm-app`. La
  prima stesura dell'overview attribuiva file al repo sbagliato per questo
  motivo; corretta dopo verifica. Il lavoro del ciclo successivo si innestera' su
  `develop`.
- **2026-09-04 — Documentazione accentrata in `wm-tiles`.** Nessun `overview.md`
  in map-core o wm-package, su decisione del developer, benche' parte del codice
  dei cicli successivi viva la'.

## Follow-up

- Aggiungere `wm-tiles` a `~/.config/webmapp/repos.json` (non ancora fatto).
- Valutare una riga di rimando nel `CLAUDE.md` di `map-core` e `wm-package`
  quando quei repo verranno toccati, dato che la documentazione e' accentrata qui.
- Separare i sentieri dal layer tecnico `transportation` richiede uno schema
  planetiler custom: fuori dal primo ciclo. Fino ad allora il gruppo "Strade e
  sentieri" e' unico e non separabile commercialmente.
- Ticket separato per i due problemi pre-esistenti di `AppTiles.php`.

## Da compilare durante l'esecuzione

- Costo misurato del filtro sul protobuf (Task 6, step 6).
- Dimensione e durata del build Italia (Task 14, step 8).
- ~~Esito dello spike sul rendering nativo MapLibre (Task 13, step 1).~~ Fatto
  l'11 ottobre 2026: vedi la prima voce delle deviazioni.
- Differenze visive accettate rispetto alle PNG attuali (Task 12, step 6).
- Alert configurati e stack di monitoraggio usato (Task 16, step 6).
- Se la procedura di purge e' stata provata almeno una volta (Task 16, step 5).

## Validazione z10 (04/09/2026)

Scoperte che valgono per tutti gli zoom e per la pipeline nazionale.

**L'ordine di sovrapposizione delle superfici e' in `project.mml`, non nei
`.mss`.** Il layer `clc` sta al posto 26, dopo `landcover` (4) e dopo i 12 uso
suolo regionali (19-25): **Corine sta SOPRA i boschi OSM**, non sotto. Avevo
l'ordine invertito e i boschi OSM coprivano Corine: la luminosita' andava a
+14,5 invece di -2,9. Con l'ordine giusto i boschi OSM riempiono solo i buchi
di Corine, che e' il comportamento del riferimento.

**I colori cambiano per fascia di zoom, e non solo le larghezze.**
`landuse_residential` ha quattro colori (`@built-up-lowzoom` z8-10,
`@built-up-z11`, `@built-up-z12`, `@residential` z13+). Tararne uno su una
tile sola porta fuori strada. In `webmapp.mss` tutti e quattro sono
sovrascritti con `@fondogiallo`, quindi nel nostro stile l'urbano e' crema a
ogni zoom.

**Il grigio delle citta' nel riferimento non e' un poligono.** A Prato il PNG
mostra #ccccca compatto: non e' ne' Corine (che da' `@fondogiallo`) ne'
`landuse=residential` (idem), e' il **reticolo di strade minori** che a z10 si
fonde in una massa grigia. Avevo dato il grigio alle classi Corine 1xx: era
sbagliato, annullato. Un colore misurato dice il risultato, ma per attribuirlo
al layer giusto serve il `.mss`.

**Sotto z12 il riferimento cambia modello stradale**: non casing+fill ma un
alone (`::halo`) `#8e8b84` di larghezza `fill + 2` sotto il fill. E le classi
hanno colori distinti che il `.mss` non fa emergere subito — misurati sui
pixel dei PNG serviti: `motorway` **#dd7a61**, `trunk`/`primary`/`secondary`
**#e7c87d**. Il locale disegnava primary e secondary in `#ffffff`, invisibile
sul fondo crema: e' la ragione per cui a z10 la rete stradale sembrava
assente. Le larghezze erano meno della meta' di quelle di TGen (0,89 contro
1,9 a z10).

**La rete stradale a z10-z11 e' strutturalmente piu' povera nel vettoriale.**
Sulla stessa area l'archivio contiene 8 primary + 1 secondary a z10, e 28
secondary + 76 tertiary + 214 minor a z12: e' lo schema OpenMapTiles che
filtra per zoom, mentre Mapnik rende dal database completo. Non si corregge
con lo stile: va deciso se personalizzare i minzoom di planetiler.

**Buco a z13 nell'uso suolo**: `clc-fill` copriva fino a z12 (maxzoom escluso)
e `landcover-fill` partiva da z14 (minzoom escluso). Nessuna fonte a z13.

**Il pre-schiarimento additivo desatura.** `c + (255-c)*f` alza i canali bassi
piu' degli alti: sui verdi il risultato era Δr +2, Δg -3,5, Δb +5,8 — un
grigio-verde slavato al posto del verde pieno del riferimento. Sostituito con
i valori esatti della tabella `#clc` di `webmapp.mss`; la differenza di
luminosita' va compensata regolando l'intensita' dell'ombreggiatura calcolata,
non slavando i colori.

**Metodo.** Agli zoom piccoli il viewport e' piu' largo del bbox generato
(a z10 ~1,07° di vista contro 0,9° di dati): il fondo vuoto entra nella media
e le misure non dicono nulla. `measure.mjs` accetta ora una finestra di
ritaglio e `tile-diff.mjs` dichiara da se' se una tile e' dentro l'area.
Sulla stessa vista: Δlum +5,4 su tutto il viewport, +1,7 sulla parte coperta.

## Lo stile passa a un profilo per zoom generato dal CartoCSS (04/09/2026)

Su indicazione del committente: *"secondo me devi creare per ogni lvl di zoom
un set di parametri che identificano lo stile per quello zoom e non solo lo
stile ma anche cosa deve essere visualizzato e se lo ritieni opportuno anche
l'ordine"*, e poi *"se tgen e' organizzato cosi non possiamo copiare quella
parte?"*.

Aveva ragione su entrambe. Estraevo a mano valori che sono gia' scritti nei
`.mss`, e la trascrizione ha prodotto errori: il grigio urbano attribuito a
Corine (che invece da' `@fondogiallo`) e le curve di livello date a z10-z12.

Ora: `parse-cartocss.mjs` estrae la tabella layer x zoom, `build-zoom-profile`
ne ricava visibilita' e ordine, `build-style` genera lo stile. Corretti 34
scostamenti di visibilita' rispetto al riferimento, fra cui `track` e `path`
da z10 (la rete fitta del riferimento a z10 sono piste e sentieri, non strade
secondarie), le curve solo da z12, le etichette dei parchi solo da z13.

**Su CartoCSS come linguaggio del nostro stile**: valutato e scartato. Il
compilatore verso lo Style Spec non esiste e andrebbe mantenuto; costrutti
come `::halo`, `comp-op: multiply`, `polygon-gamma`, `way_pixels` non hanno
equivalente; CartoCSS ha solo soglie discrete mentre con MVT il client sta
anche a z13,4 e `interpolate` e' continuo; e nessuno strumento della catena
vettoriale lo parla, incluso il validatore. Se lo stile lo mantenesse il
cartografo la scelta andrebbe ridiscussa con lui.

Linea di base misurata dopo il passaggio (punto 10.72,44.21):
z10 -2,6 | z11 +0,6 | z12 +4,1 | z13 -4,6 | z14 -14,0 | z15 -10,6 | z16 -11,8.
La fascia z14-z16 e' troppo scura di 11-14 punti e con contrasto basso: e' il
prossimo intervento, ed e' ora un solo set di parametri da correggere.

## Validazione per livello — stato del ciclo (05/09/2026)

Ciclo richiesto: un livello per volta, si passa al successivo solo quando il
livello e' fedele. **Livello corrente: z10, chiuso.** Prossimo: z11.

Misure z10 (quattro tile dentro il bbox): Δlum fra -2,3 e +0,3, Δcontrasto fra
-3,4 e +2,4.

Corretto a z10:
- **Ombreggiatura calcolata su GPU** (`ol/layer/WebGLTile`) al posto del layer
  `hillshade` dello Style Spec, che in OpenLayers non e' regolabile. Composta
  in `multiply` con `mix-blend-mode` sul canvas del layer: `prerender` non
  funziona, un layer WebGL riceve un contesto WebGL. Parametri per fascia in
  `metadata['wm:hillshade']`, quindi disponibili anche a map-core.
- **Azimut del sole**: la formula usa `atan2(-dzdy, dzdx)`, angolo matematico
  (0 = Est, antiorario), mentre 315 e' un azimut geografico (0 = Nord,
  orario). Passandolo diretto la luce arrivava da Sud-Est e **le vette
  sembravano valli**. Conversione: `angolo = 90 - azimut`.
- **Precisione nello shader**: la differenza di quota si calcola canale per
  canale, non costruendo due quote intorno a 65000 per poi sottrarle — a quel
  valore gli shader WebGL1 quantizzano e compare un tratteggio.
- **Saturazione della palette Corine x1,3**: dove disegnavamo #c0c8b0 il
  riferimento ha #b8d0a8, stessa luminosita' e saturazione maggiore di 16. I
  colori del CartoCSS sono esatti ma le tiles in produzione furono rese con una
  versione precedente dello stile. Vince il PNG. Divario di saturazione da
  4,2 a 0,2.
- **Ombra z8-10**: opacity 0,30 e gamma 1,4. La gamma approfondisce le ombre
  senza toccare le zone illuminate (elevare a potenza lascia 1 invariato);
  l'opacita' compensa la luminosita' che la gamma abbassa. I valori nominali
  del riferimento (0,2) non si applicano: la' l'ombra e' un raster
  pre-calcolato con esagerazione 1,4 su DEM a 100 m.
- **Strade dei livelli bassi** (`pipeline/build-roads-lowzoom.sh`, archivio
  `roadslz` z8-11): lo schema OpenMapTiles a z10 porta 9 strade sull'area, il
  riferimento ne disegna circa 300. Estratte dal PBF con GDAL e tilate con
  tippecanoe. Attenzione al colore: a z10 le tertiary sono BIANCHE con alone
  grigio, l'arancione e' delle sole primary — colorarle di arancione riempie
  la mappa di una rete che il riferimento non ha.
- **Curve di livello**: `comp-op: multiply` tradotto esattamente (moltiplicare
  per un grigio k equivale a nero con alpha 1 - k/255), larghezze e alpha
  tarate sui pixel di linea (da 1999 a 5610 contro 4208-10235 del
  riferimento), e **il filtro delle etichette di quota conteneva `["zoom"]`
  dentro un `["all", ...]`**, che ol-mapbox-style non valuta: le quote non
  venivano scritte affatto.
- **DEM a 2 m** invece di 4: a z16 il ricampionamento `near` duplicava 103
  colonne su 255 e la pendenza calcolata su colonne duplicate disegnava righe
  verticali. Ora 0 su 255. Il maxzoom della sorgente e' **letto dalle cartelle**
  su disco, perche' tenerlo a mano lo aveva lasciato a 14 dopo la
  rigenerazione a z16.
- **tileSize: 256 su tutte le sorgenti vettoriali**: OpenLayers costruisce le
  sorgenti vector su una griglia da 512 px e a vista z13 chiedeva le tile z12
  — un livello di dettaglio in meno del riferimento, senza alcun errore. Vale
  anche per map-core.

Aperto a z10, non risolto: nel verde si vedono ancora **strisce diagonali**
nell'ombreggiatura. Il DEM a 2 m e la correzione di precisione non le hanno
eliminate; il sospetto ora e' l'aliasing in rimpicciolimento, perche' a z15 il
DEM a 2 m e' piu' fine dello schermo e la sorgente usa `interpolate: false`.

Aperto per z13: le curve sono ogni 50 m, il riferimento usa `cl_mr_subd` piu'
fitta. Serve rigenerare l'archivio a 25 m per quella fascia, oppure importare
`cl_mr_subd` e `cl_lr_subd` da TGen (due `COPY ... TO STDOUT` da approvare).

### z11 chiuso (05/09/2026)

Quattro tile: Δlum fra -0,6 e +4,1, Δcontrasto fra -5,2 e +0,8. Corretto:

- **Ombra z11-12**: `opacity 0,38` e `gamma 1,4`. Il riferimento tiene una
  sola fascia z11-13 (#hs25m, opacity 0,18) ma da noi i tre livelli divergono:
  con la stessa opacita' z11 risultava chiaro di 5 punti e z13 in pari, quindi
  **z13 ha un set proprio** (`hs25m-z13`, opacity 0,30) — a z13 le curve
  incise scuriscono gia' la mappa. Il profilo consente un set per livello, ed
  e' la ragione per cui e' organizzato cosi'.
- **Saturazione Corine portata a x1,625** complessivi (x1,3 poi x1,25): il
  divario di saturazione passa da 4,7 a 1,2 e migliora anche z10 (Δb da +0,8
  a -1,5). Tarata su tile di z10 e z11 insieme, per non sistemare un livello
  rompendo l'altro.
- **Etichette delle aree protette**: `symbol-placement: line` su un layer di
  POLIGONI dispone il testo lungo il perimetro e a z11 non trovava spazio —
  non comparivano affatto. Nel riferimento sono centrate nell'area e
  incolonnate: `point` con `text-max-width`.
- **Confini amministrativi**: il riferimento li compone con `opacity 0,5` e
  `comp-op: darken`; a piena opacita' il tratteggio viola dominava la mappa.
  E sotto z12 mostra fino al livello 4 (regioni, province), non al 6.
- **Rifugi**: sono un asset nostro, il riferimento non li ha (la tabella
  esiste su TGen ma non e' in produzione). A z11 quattro etichette a 9,5 px
  dominavano una mappa che nel riferimento e' pulita: a z11 restano le sole
  icone, le etichette entrano da z12 e piu' piccole.

Aperto a z11: mancano gli **scudi stradali** (SS12, SS 12 dir), che il
riferimento disegna. Servono i 660 SVG di `data/tgen-style/symbols/shields/`
nello sprite.

### z12 — in corso

Luminosita' in pari (Δlum +1,0), **contrasto -7,6** non ancora risolto.
Fatto in questo giro:

- **Confini amministrativi**: il riferimento compone con `comp-op: darken`,
  che su fondo verde porta #c699d1 a (186,153,173) — esattamente il #b799b6
  misurato sui PNG. Lo Style Spec non ha `darken`, quindi si usa il tono
  risultante a opacita' piena, con l'alone bianco sotto (i valori del
  CartoCSS: alone 3, linea 3). Il tono ora coincide cifra per cifra; i pixel
  di confine passano da 301 a 543 contro i 3508 del riferimento — il resto
  del divario e' che la nostra tile contiene solo `admin_level` 4 e 8 mentre
  il riferimento legge dal database completo.
- **Impianti di risalita** (`aerialway-line` + `aerialway-dash`, da z12):
  mancavano del tutto. Il riferimento li disegna come linea grigia #808080 con
  sopra un tratteggio nero largo 3-4.
- **Toponimi minori** meno diradati (padding 2 e 1, testo piu' piccolo a z12):
  la tile contiene 4 village e 29 hamlet, il riferimento ne mostra circa otto
  e noi due. OpenLayers dirada piu' di Mapnik.

Verificato e scartato: `admin_level` e' un numero, non una stringa (il filtro
era corretto); la vista e' centrata sulla tile giusta e richiede esattamente
quella tile (nessuno sfasamento, nonostante i toponimi diversi fra i due lati
— dipende solo da quali il diradamento sceglie).

**Dove sta il contrasto mancante**: i percentili dicono che i toni scuri sono
allineati (12760 pixel di linea contro 14420, mediana identica) ma il **primo
percentile del riferimento sta a 74 contro i nostri 131**. Il riferimento ha
elementi quasi neri che non abbiamo ancora identificato: nell'immagine sono
linee scure con simboli in alto a destra. Da verificare `power-line`
(elettrodotti, minzoom 14 nel .mml) e le frecce di direzione.

### z12 chiuso per quanto lo stile puo' fare (05/09/2026)

Δlum +0,3 — ottimo. Δcontrasto **-6,3** (da -7,6), residuo non azzerabile.

Corretto in questo giro:
- **Cime tre volte piu' piccole del riferimento**: 12 pixel ciascuna contro 39.
  Il triangolo dentro l'SVG e' piccolo rispetto al riquadro dell'icona, quindi
  `icon-size` va oltre 1 (1,5 a z11, 1,9 a z14). Le cime sono l'elemento piu'
  scuro della mappa in montagna e pesano sul contrasto piu' di quanto la loro
  area suggerisca: il primo percentile di luminosita' passa da 131 a 108
  (riferimento 74).
- Impianti di risalita e confini, vedi sopra.

**Perche' il contrasto non si azzera**, misurato e non supposto:
1. il confine che attraversa la tile nel riferimento non e' nei nostri dati
   (la tile ha solo `admin_level` 4 e 8, il riferimento legge dal database);
2. il riferimento mostra circa otto toponimi dove noi due, perche' OpenLayers
   dirada piu' di Mapnik (i dati ci sono tutti: 4 village + 29 hamlet);
3. la **varianza locale**: l'area sommitale ha lo stesso colore medio nei due
   lati (188,9 contro 188,6) ma il riferimento alterna bianco e verde piu'
   nettamente. E' `polygon-gamma: 0.5` sul layer clc, che rende i bordi dei
   poligoni meno sfumati; lo Style Spec non ha un equivalente.

Le prime due sono limiti di dati e di renderer, la terza non e' riproducibile.
Con lo stile si e' arrivati dove si poteva: si passa a z13.

### z13 — in corso

Δlum +0,5 / +1,6 (ottimo), Δcontrasto -7,6 / -5,3.

**Le curve NON sono la causa**: i pixel di linea sono 8013 contro 8407 del
riferimento, quindi allineati — la densita' a 50 m contro le 25 m di
`cl_mr_subd` incide meno di quanto sembrasse a occhio.

Il divario e' agli estremi della scala dei toni:
- **primo percentile 151 contro 106**: mancano elementi molto scuri. Nel
  riferimento sono le cime (#5c491d, 129 px) e le **icone di alloggio**
  (#734a08, 100 px) — gli `alpine_hut` di OSM, che noi disegniamo in #8b4a20;
- **95esimo percentile 227 contro 235**: le nostre zone chiare lo sono meno.
  Il tono chiaro dominante del riferimento e' #e8efdc.

### z13 chiuso per quanto lo stile puo' fare

Δlum +0,5 / +1,6. Δcontrasto -7,6 / -5,3, residuo.

Corretto: **colori delle icone allineati alle variabili del riferimento** —
`natural` da #6b4f2a a @landform-color **#5c491d** (cime, passi) e `shelter`
da #8b4a20 a @accommodation-icon **#734a08** (rifugi). Lo sprite va
rigenerato dopo la modifica (`node pipeline/build-sprite.mjs`).

Il primo percentile resta 151 contro 106 perche' il 1% della tile sono 655
pixel e le icone ne coprono circa 300: il resto, nel riferimento, sono
**pixel di testo** (#888986, #93896b fra i toni piu' frequenti). E' lo stesso
limite di z12 — OpenLayers dirada le etichette piu' di Mapnik — e non si
governa dallo stile: `declutter` e' una proprieta' del layer che
ol-mapbox-style imposta da se'.

### z14 — in corso

Δlum -2,8 / -8,4, e soprattutto **Δb -11,7 / -18,7**: a z14 il pattern si
inverte rispetto ai livelli bassi. Il riferimento ha verdi molto piu' tenui
(saturazione 16-18 contro i 41 di z10-12) mentre la palette `regionale` non e'
mai stata tarata e porta ancora i valori del CartoCSS: il locale risulta
**troppo saturo**, il contrario del problema di z10.

La taratura con `tools/tune-palette.mjs` sul set `regionale` ha dato pero'
quattro misure identiche per quattro fattori diversi. La catena funziona —
scrivendo #ff00ff nel set, il colore arriva nello stile generato — quindi il
difetto e' nello strumento, non nel generatore. Da verificare la funzione di
saturazione su colori a bassa saturazione come #becbae, e il fatto che nella
tile di prova `bosco` copre solo il 4% mentre dominano `ricsport` (35%) e
`pascolo` (26%).

### Le due soglie di zoom non sono simmetriche (05/09/2026)

Verificato interrogando i layer OpenLayers a z14: **`minzoom` e' una soglia
ESCLUSA** (un layer con minzoom 12 si vede da z13) ma **`maxzoom` e' INCLUSA**
(un layer con maxzoom 14 si vede ancora a z14). Il generatore le trattava
entrambe come escluse ed emetteva `zmax + 1`.

Conseguenza: `clc-fill` restava visibile a z14 e, stando sopra
`landcover-fill`, lo copriva. A z14 e oltre l'uso suolo regionale non veniva
disegnato affatto e la mappa mostrava ancora Corine — senza alcun errore, e
con la taratura della palette `regionale` che non produceva alcun effetto
(quattro fattori diversi, quattro misure identiche).

Corretto in `pipeline/build-style.mjs`: `maxzoom = zmax`. A z14 la
luminosita' passa da -2,8 a -1,1 e il divario di blu da **-11,7 a -2,7**.

Diagnosi sbagliate scartate lungo la strada, per memoria: la funzione di
saturazione dello strumento (corretta, verificata a mano), le geometrie della
tile (9 poligoni validi, extent 4096), la copertura (108%), il filtro sul
`coduso`. E un errore nel test stesso: cercavo il magenta di prova con una
soglia troppo stretta, senza tenere conto che il `multiply` dell'ombra lo
scurisce fino a (178,0,178).

### Glifi delle cime: tarare sul conteggio dei pixel e' stato un errore

Segnalato dal committente: a z13 i triangoli erano molto piu' grandi del
riferimento. Avevo eguagliato il NUMERO TOTALE di pixel scuri, ma il
riferimento ha 12 cime nella tile e noi ne disegniamo 8: cosi' si compensa il
numero mancante ingrandendo i simboli. Conta la dimensione della singola
icona — nel riferimento il triangolo e' circa 6-7 px a z13. `icon-size`
riportato a 0,85 a z11 e 1,0 a z13.

### z14 — tarato, ma l'archivio OSM e' incompleto

Palette `regionale` **desaturata x0,85** (divario di saturazione azzerato) e
ombra `hs10m` a `opacity 0,20`, `gamma 1,0` — alzare la gamma qui non recupera
contrasto e affonda la luminosita'. Con il maxzoom corretto, Δlum passa da
-2,8/-8,4 a **+2,4 / -4,1 / +0,5** su tre tile.

**Problema aperto, di dati**: nel bbox, a z14, l'archivio `osm.pmtiles` ha 70
tile presenti e **40 assenti** su un campione di 110. Le mancanti sono in
quota: la tile di Pian Cavallaro (14/8679/5944) non esiste affatto, e li' il
riferimento disegna impianti di risalita, sentieri e strade mentre noi
mostriamo solo uso suolo e curve, che vengono da archivi diversi.

Da capire se planetiler scarti le tile prive di feature "principali" o se
l'estratto sia stato ritagliato male: `centro.osm.pbf` copre la zona e il
bbox dichiarato nella provenienza e' corretto.

Nota di metodo: il primo campione dava 94 assenti su 104, ma partiva da
x=8552 che e' longitudine 7,93 — fuori dal bbox. Il range z14 corretto per
10,0-10,9 / 43,9-44,5 e' x 8647-8688, y 5925-5963.

## L'estratto OSM copre meta' area: manca l'Emilia-Romagna (05/09/2026)

Le 40 tile z14 mancanti non sono un difetto di planetiler. Mappando la
presenza delle tile per latitudine emerge un confine netto che segue il
**crinale appenninico**:

    lat 44,504  #....#........
    lat 44,410  ##.#..........
    lat 44,316  ######........
    lat 44,222  ########.....#
    lat 44,174  ##############   <- da qui in giu' tutto presente
    lat 43,937  ##############

`centro-latest.osm.pbf` di Geofabrik copre Toscana, Umbria, Marche, Lazio,
Abruzzo e Molise: **non l'Emilia-Romagna**, che sta in `nord-est`. Meta'
dell'area demo — tutto il versante emiliano, compresi Pian Cavallaro, il
Cimone e i loro impianti, sentieri e strade — non ha dati OSM.

Conseguenze su tutto il lavoro fatto finora: le misure sulle tile a nord del
crinale confrontano una mappa incompleta con una completa, e alcune differenze
attribuite allo stile potrebbero essere solo questo. Le tile usate per le
tarature (10/541/371, 10/542/371, 12/2169/1486, 13/4339/2972) stanno pero'
in gran parte a sud, quindi le tarature di colore restano valide.

**Per l'Italia**: l'estratto va scelto per area geografica, non per regione
amministrativa. Un bbox a cavallo di due estratti Geofabrik ne richiede due,
oppure si parte da `europe-latest` con `osmium extract`, che era gia' la
strada individuata per il rendering nazionale.

## Criterio di valutazione: lo stile, non il contenuto (05/09/2026)

Indicazione del committente: *"l'importante e' che non ti fissi sul contenuto
ma sullo stile del contenuto, questo perche' le tiles png non sono aggiornate
quindi e' ragionevole che siano un po' differenti nel contenuto"*.

Le tiles di riferimento sono ferme (dieci giorni di rendering, aggiornamento
OSM spento), quindi il contenuto diverge per costruzione. Si confronta **come**
sono disegnati gli elementi presenti in entrambi, non **quanti** ce ne sono.

Va riclassificato quanto concluso finora: il Δcontrasto residuo di z12, z13 e
z14 era stato attribuito al diradamento delle etichette e ai dati mancanti, ma
e' in buona parte contenuto diverso — **non un difetto da correggere**. Restano
validi i confronti per elemento: colore dell'autostrada, tono del confine
(darken), traduzione del `multiply` delle curve, dimensione del singolo
triangolo di cima, palette per fascia di zoom.

Restano validi anche i difetti STRUTTURALI trovati, che non dipendono dal
contenuto: `tileSize` 512 (un livello di dettaglio in meno), `maxzoom`
inclusivo (uso suolo regionale nascosto da z14), estratto OSM che copre meta'
area, azimut del sole invertito, precisione dello shader.

## Scudi stradali (05/09/2026)

Tre difetti sovrapposti, sciolti uno alla volta su segnalazione del
committente:

1. **`icon-text-fit` e' ignorato da ol-mapbox-style.** Le icone allungabili
   dello Style Spec (`content` + `stretchX`/`stretchY`) sarebbero la via
   elegante — una sola icona per tipo che si adatta al testo — ma il riquadro
   restava della dimensione base e la sigla sbordava. Verificato cambiando
   `icon-text-fit-padding` da 4 a 8 senza che un solo pixel cambiasse.
   Si generano quindi riquadri di larghezza fissa per numero di caratteri
   (5 tipi x 6 lunghezze, da 21 a 52 px) e lo stile sceglie con
   `length(ref)`, come il riferimento fa con i suoi 660 SVG.
2. **`symbol-placement: line` deforma la sigla**: dispone i caratteri lungo la
   geometria, e su una strada tortuosa "SP12" si spezzava e ruotava seguendo
   le curve. Serve `line-center`, che tiene il simbolo come blocco unico.
   Effetto collaterale: uno scudo per tratto invece di uno ogni 760 px.
3. La soglia di zoom: gli scudi partivano da z13 mentre il riferimento li
   mostra gia' a z11-z12.

Colori dagli SVG del riferimento, distinti per tipo: motorway #eacec6,
trunk #eed9c9, primary #efe4ce, secondary #eeefd7, tertiary #f1f1f1. Nel
CartoCSS scaricato **entrambi i blocchi `#roads-text-ref` sono commentati**
(righe 2555-2715) ma la produzione li disegna: la soglia viene dai PNG.

### Il contrasto agli zoom alti resta aperto (05/09/2026)

z15 -7,5 e z16 -12,2 di contrasto, con la luminosita' in pari. Misurato:

- **non e' l'ombreggiatura per intensita'**: alzando l'opacita' il contrasto
  migliora (da -9,6 a -5,8) ma la luminosita' affonda (da -5 a -19). Il nostro
  `multiply` puo' solo scurire;
- **non e' la componente di pendenza da sola**: aggiunta al calcolo su GPU,
  con valori da 0,3 a 0,9, non sposta il contrasto e scurisce soltanto;
- **e' l'escursione dei toni**: il confronto posizionale mostra che dove noi
  abbiamo un tono intermedio il riferimento ha SIA zone piu' chiare (Δ -25)
  SIA zone piu' scure (Δ +37). I percentili concordano: 25esimo +20, 95esimo
  -11.

La spiegazione e' che il riferimento compone la pendenza in `comp-op:
overlay`, che scurisce sotto la meta' e schiarisce sopra — cosa che il
multiply non fa. Il tentativo di usare `mix-blend-mode: overlay` sul canvas
del layer non ha funzionato: la classe non viene applicata a runtime
(`getRenderer().getCanvas()` non espone l'elemento atteso). Va ripreso
costruendo il layer gia' con la classe giusta per fascia, o con due layer
sovrapposti — uno in multiply per la luce e uno in overlay per la pendenza.

I sentieri escursionistici sono stati intanto rigenerati sull'area completa
(`pipeline/build-hiking-full.sh`, l'archivio passa da 2,3 a 5,0 MB): a z16 il
sentiero CAI 449 mancava del tutto perche' l'archivio veniva dal PBF che
copriva meta' area.

## Confronto per elemento: lo strumento che mancava (05/09/2026)

`tools/element-diff.mjs` confronta il TONO dominante di ogni categoria di
elemento (verde, curve, strade chiare, strade gialle, sentieri, confini,
acque) fra i due lati, su piu' livelli. Il numero di pixel e' solo contesto:
uno scarto di tono su pochi pixel resta un difetto di stile, una differenza
di quantita' a parita' di tono no — ed e' il criterio indicato dal
committente.

Ha subito trovato quello che le medie non vedevano. Il **sentiero CAI** aveva
lo stesso numero di pixel del riferimento (658 contro 633) ma tono sbagliato
di 50 punti: il riferimento lo compone in `multiply` con opacita' 0,6, noi
con lo stesso colore ma senza. Corretto calcolando il colore equivalente sul
fondo verde tipico (#ab2c20 invece di #e5372f): lo scarto scende a 15.

Risultato piu' importante, pero', e' la mappa di cosa combacia e cosa no:

| elemento | z10-z12 | z13-z16 |
|---|---|---|
| acque interne | Δ 44-48 | **Δ 0-1** |
| strade chiare | Δ 8-24 | Δ 1-17 |
| strade gialle | Δ 0-65 | — |
| verde vegetazione | Δ 3-7 | Δ 20-41 |
| curve di livello | Δ 18-49 | Δ 0-20 |

**Gli elementi che non ricevono l'ombreggiatura combaciano quasi
perfettamente** (le acque interne a z13+ sono Δ 0 0 1), quelli che la
ricevono no. E il verde peggiora salendo di zoom, fino a +41 a z16: e'
coerente con il fatto che il riferimento ha piu' escursione di toni, non un
colore base diverso.

Ipotesi provate e scartate sulle acque a z10-z12: non e' il mare (la tile ha
solo `lake` e `river`) e non e' il bordo mancante (aggiunto `water-outline`
perche' `fill-outline-color` non e' applicato da ol-mapbox-style, ma la
misura non si e' spostata). Resta da capire.

### Il verde: non e' il colore base, e' che manca la gradazione (05/09/2026)

Misura conclusiva. Il tono verde dominante e' **identico con e senza
ombreggiatura** (189,201,161 in entrambi i casi, a z13 e a z16): l'ombra non
incide sulle aree pianeggianti, che sono quelle che dominano.

Distribuzione dei toni di verde a z13, quantizzata a 10:

    locale:      rgb(190,200,160) x24764   <- un tono su tutto
                 rgb(200,220,180) x4581
                 rgb(180,190,150) x2067
    riferimento: rgb(170,180,150) x7492    <- quattro toni comparabili
                 rgb(190,200,170) x7400
                 rgb(160,170,150) x5815
                 rgb(180,190,170) x3095

Il nostro dominante copre cinque volte il secondo; il riferimento distribuisce
l'area su quattro toni. **Non e' il colore base** — il loro rgb(190,200,170)
e' il secondo piu' frequente e dista 10 dal nostro solo sul blu — e' che noi
disegniamo una tinta piatta dove loro hanno una gradazione.

Spiega anche il resto: la luminosita' media e' in pari perche' il nostro tono
unico sta al centro della loro gamma, e il contrasto e' basso perche' non
abbiamo la gamma. Le tre ipotesi provate sull'ombreggiatura (intensita',
componente di pendenza, composizione in overlay) cercavano di ricavare quella
gradazione dall'ombra: non potevano funzionare.

Da verificare: `polygon-gamma: 0.5` sui poligoni Corine, e se il riferimento
sovrapponga piu' fonti di uso suolo semi-trasparenti.

## I PNG di TGen hanno due stili (10/10/2026)

**Deviazione dal metodo seguito finora.** Le tarature fino a ieri trattavano
il riferimento come uno stile solo. Non lo e': z0-z12 sono stati resi nel 2018
con uno stile che non esiste piu', z13-z16 da settembre 2025 con
`project.xml` del 23 febbraio 2025, l'XML compilato che Mapnik legge. Fra i
due cambia quasi tutto quello che ha un colore: acqua (`#acd4ea` contro
`#dce7f7`), confini (verdi contro lilla), bande dei parchi (viola contro
verdi), uscite autostradali (`#960000` contro grigio), i tre boschi del Corine
(distinti nel 2018, quasi uguali oggi), piste e sentieri (assenti fino a z12
nel 2018). Ogni correzione unica tarata su una media dei due stili sbagliava da
una parte e dall'altra.

**Decisioni prese, in applicazione della regola fondante:**

- z13-z16: si copia `project.xml` (colori, soglie in scale denominator,
  larghezze). E' la specifica esatta, e misurare li' serve solo per il rilievo.
- z0-z12: la specifica sono i PNG del 2018, misurati per classe con
  `tools/colore-per-classe.mjs` su molte tile. Dove una regola del `.mss`
  di oggi disegna qualcosa che nel 2018 non c'era (piste e sentieri a
  z10-z12), vince il PNG.
- Le soglie decise sui PNG vanno nel campo `livelli` di
  `style/tgen-mapping.json`: prima stavano solo nel profilo, e rigenerarlo
  le cancellava (28 eccezioni perse in silenzio).

**Errori trovati strada facendo, tutti invisibili alle medie:**

- Le larghezze delle strade erano di un livello indietro: scritte gia'
  compensate a mano e poi spostate di nuovo da `build-style`. A z13
  l'autostrada era 2,5 px invece di 5.
- Le etichette avevano la priorita' rovesciata (vedi CLAUDE.md): a z13 i
  nomi delle vie cancellavano quelli dei paesi.
- Sotto z8 l'ombreggiatura usava il set di z16.
- `landcover-osm` aveva una palette sua, benche' la documentazione dicesse
  il contrario.
- Ferrovie, uscite autostradali e aeroporti mancavano del tutto; gli
  aeroporti erano nell'archivio, ma nessun gruppo del manifest li portava e il
  filtro li scartava.

## Secondo giro: copertura dei layer di TGen (11/10/2026)

**Metodo.** Invece di cercare le differenze a occhio, `tools/tgen-copertura.mjs`
elenca i layer del `.mml` che disegnano qualcosa fino a z16 e che nessun layer
locale cita (campi `tgen` o `copre` del mapping). Erano 33; ne restano 11
minori. E' il controllo che la regola "emulare e' un algoritmo" presupponeva e
che non esisteva.

**Decisione.** Cio' che OpenMapTiles non porta (dighe, frangiflutti, aree
pedonali, filari, nomi di ferrovie ed edifici) va in un archivio a parte,
`extra`, estratto dal PBF con le condizioni del `.mml`
(`pipeline/build-extra.sh`), come gia' `power` e `parchi`.

**Tre comportamenti del motore, tutti silenziosi:** `symbol-spacing` vale il
doppio in ol-mapbox-style; i confronti con `["zoom"]` nei filtri scattano un
livello dopo (`build-style` ora li rifiuta); `parse-cartocss` non legge i
selettori di classe (`.stations`, `.text`). E un limite che resta: lungo le
linee OpenLayers non cerca una posizione libera come Mapnik, quindi alcuni
numeri dei sentieri su tracciati tortuosi non compaiono.

## Terzo giro: anche i layer che il controllo non vedeva (11/10/2026)

`tgen-copertura` ora non trova layer scoperti, ma il parser del CartoCSS non
legge i selettori di classe: nomi di regioni e nazioni (`.state`, `.country`) e
barriere (`.barriers`) risultavano "senza regole" e non comparivano
nell'elenco. Sono stati aggiunti leggendo il `.mss` a mano.

**Scoperta.** Nei PNG del 2018 `@admin-boundaries` valeva `#55933b`, il verde
che oggi e' dei parchi: confini, nomi delle nazioni e delle regioni tornano
esattamente con le formule del `.mss` (darken, desaturate) applicate a quel
verde. Era la stessa inversione gia' vista fra confini e bande dei parchi.

**Decisione.** Le citta' non si prendono piu' da OpenMapTiles ma dal PBF, con il
punteggio di `placenames-medium` (popolazione, doppia per i capoluoghi di
regione): decide il livello d'ingresso e, ordinando le feature, la precedenza
fra nomi vicini. La finestra dei nomi di regioni e nazioni viene per ora da una
tabella di superfici; sul server va calcolata dai poligoni OSM, che includono le
acque territoriali.

## Quarto giro: l'ombra per classe di versante e i filtri troppo stretti (11/10/2026)

**L'ombra da z14 a z16.** L'utente vedeva TGen piu' marcato mentre le medie
globali erano a posto (z15: -2,1 di luminosita', -0,2 di contrasto). Le medie
mescolano ombra, curve, etichette e uso del suolo. `tools/ombra-per-classe.mjs`
rende le superfici e il resto senza ombra con maplibre-native e confronta TGen
con il modello d'ombra solo sui pixel liberi, raggruppati per pendenza ed
esposizione. Risultato: TGen schiarisce i piani e i versanti al sole di 3-4
punti e scurisce i ripidi di 2-5, quasi a prescindere dall'esposizione — l'effetto
del suo `#slope10m`. Con la luce a 45 gradi nessuna combinazione di
esagerazione, gamma, opacita' e pendenza lo rende; con la luce a 60 gradi si':
scarto medio per classe da 3,6 a 2,2 su nove zone per livello (il Monte Pisano e
le otto del campione). Lo stesso set e' il migliore a z14, z15 e z16, com'e'
giusto con un solo raster. **Deviazione**: opacita' 0,35 invece dello 0,3
dichiarato da TGen, perche' il tono del suo raster non lo conosciamo (con 0,3 lo
scarto e' piu' alto del 10%). Per poterla cambiare per livello, l'elevazione del
sole e' diventata una variabile dello shader della preview: era una costante
presa dal primo set, quindi `sunElevation` nel profilo sembrava configurata e
non lo era.

**Quattro filtri piu' stretti di TGen**, trovati dall'utente guardando la mappa.
Nessuna misura poteva vederli: si confronta solo cio' che c'e' da entrambe le
parti.

- Le **localita'** (`place=locality`, `farm`): il layer `place` di OpenMapTiles
  le scarta per schema, quindi `place-minor`, che le prevedeva nel filtro, non
  le riceveva mai. Ora vengono da `osmpoi` (layer `place-minor-osm`, nel dato da
  z14).
- I **rifugi disegnati come aree** (in Italia circa tre su quattro) e le icone
  **senza nome**: `osmpoi` leggeva solo i punti con nome. TGen prende punti e
  aree (`amenity-points-poly`) e non chiede il nome per le icone. Le aree
  diventano un punto interno (`punto-interno.py`, come `ST_PointOnSurface`).
- I **guadi sui nodi**: `build-extra.sh` prendeva solo le vie (`amenity-line`),
  ma in OSM i guadi sono quasi tutti nodi (`highway_ford` di
  `amenity-points`). Nella cella di Pisa: 53 vie contro 2.242 nodi.
- I nomi di **`drain` e `ditch`**: TGen li scrive come i torrenti, da z15;
  `waterway-label-stream` prendeva solo `stream`.
- I nomi delle **grotte**: TGen li scosta di 11 px (`text-dy`), il nostro
  layer di 7 come per le selle. Con 7 il nome cade sotto l'icona da 14 px, e in
  OpenLayers l'icona, che viene dopo, vince: il nome spariva.

Pubblicati nella versione `20261011-2130` (con `osmpoi` ed `extra` rigenerati
sul PBF nazionale; gli altri archivi sono quelli di `20261011-1804`, in hard link).

**Il diradamento di tippecanoe.** Sotto il livello massimo tippecanoe tiene di
serie una frazione dei punti (`-r 2.5`): a z13 l'archivio dei POI aveva solo una
parte dei rifugi, scelti dalla densita' locale. Con l'archivio piu' ricco il
Rifugio Genova e' sparito da z12-z13 mentre prima c'era: era fragile anche
prima. TGen li mostra tutti da z13. Ora `build-osmpoi.sh` usa `-r1` e mette ogni
tipo nel dato dal livello in cui lo stile lo disegna (uscite z11, rifugi z13, il
resto z14): i livelli bassi restano leggeri senza perdere nulla.
