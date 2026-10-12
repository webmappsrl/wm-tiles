# Stato del lavoro e decisioni aperte

> Aggiornato all'**11 ottobre 2026**. Questo file va aggiornato quando cambia
> lo stato: è il punto da cui si riprende.

## L'obiettivo, in due fasi

wm-tiles sostituisce la produzione di TGen, oggi fatta a mano. Produce sia i
PNG sia le tile vettoriali, dalla stessa sorgente e con lo stesso stile:

1. **prima i PNG**, per aggiornare quelli già prodotti da TGen, senza toccare
   il frontend;
2. **poi i vettoriali**, quando il frontend sarà aggiornato.

Di conseguenza il primo prodotto da consegnare sono **PNG aggiornati**, non
l'Italia vettoriale: vedi la tabella di marcia qui sotto.

## Dove siamo

Siamo dentro il **Task 12 — Convergenza dello stile** del piano in
[`features/server-tiles-osm/plan.md`](features/server-tiles-osm/plan.md).

**Fatto** (task 1-11): il servizio, la pipeline dei dati, gli archivi
versionati, il manifest dei gruppi, il filtro dei livelli sul protobuf, le
rotte delle tile, la preview di confronto, lo stile generato, sprite e glifi,
il rilievo dal DEM.

Lo stile è convergente: su **z10–z16** la somiglianza al riferimento è entro
**±2,5 di luminosità** e **±1,8 di contrasto**.

L'area generata copre Appennino Tosco-Emiliano e Monte Pisano
(`10,0 43,62 10,9 44,5`).

## Tabella di marcia

Le tappe in ordine; ✅ fatto, ◐ in corso, ☐ da fare. Senza stime di tempo.
Le decisioni che aspettano una risposta sono segnate **[decisione]**.

### Fase 1 — PNG al posto di quelli di TGen

| | tappa | cosa manca |
|---|---|---|
| ✅ | **Stile vicino al riferimento** (Task 1-12) | z10–z16 entro ±2,5 di luminosità e ±1,8 di contrasto |
| ✅ | **Renderer PNG e aggiornamento incrementale** | `render-png.mjs` (maplibre-native dall'11 ottobre 2026; `render-png-docker.sh` sui server Linux), `diff-versioni.mjs`; PNG visibili nella preview con `?destra=png` |
| ◐ | **Rifiniture dello stile** | z16 mai validato per elemento; aree chiare d'alta quota a z10-z12; spostamento di 1-3 px a z15-z16 (dati) |
| ✅ | **Regola fondante: si copia lo stile dei PNG e di TGen, non il contenuto** | vale a ogni livello, anche dove i PNG sono del 2018: lo stile tarato finora resta. L'aggiornamento riguarda i dati, che wm-tiles rigenera comunque |
| ◐ | **Capire la consegna di oggi** | trovata: script in `/root/wm-mapserver` su TGen, poi `rsync` verso il server di `api.webmapp.it`. Da leggere lo script principale (`generate_map_tiles.sh`) |
| ✅ | **Deciso: wm-tiles non gira su TGen, ma su un server nuovo dedicato** | TGen resta in sola lettura |
| ◐ | **Tile PNG su S3 e CloudFront** (`tiles.maphub.it`) | **creati l'11 ottobre 2026**: stack `wm-tiles-png` (bucket privato, distribuzione `E1AR48NAFQPA3F`, utente di consegna `wm-tiles-delivery` con la chiave solo sul server), cartelle `png/default/`, `png/{shard}/default/`, `png/{shard}/{app}/`; provati caricamento, invalidazione, divieto di cancellare, 200/404 e CORS. Le tile di `api.webmapp.it` non si migrano. **`tiles.maphub.it` passa da CloudFront dall'11 ottobre 2026** (PNG da S3, il resto dal server via `origine.tiles.maphub.it`). Manca solo che le app passino a `https://tiles.maphub.it/png/default/{z}/{x}/{y}.png` |
| ◐ | **Preparare il server** | fatto l'11 ottobre 2026: Hetzner Cloud CCX33 (8 vCPU, 32 GB) e Volume da 500 GB a Falkenstein, `ssh wm-tiles`, preparato con `infra/prepara-server.sh` (runbook, "Preparare un server"). Mancano i dati (copia da TGen), GraphHopper. Il server delle tile è un servizio e risponde su `https://tiles.maphub.it` (11 ottobre 2026, `infra/pubblica-dominio.sh`, Caddy con certificato Let's Encrypt) |
| ✅ | **Deciso: il DEM a 10 m di TGen** | da trovare in `/mnt/sdb1/mapdata/dem`; dopo il cambio, ricontrollare le tarature dell'ombra su tutta la scala |
| ✅ | **Deciso: si genera quello che ha generato TGen, solo per l'Italia** | livelli z0–z16. Le zone estere generate da TGen non interessano: sul server restano come sono, e la consegna non deve cancellarle |
| ✅ | **Deciso l'11 ottobre 2026: le quote del DEM fino a z14**, reversibile (da TINITALY si rigenerano fino a z16 quando servisse, per esempio con un rilievo più fine) | proposta z14 (~8 GB) invece di z16 (~130 GB): i PNG arrivano comunque a z16. **Verificato l'11 ottobre 2026** su 12 tile z15-z16 delle celle di prova: con le quote fino a z14, ingrandite come fa la preview (`render-png.mjs --dem-max 14`), i PNG differiscono da quelli con le quote fino a z16 di meno di 0,6 livelli di grigio su 255 in media (8 al massimo), luminosità entro 0,2, contrasto entro 0,04: TINITALY a 10 m non ha dettaglio oltre z14 |
| ☐ | **Copiare da TGen i dati per tutta l'Italia** (Task 14) | in sola lettura, una volta: uso suolo delle 12 regioni e `land_cover_hr`, Corine, i 9 strati IGM, ghiacciai del Piemonte, toponimi, rifugi, i sorgenti dello stile; il DEM se conviene. Salvare ogni query in `pipeline/sql/` |
| ☐ | **Strati IGM e ghiacciai nello stile locale** | TGen li disegna da z14 (vedi sotto), il locale no |
| ✅ | **Copia completa da TGen, una volta — sul server nuovo** | fatta l'11 ottobre 2026 in 45 minuti, da TGen al server direttamente: i 27 layer (8,4 GB compressi), l'inventario `grid_1x1` (61.200 celle) e TINITALY (193 GeoTIFF e un `.vrt`, 16 GB), in `/data/wm-tiles/tgen-copia/italia`. Il server ha usato una chiave sua, valida solo dal suo indirizzo, e una regola in uscita sulla porta 22 verso TGen: entrambe da togliere ora che la copia è finita. **Va salvata anche fuori dal server**: i backup Hetzner non coprono il Volume |
| ◐ | **Copia delle celle di prova, sul Mac** | `pipeline/copia-da-tgen.sh <dest> W,S,E,N`: stesse query limitate alla cella, solo i file di TINITALY che la toccano |
| ☐ | **Generazione guidata dall'inventario** | dato un elenco di celle, la pipeline produce tutto; celle e livelli li legge da `grid_1x1` (anche z17–z18 dove TGen li ha); si ferma solo davanti a un layer del `.mml` che non sa mappare |
| ◐ | **Confronto automatico con TGen** | `tools/revisione.mjs` (12 ottobre 2026, `docs/features/revisione-tile/`): campione stratificato, misura per layer e per simboli, residuo, dossier, registro dei verdetti, regressioni fra giri. Collaudato togliendo un layer apposta (`--senza`, `--ignora`). Sulle celle di prova (`prova3`, 193 tile): 46 difformita', tutte giudicate in `docs/revisione/verdetti.json` — 33 stile, 5 mancanze di dato, 4 contenuto, 3 errori della misura, 1 motore. Le correzioni, per causa, sono nella riga "Correzioni dalla revisione". Sul server, per l'Italia da z5: da lanciare con `--copertura` |
| ◐ | **Icone dei punti di interesse** (12 ottobre 2026) | mancavano su tiles.maphub.it quasi tutte quelle di TGen (chiese, biblioteche, cinema, golf, parcheggi... una sessantina di classi): lo stile ne copriva una decina. Ora `pipeline/regole-amenity.py` estrae da `project.xml` le regole di amenity-points, -poly e -low-priority (`style/amenity-regole.json`); `build-amenity.py` calcola `feature` come le query di TGen, valuta le regole livello per livello (con `way_pixels` per le aree) e scrive icona e livello d'ingresso nel dato (archivio `amenity`, z10-z16); `svg-amenity.mjs` porta nello sprite i simboli di TGen con il loro colore; layer `amenity-icon`. Verificato su 15/17331/11949 (golf, P) e 16/34661/23900 (chiese, biblioteca). Fuori per ora: icone che TGen mette solo da z17 (riferimento fino a z16) e i nomi dei punti di interesse (`.text` di amenity-points). **Su tiles.maphub.it dal 12 ottobre 2026, 21:25** (versione `20261012-1435`, insieme alle correzioni della revisione): verificato da fuori a Pisa, Roma, Milano, Napoli, Palermo |
| ◐ | **Correzioni dalla revisione** (12 ottobre 2026) | **fatte** (versione `20261012-1605`, server riavviato): tolto `water-outline`; sentieri solo CAI rilevati (`build-hiking-full.sh` con `pipeline/osmconf-con-source.ini`: GDAL di serie scarta il tag `source`, 445 relazioni su 977); fiumi z8-z12 da PBF (`roadslz/fiumi`, layer `waterway-river-lz`); piste e sentieri a z13 (`--transportation_z13_paths=true` in `build-osm.sh`); sentieri come `project.xml` (0,7/1/1,3 px, alone da z15); bordo delle strade a z12 come il PNG 2018 (`#af963a`, `#99a741`, stima da verificare); niente cartellini da z13 (nei PNG 2025 non ce n'e' nessuno). La revisione ora rende ogni tile nel suo blocco 4x4, come in produzione. **Quote e nomi dei fossi mancano ancora nei PNG** (15/17361/12023): con il solo layer `contour-label` compaiono, con lo stile completo no, sia da sola sia a blocchi; qualcosa dello stile le blocca, da trovare. **Fiumi**: l'estrazione dal PBF (`waterway-river-lz`) e' fedele a TGen ma sulle celle non cambia quasi nulla; i fiumi che mancavano sono oggi `stream` in OSM, cioe' contenuto (verdetti corretti). Il confine marittimo a z10 e' scuro solo in maplibre-native (opacita' sommata sulla costa frastagliata), in OpenLayers e' giusto. `render-png.mjs` non cade piu' su un errore di rete. **Da fare**: giudicare il giro `prova5` (`--confronta prova3`: i "sparito" di `water-outline`, `road-ref`, `waterway-river` z9-z12 e dei sentieri non CAI sono voluti; da guardare le regressioni z12 `boundary`, `road-fill-motorway`, `road-fill-secondary` e `z16:residuo:#b0b0b0`); verificare il bordo z12 rimisurando; cartellini z11-z12 piu' fitti; soglia dei nomi di boschi e riserve; densita' delle quote in OpenLayers (TGen ne scrive di piu'); guadi (66 nell'archivio `extra`); confine marittimo nei PNG. **Osservati**: cime senza nome solo nel locale, piccoli specchi d'acqua a z13 solo nel locale, ferrovia z13 diversa |
| ◐ | **Prime celle: Pisa e Caltanissetta** (deciso) | **generate il 10 ottobre 2026**, versione `20261010-1923`, con `pipeline/build-celle.sh` (circa 30 minuti): OSM Geofabrik dell'8 ottobre, uso suolo e Corine da TGen nell'ordine del `.mml`, curve z12–z13 da TGen e da z14 dal DEM, TINITALY fino a z16. L'area di prova precedente è in `data/dem/terrain-prototipo` e `contours-prototipo.pmtiles` |
| ◐ | **Tarare l'ombra su TINITALY** (ripreso il 10 ottobre 2026) | da z14 composizione NORMALE a 0,3 come `#hs10m` di TGen (prima `multiply`, e il cambio di composizione non arrivava mai al canvas: vedi CLAUDE.md); gamma 0,6 da z14 (era 0,7: con strade e elementi giusti la mappa era 2 punti più scura); z13 opacità 0,12; z12 opacità 0,22 ed esagerazione 1,5 (con 2 i boschi sui versanti ripidi erano 8-12 punti troppo scuri); z11 opacità 0,21 ed esagerazione 2,2; z15 pendenza 0,3; z16 esagerazione 1,5. Strumento rapido: `tools/taratura-ombra.mjs` | le opacità `hs-z8`…`hs-z16` sono tarate su Copernicus; sul Monte Pisano il rilievo locale è più chiaro di TGen |
| ✅ | **Ombra da z14 a z16 tarata sui PNG di TGen, per classe di versante** (11 ottobre 2026) | luce a 60 gradi, esagerazione 2, gamma 1,1, opacità 0,35, pendenza 0: un solo set per i tre livelli, come TGen usa un solo raster da z14. Le medie globali dicevano che z15 era già giusto (-2,1 / -0,2) mentre a occhio TGen era più marcato: `tools/ombra-per-classe.mjs` confronta solo i pixel senza niente sopra, per pendenza ed esposizione, e ha mostrato che TGen schiarisce i piani e scurisce i ripidi quasi a prescindere dall'esposizione. Con la luce a 45 gradi nessuna combinazione lo rendeva; con la luce alta lo scarto medio per classe scende da 3,6 a 2,2 su nove zone per livello. L'elevazione del sole ora è una variabile per livello anche nello shader della preview (prima era quella del primo set). Restano più scuri di 7-8 punti i versanti in ombra oltre 35 gradi (2% dei pixel di montagna) | **z7–z13 rifatti il 12 ottobre 2026** con lo stesso strumento, dopo che l'utente ha visto la Sardegna senza rilievo: le quote c'erano, ma l'ombra dei livelli bassi era troppo debole ovunque e sul rilievo dolce spariva. Esagerazione 2,5-3, gamma 0,8, opacità 0,16-0,28 in `multiply`: scarto per classe da 3,5-5,1 a 1,05-1,9 su otto zone (tre in Sardegna) |
| ✅ | **Edifici IGM nello stile** | archivio `igm` (z14), layer `building-igm` con la regola degli edifici OSM, come TGen; in `build-celle.sh` |
| ✅ | **Linee elettriche, tralicci e pali** | mancavano: OpenMapTiles non li porta. `pipeline/build-power.sh` li estrae dal PBF, archivio `power` (z14); quattro layer con le regole di `power.mss` e i simboli di TGen nello sprite |
| ✅ | **Cartellini stradali a z10-z12** | OpenMapTiles a quei livelli non porta i numeri: estratti dal PBF in `roadslz` come PUNTI (`pipeline/punti-cartellini.py`), perché ol-mapbox-style non mette icone su linee sotto i 150 pixel. Scala di TGen: autostrade da z10, superstrade e primarie da z11, secondarie da z12. Distanza fra cartellini uguali 250 px per livello (`shield-min-distance`), con il livello d'ingresso nel dato: prima uno ogni 4 km a ogni livello, cioè 36 px a z10. I cartellini di OpenMapTiles (`road-ref`) da z13, come `roads-text-ref`: insieme davano doppioni |
| ✅ | **Strade a z10-z12 come il PNG del 2018** | autostrade `#dd7a61`, superstrade `#e5a269` a z10-z11; a z12 autostrade `#e29884`, superstrade `#ecb78d`, primarie `#f2d9a2`; le secondarie a z10-z11 sono grigie sottili (solo `roadslz`): i doppioni gialli di OpenMapTiles sono tolti. La nota del CLAUDE.md sulle "provinciali gialle" veniva da una provinciale classificata primaria nel 2018 |
| ✅ | **Confini comunali** | z12 verdi tratteggiati (PNG 2018, rgb 144,177,145), da z13 `#c699d1` 1,5 px tratteggio 5,2 a opacità 0,5 (admin.mss) |
| ✅ | **Torrenti stagionali tratteggiati** | `intermittent=1` tratteggiato 4,3 come water.mss; torrenti larghi 3 da z15 |
| ✅ | **Carrarecce come TGen** | da z13 larghezza 0,7, opacità 0,8, tratteggio lungo; da z15 larghezza 1,5 e bordo bianco al 40% (`track-casing`), da `roads.mss` | `igm_edifc` e `igm_edi_min` sono copiati (Pisa 930 mila, Caltanissetta 350 mila) ma non ancora disegnati: TGen li disegna da z14 con le regole degli edifici OSM |
| ✅ | **Due stili nei PNG, due palette** (10 ottobre 2026) | z0–z12 sono del 2018 (stile perduto: si misura sui PNG), z13–z16 del 2025, resi con `project.xml` del 23 febbraio 2025 (specifica esatta). Corine: set `corine-2018` per z7–z12, misurato classe per classe su 96 tile (ora entro ±2 a z11 e z12, prima fino a 14); set `corine` per z13 con i valori esatti dell'XML. `build-style` fa uno `step` sullo zoom quando un layer attraversa due set |
| ✅ | **Acqua per fascia** | `#a6cce1` z0–z6 (sotto `hsworld`), `#acd4ea` z7–z12, `#dce7f7` da z13: coincide al pixel su z11–z13 |
| ✅ | **Uso suolo OSM legato alla palette** | `landcover-osm` aveva colori suoi; ora segue `landcover.mss` sottoclasse per sottoclasse (rocce e ghiaioni `@bianco`, sabbia e coltivi `@fondogiallo`, frutteti e vigneti `@frutteti`...) |
| ✅ | **Larghezze delle strade** | erano tutte di un livello indietro (compensate a mano e poi di nuovo da `build-style`): a z13 l'autostrada era 2,5 px invece di 5. Ora le tabelle di `roads.mss` per classe, con rampe, residenziali più sottili delle terziarie, strade di servizio da z13, alone bianco al 40% fino a z11 |
| ✅ | **Livelli bassi come i PNG del 2018** | z10–z12 senza piste e sentieri (nel 2018 non c'erano); secondarie e terziarie grigie `#bbb` fino a z11; confini verdi fino a z12 (lilla da z13); bande dei parchi viola `#ae24c6` a z12 (verdi da z13; misurato sul quarto più viola, entro 5 punti); nomi dei parchi `#8f8491` a z10–z12 |
| ✅ | **Elementi che mancavano** | ferrovie (da z8, `roads.mss`), uscite autostradali (`#junctions`, da z11, nell'archivio `osmpoi`), soglia di superficie dei parchi (`way_pixels > 3000`, `pipeline/parchi-soglia.py`) |
| ✅ | **Priorità delle etichette** | Mapnik dà la precedenza a chi viene prima, OpenLayers a chi viene dopo: le etichette ora sono in ordine inverso al `.mml` e a z13 i nomi dei paesi non sono più coperti da quelli delle vie. Nomi di paesi e località con le dimensioni di `placenames.mss` (località solo da z15) |
| ✅ | **Ombra sotto z8** | ricadeva sul set di z16 (composizione normale, velo grigio): ora `hs-z7` e `hs-z0-6` |
| ✅ | **Deciso: i toponimi restano spenti di serie** (11 ottobre 2026) | TGen non disegna la tabella `names_along_lines` e nei suoi PNG quei nomi non compaiono a nessun livello: le tile restano fedeli a TGen. Il layer resta nello stile con `visibility: none`, così l'app vettoriale potrà accenderlo; prima vanno ripuliti i dati (maiuscole, nomi vuoti, copertura a macchia di leopardo) |
| ✅ | **Aeroporti, boschi, traghetti, icone** | aeroporti con icona e nome viola (z10 i maggiori, z11–z13 tutti; `aerodrome_label` era nell'archivio ma nessun gruppo del manifest lo portava); nomi dei boschi `#46673b` (`text-poly`, layer `boschi` nell'archivio dei parchi); rotte dei traghetti da z8; icone POI come `amenity-points.mss` (da z16, ristoranti e bar mai fino a z16); nomi di laghi e bacini orizzontali da z8 con la soglia di superficie (layer `acque`); quote delle curve senza alone e più fitte da z15, come `cl_hr_subd_labels` |
| ✅ | **Ombra di z11** | esagerazione 2,2 e opacità 0,21: contrasto da -3,6 a -1,3. Il contrasto mancante lo coprivano le piste, che a z11 nel 2018 non c'erano |
| ✅ | **Secondo giro, elemento per elemento** (11 ottobre) | `tools/tgen-copertura.mjs` elenca i layer del `.mml` senza corrispondenza: erano 33, ora 11 minori. Aggiunti: gallerie (bordo tratteggiato, riempimento schiarito) e ponti (bordo nero da z13); stazioni e fermate (`stations.mss`, che il parser non leggeva); piste degli aeroporti; pontili, frangiflutti, dighe e traverse; aree pedonali e stradali; filari; nomi delle ferrovie principali e degli edifici grandi; aree dei ponti. Nuovo archivio `extra` (`pipeline/build-extra.sh`) per ciò che OpenMapTiles non porta |
| ✅ | **Etichette e simboli con le regole di TGen** | nomi delle strade per classe (statali da z13, terziarie da z14, residenziali da z15, servizio e sentieri da z16), neri con alone del colore della strada; nomi dei torrenti da z15; quote delle curve senza alone; sentieri CAI come `hiking_trails.mss` (un colore, E/EE tratteggiati, EEA a puntini, `cai_scale` nell'archivio); confini per livello amministrativo come `admin.mss` (il bordo bianco era invisibile in TGen); sorgenti, selle e grotte con i simboli di TGen; niente curve a quota 0 (anelli di rumore sul mare) |
| ✅ | **Tre errori di motore trovati** | `symbol-spacing` vale il doppio in ol-mapbox-style; i filtri con `["zoom"]` scattano un livello dopo (ora `build-style` li rifiuta); le soglie di larghezza e testo di sentieri e cartellini erano ancora spostate di un livello |
| ✅ | **Copertura completa dei layer di TGen** (11 ottobre) | `tools/tgen-copertura.mjs` non trova più layer scoperti. Ultimi aggiunti: barriere (muri, siepi, recinzioni, argini, mura), passaggi a livello, croci, fermate dell'autobus, slarghi di inversione, guadi, marine, zoo e parchi tematici, guidovie, nomi di ponti, piazze, scogliere, argini e dighe. Anche i layer con regole di classe, che il controllo non vedeva: **nomi di regioni e nazioni** (`.state`, `.country`) e **città e paesi come `placenames-medium`**, con il punteggio di TGen (popolazione, doppia per i capoluoghi) che decide da che livello compaiono, il punto città fino a z7 e l'ordine di priorità per popolazione |
| ✅ | **Il verde del 2018 era `@admin-boundaries`** | nei PNG del 2018 `@admin-boundaries` valeva `#55933b` (oggi il verde dei parchi): ne vengono confini, nomi delle nazioni `#365c25` e delle regioni `#526f46`, esattamente con le formule del `.mss`. I confini del 2018 sono ora quel colore in `darken` al 40-50%, come oggi il lilla, invece di un verde misurato a opacità piena |
| ☐ | **Sul server: finestre dei nomi di regioni e nazioni dai poligoni OSM** | oggi la superficie viene da una tabella di superfici di terra; TGen misura il poligono amministrativo, che per gli stati costieri include le acque territoriali (Malta compare a z7, la tabella la darebbe da z8). Con il PBF nazionale si calcola dai poligoni |
| ✅ | **z0–z6 come tutti gli altri livelli** (11 ottobre 2026) | si emula lo stile dei PNG di TGen anche lì: il profilo ora parte da z0 (terra e mare da z0, confini di stato da z1, nomi delle nazioni e capitale da z3, regioni e città da z4-z5, autostrade da z6, primarie da z8). Che fuori dall'Italia i nostri dati siano più poveri è contenuto, e fuori Italia non interessa. Sul server servono le tile del DEM anche da z0 a z7, per il rilievo |
| ✅ | **Rifugi da OSM, come TGen** | TGen disegna i rifugi di OSM (`.points` di amenity-points.mss): icone CAI da z13, nome da z14, ricoveri da z16. Ora così anche il locale (`hut-icon`, `hut-label`, `shelter-icon`, dall'archivio `osmpoi`); la tabella `rifugi_bivacchi` è spenta di serie, come i toponimi |
| ✅ | **Elementi che mancavano, trovati guardando la mappa** (11 ottobre 2026, sera) | quattro filtri più stretti di quelli di TGen. **Località** (`place=locality` e `farm`: 226.760 e 22.590 in Italia): il layer `place` di OpenMapTiles le scarta, TGen le scrive da z15; ora vengono dall'archivio `osmpoi` (layer `place-minor-osm`). **Rifugi disegnati come aree** (circa 5.800 con nome, tre su quattro) e **icone senza nome** (rifugi, ripari, selle, sorgenti, grotte): `osmpoi` prendeva solo punti con nome, TGen prende punti e aree senza chiedere il nome (`osmpoi-aree.sql`, `punto-interno.py`). **Guadi sui nodi**: `build-extra.sh` prendeva solo le vie (53 nella cella di Pisa contro 2.242 nodi). **Nomi di `drain` e `ditch`**: TGen li scrive come i torrenti, da z15 (sul Monte Pisano i botri sono quasi tutti `drain`). **Nomi delle grotte**: scostati di 7 px invece degli 11 di TGen, cadevano sotto l'icona e OpenLayers li scartava. Nel rigenerare `osmpoi` è venuto fuori anche il **diradamento di tippecanoe** (`-r 2.5`), che a z13 toglieva rifugi a caso: ora `-r1` e livello d'ingresso per tipo | pubblicati sul server, versione `20261011-2130` (151.426 guadi; a z13 tutti i rifugi di z14 su Dolomiti, Apuane e Gran Sasso) |
| ◐ | **Limite noto** | lungo le linee OpenLayers non cerca una posizione libera come Mapnik: alcuni numeri dei sentieri CAI su tracciati tortuosi o su strade con nome non compaiono |
| ✅ | **Misura finale dell'11 ottobre** (`data/taratura/giro8.txt`) | z10–z16 entro ±1,7 di luminosità a Volterra, Caltanissetta e Nicosia (z15 di Volterra -3,2); Monte Pisano più scuro di 1–3,4 punti, per l'ombra sui versanti ripidi (a z12 da -4,5 a -2,2 dopo la correzione). Contrasto fra -1 e -3,6 da z11 in su. L'uso suolo regionale a z14 torna per classe entro ±3 |
| ☐ | **PNG di tutta l'Italia e validazione a campione** | confronto per elemento su zone diverse, non solo Appennino. I 30.271 PNG già resi in `data/png/italia` sul server hanno l'ombra di prima e non hanno gli elementi aggiunti la sera dell'11 ottobre: `render-italia.sh` salta le tile presenti, quindi si riparte da una cartella nuova |
| ◐ | **Consegna** | `pipeline/consegna-png.sh`: `rsync` senza `--delete` come TGen, con copia di sicurezza di ciò che si sovrascrive; provata in locale. Manca l'accesso SSH dal server nuovo a quello di `api.webmapp.it` |
| ◐ | **Ciclo di aggiornamento** | `pipeline/aggiorna-png.sh`: modifiche Geofabrik (`aggiorna-osm.sh`) → archivi OSM (`build-celle.sh --solo-osm`) → confronto → PNG cambiati → consegna. **Provato il 10 ottobre 2026** sul centro di Pisa, dal 3 settembre all'8 ottobre: 34 modifiche giornaliere, 127 PNG rifatti su 132 (74 davvero diversi), consegnati con copia di sicurezza, circa 7 minuti. Sulle due celle intere cinque settimane valgono 39.808 PNG. Manca la schedulazione sul server |

### Fase 2 — i vettoriali al frontend

| | tappa | cosa manca |
|---|---|---|
| ☐ | **Una versione per archivio nelle URL** | oggi è unica: ogni pubblicazione fa riscaricare tutto ai client |
| ☐ | **Connettore `map-core`** | `ol` ≥ 7.3.0 e `ol-mapbox-style` 11.0.0 |
| ☐ | **Osservabilità, metriche, purge** (Task 16) | |
| ☐ | **Test di regressione automatici** | gli strumenti in `tools/` misurano ma non girano da soli |

Restano nel piano, non prioritari: la rotta HTTP dei PNG del Task 13 (oggi i
PNG si producono in batch), l'API on-demand su bbox del Task 15, la
documentazione operativa del Task 17 (in buona parte in
[`runbook.md`](runbook.md)).

---

## TGen: cosa c'è e come lavora

Si era valutato di far girare wm-tiles su TGen stessa. **Deciso il 10 ottobre
2026: no.** Il sistema è fuori supporto (Debian 9, PostgreSQL 9.6) e wm-tiles,
che deve sostituire TGen, resterebbe legato a una macchina da aggiornare o
spegnere; nella fase 2 servirebbe le tile alle app da un sistema senza
aggiornamenti di sicurezza dal 2022. Da TGen servono solo dati che non
cambiano: si copiano una volta, in sola lettura, e TGen resta com'è.

**Da TGen si copia** (tabelle lette dal `project.mml`):

| dato | database e tabelle | zoom in TGen | nel locale |
|---|---|---|---|
| uso suolo regionale | `general`: `usotoscana2013`, `uso_emilia_2008`, `usopiemonte`, `usolombardia`, `uso_veneto`, `uso_friuli`, `uso_tn`, `uso_bz`, `usoliguria2015`, `usosardegna2008`, `usocalabria`, più `land_cover_hr` (Sud) | z14+ | solo Toscana ed Emilia nel bbox del prototipo |
| Corine | `general`: `clc12_version_18_5` | z7–z13 | copiato su un bbox ampio, query non salvata |
| **IGM DBSN, uso suolo** | `igm_dbsn`: `bosco`, `f_nter`, `sc_dis`, `ps_inc`, `cl_agr`, `cv_aes`, `cv_dis` | z14+ | **mai copiato, non disegnato** |
| **IGM DBSN, edifici** | `igm_dbsn`: `edifc`, `edi_min` | z14+ | **mai copiato, non disegnato** |
| **ghiacciai** | `general`: `ghiacciai_piemonte` | z14+ | **mai copiato, non disegnato** |
| toponimi, rifugi | — | — | copiati su un bbox ampio, query non salvate |
| sorgenti dello stile | `project.mml`, `.mss`, simboli | — | in `data/tgen-style/`, fuori dal repo |

Gli strati IGM sono disegnati con le stesse regole dell'uso suolo regionale
(`webmapp.mss`, riga 151-152) e gli edifici IGM con quelli OSM
(`buildings.mss`): dove i dati IGM esistono, da z14 TGen mostra più
superfici ed edifici del locale.

**Non si copia**: OpenStreetMap (arriva da Geofabrik), ombreggiatura e
pendenza pre-calcolate (raster, vietati come sfondo), shapefile di coste e
acque (li scarica planetiler), curve di livello (generate dal DEM).

**Quanto pesano su TGen** (misura del 10 ottobre 2026, catalogo di
PostgreSQL, indici compresi; esportati e compressi pesano meno):

| gruppo | peso |
|---|---|
| uso suolo delle 11 regioni con tabella propria | 4,8 GB (Calabria e Toscana circa 1 GB ciascuna, Friuli 35 MB) |
| `land_cover_hr` (Sud) | 2,4 GB |
| Corine `clc12_version_18_5` | 9,4 GB, ma copre l'Europa: per l'Italia molto meno |
| IGM DBSN, 9 tabelle | 14,3 GB (`cl_agr` 4,4, `edifc` 3,6, `ps_inc` 2,6, `bosco` 2,5, `edi_min` 1,1) |
| ghiacciai del Piemonte | 0,5 MB |

**I DEM di TGen pesano circa 470 GB** in `/mnt/sdb1/mapdata/dem`: `hr`
170 GB (2021), `it_original` 143 GB (dicembre 2025), `eu_original` 66 GB, `it`
44 GB (2019), più GEBCO, mondo e procedure. Non si copiano alla cieca e non
stanno sul Mac (92 GB liberi): prima va capito quale DEM serve.

**Da verificare**: i DEM di TGen in `/mnt/sdb1/mapdata/dem`. Le ombreggiature
di TGen vengono da DEM a 100, 25 e 10 m (`/root/mapdata/hs/{100m,25m,10m}`): se
quello a 10 m copre l'Italia, copiarlo risolve la decisione sul DEM senza
scaricare TINITALY.

La copia dell'11 ottobre 2026 non è passata dal Mac, come previsto, ma è
andata da TGen al server direttamente, più veloce. Per farlo, su TGen si è
aggiunta una chiave del server, valida solo dal suo indirizzo e senza tunnel
né sessioni interattive, e sul firewall Hetzner del server una regola in
uscita sulla porta 22 verso TGen. Entrambe vanno tolte a copia finita.
Attenzione: il firewall standard dei server Webmapp apre la 22 in uscita solo
verso pochi indirizzi, quindi da un server nuovo TGen non risponde finché non
si aggiunge la regola.

**Inventario del 10 ottobre 2026** (sola lettura):

| | valore | |
|---|---|---|
| CPU | 8 core, carico 0,02 | ferma: il rendering continuo è spento |
| RAM | 62 GB, 16 GB disponibili | basta per planetiler sull'Italia, appena |
| disco `/` | 878 GB liberi su 1,3 TB | basta anche per il DEM fino a z16 |
| disco `/mnt/sdb1` | 127 GB liberi, all'85% | da non usare |
| PostgreSQL | 9.6.10, database `general` 63 GB | fuori supporto dal 2021; per le `SELECT` va bene |
| Docker | **assente** | tutte le pipeline girano in container |
| uptime | 912 giorni | sistema fermo almeno da aprile 2024 |

Le risorse ci sono, il software no. Senza Docker non si può ripiegare su
un'installazione diretta: il GDAL di una distribuzione di quell'epoca non ha
il driver PMTiles (serve GDAL ≥ 3.8). Installare Docker su una macchina che
non si aggiorna da oltre due anni può richiedere aggiornamenti di kernel o un
riavvio.

**I PNG non sono serviti da TGen.** `api.webmapp.it` risolve su
`server.webmapp.it` (`46.101.124.52`). Come ci arrivano: vedi "Terza
verifica" qui sotto.

**Cosa ha prodotto TGen** (`Last-Modified` dei PNG serviti, 10 ottobre 2026).

Livelli, sopra l'area di prova: **z0–z16**; da z17 il server risponde 404.

| livelli | data |
|---|---|
| z0–z2 | agosto 2018 |
| z3–z6 | dicembre 2018 |
| z7–z12 | novembre 2018 |
| z13–z16 | febbraio 2026 nell'area di prova; settembre 2025 nel resto d'Italia |

I livelli bassi non sono stati rigenerati: mostrano lo stile del 2018, mentre
i `.mss` scaricati sono quelli attuali. Potrebbe spiegare il verde più saturo e
le aree chiare d'alta quota (vedi sotto). Non cambia nulla: **si copia lo stile
dei PNG, a qualunque anno risalga**; l'aggiornamento riguarda il contenuto.

Territorio, a z14: **tutta l'Italia** (Aosta, Vetta d'Italia, Otranto,
Lampedusa, Sardegna, perfino il mare aperto) con data 3–12 settembre 2025, ma
anche **fuori dall'Italia**, a macchia e con date diverse: Nizza settembre
2025, Corsica e Zurigo febbraio 2022, Lubiana marzo 2019, Parigi novembre
2018; a Tunisi la tile esiste ma è vuota (0 KB). A z10 rispondono tutte le
città provate, Parigi compresa. Il generatore lavora per celle di un grado
(`lon-6-lat37-z13.mbtiles`) e ha una coda (`wm-mapserver/queue`): con ogni
probabilità le aree fuori Italia sono state generate su richiesta, in momenti
diversi.

**Come genera TGen** (`generate_map_tiles.sh`, Marco Barbieri 2018). Una
cella di un grado e un livello per volta: `tl copy` scarica le tile da un
server Mapnik locale (`localhost:8080`) in una cartella `map/`, poi
`rsync -avz map/` le copia sul server di `api.webmapp.it` — **senza
`--delete`**, quindi aggiunge e sovrascrive, non cancella — e infine scrive la
data nella tabella **`general.grid_1x1`**, una colonna per livello
(`z14 = CURRENT_DATE` per quella cella). **Quella tabella è l'inventario di
ciò che TGen ha prodotto.** I lavori stanno in `wm-mapserver/queue`: 23 file
JSON (`italia.json`, `piemonte.json`, `toscana_17.json`, mappe mute…).

**I PNG di TGen non sono uniformi in Italia.** Tre tile z14:

| luogo | data | ombreggiatura | uso suolo |
|---|---|---|---|
| Valtournenche (AO) | 3 settembre 2025 | **no** | **no**: sfondo bianco |
| Gran Sasso | 19 febbraio 2026 | sì | no |
| Sillano, l'area di prova | 27 febbraio 2026 | sì | sì |

Il `hs10m` attuale ha pixel di **5 m** e copre solo 9,9–11,1 E,
43,9–45,1 N, cioè l'Appennino dell'area di prova: sembra ricostruito per
l'area di ogni lavoro (`dem/box`, febbraio 2026). Nemmeno il giro di settembre
2025 è uniforme: a Valtournenche (3 settembre) da z14 non c'è rilievo, nella
campagna di Caltanissetta (10 settembre) sì, con un uso suolo chiaro che
viene probabilmente da `land_cover_hr`. Da z14 l'uso suolo viene solo dalle
tabelle regionali e da `land_cover_hr`: la Valle d'Aosta non ha né l'una né
l'altra. **L'area di prova è il caso migliore di TGen, non quello tipico.**
Attenzione a giudicare dalle tile di città: lì sfondo e rilievo quasi non si
vedono, e a un primo sguardo Caltanissetta era sembrata senza.

**Le cause, verificate** (Valtournenche a z12, z13, z14; le ultime due generate
la stessa notte del 3 settembre 2025):

- **Uso suolo bianco da z14.** Corine, l'unico uso suolo che copre l'Italia, è
  limitato a z7–z13 (`clc` nel `.mml`, `#clc [zoom>=7][zoom<=13]` in
  `webmapp.mss`). Da z14 i colori vengono solo dalle 11 tabelle regionali,
  da `land_cover_hr` e dall'IGM: dove mancano (Valle d'Aosta, Abruzzo, e le
  altre regioni senza tabella, salvo dove arriva `land_cover_hr`) resta
  bianco. Ad Aosta: colori a z13, bianco a z14.
- **Niente rilievo da z14.** Le ombreggiature a 100 m (z7–z10) e 25 m
  (z11–z13) coprono l'Italia; quella da z14 viene costruita solo sull'area
  dei singoli lavori. Ad Aosta: rilievo a z13, niente a z14. Perché non sia
  stata costruita per tutta l'Italia non risulta dai file.

Nessuno dei due è una scelta di stile: sono dati che mancavano in quei giri.
In wm-tiles i due buchi non ci sono per costruzione: il rilievo si calcola dal
DEM ovunque, e da z14 dove manca la tabella regionale si vede l'uso suolo di
OpenStreetMap (`landcover-osm`, attivo fino a z16).

**I DEM di TGen** (`/mnt/sdb1/mapdata/dem`): `it_original` contiene
`tinitaly` (10 m, tutta Italia), DEM regionali (Toscana, Emilia-Romagna,
Piemonte, Lombardia, Veneto, Friuli, Trentino, Alto Adige, Valle d'Aosta,
Liguria, Calabria, Sardegna) e dei vicini (Austria, Francia, Svizzera); `it`
ne contiene alcuni già elaborati (Austria 20 GB, Toscana 8 GB, Piemonte 5 GB,
Lombardia 4,6 GB, Sardegna 3,7 GB, Alto Adige 2,5 GB).

**Deciso: fuori dall'Italia non interessa.** Per il confine si segue il
criterio che TGen sembra aver usato a settembre 2025: le celle di un grado
che contengono territorio italiano, mare compreso. Spiega perché Nizza (stessa
cella di Ventimiglia) e il Tirreno aperto (stessa cella di Ponza) hanno quella
data e la Corsica no. Da confermare leggendo `generate_map_tiles.sh`.

**Come si rendono i PNG — deciso l'11 ottobre 2026: maplibre-native**, dallo
stesso `style.json` delle app, adattato in automatico; l'ombreggiatura la
calcola la CPU con le formule della preview. Senza GPU è circa 60 volte più
veloce di OpenLayers in un browser, con la stessa fedeltà a TGen salvo la
disposizione di qualche etichetta (misure in `notes.md`). Prima si usava il
browser headless sulla preview.

**Seconda verifica, stesso giorno** (sola lettura):

- **Debian 9 stretch, kernel 4.9.0-6** (del 2018). La distribuzione è fuori
  supporto e i suoi repository sono passati su `archive.debian.org`:
  installare qualunque pacchetto, Docker compreso, vuol dire prima cambiare
  le sorgenti di `apt`. Docker gira su quel kernel, ma è un intervento su un
  sistema che nessuno aggiorna da anni.
- **La RAM occupata è di Postgres**: il processo principale tiene circa 16 GB
  (`shared_buffers`), i worker condividono la stessa memoria. Nient'altro di
  rilevante gira.
- **Nessuna produzione automatica**: crontab di root vuoto, niente `renderd`,
  nessuna configurazione Mapnik in `/etc`. Le tile si generano a mano, con
  passaggi non documentati.
- Nessuno script di sincronizzazione direttamente in `/root`, `/root/bin`,
  `/usr/local/bin`: la sincronizzazione sta dentro gli script di
  `/root/wm-mapserver` (vedi sotto).

**Terza verifica, stesso giorno** (sola lettura: `update.sh`, il file
`crontab`, l'elenco di `wm-mapserver` e `mapstyles`, le righe della history
che riguardano rendering e trasferimenti):

- **Come si producono e consegnano i PNG.** `/root/wm-mapserver` è un
  repository git con gli script di generazione (`generate_map_tiles.sh`,
  modificato a febbraio 2025, più varianti per la mappa muta e per z16/z17) e
  una cartella `tiles/` modificata il **27 febbraio 2026**, lo stesso giorno
  delle tile z13–z16 dell'area di prova. La history mostra il passaggio finale: lo script
  riceve una cartella di lavoro e una destinazione
  `root@46.101.124.52:/root/api.webmapp.it/tiles/`, cioè le tile vengono
  **copiate con `rsync` via SSH** sul server che le serve. TGen ha quindi già
  l'accesso SSH a quel server. In altri momenti si sono copiati file
  `.mbtiles` a celle di un grado (`lon-6-lat37-z13.mbtiles`).
- **`update.sh` aggiorna il database OSM di TGen** in modo incrementale:
  `osmosis` scarica le differenze, `osm2pgsql --append` le applica al database
  `gis` (modalità slim, con `nodes.flat`). La riga di cron che lo lanciava
  ogni ora è **commentata**: l'aggiornamento è spento. `italy-latest.osm.pbf`
  e `nodes.flat` sono del 26 febbraio 2026: il database OSM è stato
  probabilmente reimportato il giorno prima del rendering di z13–z16.
- In `/root/mapstyles` ci sono gli stili Mapnik storici (OSM Bright,
  Blossom, una variante `osm_blossom_webmapp` modificata a gennaio 2025).

Da leggere ancora: `generate_map_tiles.sh`, lo script principale, per
confermare destinazione e opzioni di `rsync` (la riga vista nella history è
della variante per la mappa muta).

---

## Aggiornamento incrementale da OSM

Obiettivo: quando cambia OpenStreetMap, rifare solo ciò che è cambiato.
Planetiler e PMTiles non sono incrementali, ma il calcolo vettoriale costa
poco (minuti, decine per l'Italia). I costi veri sono il rendering dei PNG e
la cache dei client, e quelli si rendono incrementali così: differenze OSM
giornaliere di Geofabrik applicate al PBF con `osmium apply-changes` →
planetiler → confronto tile per tile col vecchio archivio → PNG e cache
rifatti solo per le tile cambiate.

**Misure del 10 ottobre 2026** sull'area del prototipo, una settimana di
modifiche reali (estratti del 3-4 settembre più sette diff giornaliere):

- **Planetiler è deterministico**: due giri sullo stesso PBF danno 7.491 tile
  identiche byte per byte. Il confronto per hash funziona senza accorgimenti.
- **In una settimana cambia il 5,9% delle tile** (444 su 7.491). La quota
  scende salendo di livello: z14 4,7%, z13 7,2%, z12 11%, z10 20%, z8 50%.
  I livelli bassi cambiano quasi sempre ma sono pochi; a z14, dove sta la
  massa, si rifà una tile su venti. Le z15-z16 PNG derivano dalle z14, quindi
  seguono la stessa proporzione.

Limiti: area appenninica e rurale, le città cambiano di più; un byte diverso
non implica un PNG diverso (può essere cambiato un attributo non disegnato),
quindi il 5,9% è un limite superiore. Misurato solo l'archivio `osm`: il
determinismo di `hiking`, `osmpoi` e `roadslz` (generati con GDAL) va
verificato a parte.

**Fatto il 10 ottobre 2026**: `pipeline/diff-versioni.mjs` confronta due
versioni e scrive l'elenco dei PNG da rifare; `pipeline/render-png.mjs` li
rende. Sulla settimana di prova: 444 tile vettoriali cambiate (stesso numero
del confronto SQLite) → **19.356 PNG** da rifare su circa 115.000 dell'area
fra z7 e z16, il 17%. La differenza col 6% sta nelle vicine, che si rifanno
sempre perché le etichette sconfinano, e nei livelli z15-z16 che derivano
dalle z14.

Verifiche del renderer: le tile ritagliate dal metatile coincidono con quelle
rese da `tile-diff.mjs` (0,3 livelli di grigio di differenza media); a z14
tutte e 16 le tile di prova sono allineate al pixel col riferimento; nessuna
cucitura visibile dentro il metatile né fra due metatile adiacenti.

Ancora da fare: una versione per archivio nelle URL (oggi è unica e fa
riscaricare tutto ai client); la consegna dei PNG al server che li serve.
Il confronto non vede i cambi di stile, sprite e DEM: in quel caso si
rigenera tutto con `render-png.mjs --bbox`.

## Decisioni aperte

In ordine di urgenza, ciascuna col consiglio. Le decisioni prese stanno in
[`notes.md`](features/server-tiles-osm/notes.md).

### Bloccano il passaggio all'Italia

**1. Il server — deciso il 10 ottobre 2026: nuovo e dedicato.** I lavori
pesanti (rendering per ore, planetiler) non devono disturbare app in
produzione. Servono 8 core, 32 GB di RAM, 500 GB–1 TB di SSD, un Debian o
Ubuntu recente con Docker; la GPU no.

**La GPU non serve, verificato l'11 ottobre 2026.** Con maplibre-native su
Linux senza GPU (OpenGL in software, in Docker) 64 tile z14 si rendono in 4,7
secondi, e differiscono da quelle rese con la GPU del Mac per meno di un
livello di grigio su 255.

**2. Il DEM — deciso il 10 ottobre 2026: quello a 10 m di TGen**, cioè
TINITALY, che TGen ha in `/mnt/sdb1/mapdata/dem/it_original/tinitaly`. Nel
primo ciclo i dati si copiano da TGen. Da z14 TGen usa un'ombreggiatura ad
alta risoluzione (`hs10m` nel `project.mml`; 100 m per z7–z10, 25 m per
z11–z13); nell'area di prova il confronto a z16 lo mostra: con Copernicus a
30 m creste e fossi spariscono. Un solo DEM per tutti i livelli: quelli bassi
lo usano rimpicciolito, il verso che non crea artefatti.

**2b. Fino a che livello conservare le quote — da decidere.** È un dettaglio
interno: i PNG arrivano comunque a z16, come TGen. Proposta: **z14** (~8 GB
invece di ~130 GB), perché a z14 un pixel vale già circa 7 m sul terreno e un
DEM a 10 m non ha dettaglio da dare oltre. Prima di decidere va verificato
sull'area di prova che i PNG a z16 vengano uguali nei due casi.

Da fare dopo il cambio: ricontrollare le opacità dell'ombra (`hs-z8` …
`hs-z16`) su tutta la scala, perché sono tarate su Copernicus; riverificare
lo spostamento di 1-3 px a z15-z16, che potrebbe venire proprio dal DEM.

**3. Le aree di prova — deciso il 10 ottobre 2026: Toscana (Pisa) e Sicilia
(Caltanissetta).** Si usano le celle di un grado di TGen che le contengono,
così il confronto con `grid_1x1` è diretto: 10–11 E, 43–44 N (Pisa, Livorno,
Lucca, Volterra, la costa) e 14–15 E, 37–38 N (Caltanissetta, Enna, Gela).
In TGen hanno storie diverse, ma in campagna a z14 tutte e due hanno rilievo
e uso suolo:

| | z13–z16 generati | uso suolo da z14 |
|---|---|---|
| Pisa | 18 febbraio 2026, un lavoro mirato | tabella della Toscana |
| Caltanissetta | 10 settembre 2025, il giro su tutta l'Italia | più chiaro: probabilmente `land_cover_hr`, la Sicilia non ha tabella propria |

Pisa è il caso con i dati più ricchi; Caltanissetta mostra la Sicilia con le
sole fonti nazionali di TGen. Il caso con i buchi veri (niente rilievo, sfondo
bianco) resta la Valle d'Aosta.

Dall'inventario `grid_1x1` (letto il 10 ottobre 2026): cella di Pisa z13–z16
il 18 febbraio 2026, più z17 (novembre 2019) e z18 (novembre 2018), residui di
vecchi lavori (`toscana_17.json`); cella di Caltanissetta z13–z16 il 10
settembre 2025. z0–z12 non compaiono: sono stati generati nel 2018 con
un'altra procedura. Le tabelle da copiare sono tutte in EPSG:3857 (`geom` in
`general`, `wkb_geometry` in `igm_dbsn`); TINITALY sono 194 file per 16 GB in
tutto.

### Prima della consegna

**4. I livelli z0–z7 — deciso il 10 ottobre 2026: si generano.** Si genera
quello che ha generato TGen: z0–z16, sullo stesso territorio.

**5. La consegna.** Il server di wm-tiles deve poter copiare i PNG sul
server di `api.webmapp.it`: serve una chiave SSH su quel server, che è in
produzione. Da decidere chi la installa e con quali permessi, e dove tenere
la copia dei PNG attuali per tornare indietro. Consiglio: la copia sul server
di wm-tiles, fatta prima della prima consegna.

**6. Ogni quanto aggiornare, e chi controlla.** Consiglio: **una volta al
mese** per partire, con un controllo a campione nella preview prima di
consegnare.

### Fuori da wm-tiles, ma da segnalare

**7. La sicurezza di TGen e del server di `api.webmapp.it`.** TGen è esposta
su internet con accesso root via SSH e senza aggiornamenti di sicurezza dal
2022. Il server di `api.webmapp.it` risponde dichiarando Apache 2.4.23, una
versione del 2016. TGen fa anche altri lavori (mappa muta, esportazioni di
DEM verso altri server): prima di spegnerla servono un responsabile e un
posto dove spostarli.

**8. Licenze e attribuzioni.** Uso suolo regionale, IGM e Corine chiedono di
essere citati: prima di pubblicare l'Italia va verificata la licenza di
ciascuno e aggiunta l'attribuzione. Oggi è già sbagliata: in `src/server.js`
le sorgenti `clc` (Corine) e `landcover` (uso suolo) dichiarano entrambe
`© ESA WorldCover 2021`, che non è la loro fonte.

**9. z0–z12 fermi al 2018 — chiuso il 10 ottobre 2026.** Secondo l'utente non
sono stati rigenerati perché cambiano poco e i clienti chiedono aree
circoscritte, quindi chi lanciava i lavori a mano li saltava. Va aggiornato il
contenuto, non lo stile: si copia lo stile dei PNG anche lì.

### Più avanti, fase 2

**10. Il frontend.** Quando aggiornare `map-core` per passare ai vettoriali,
e da dove servirli: dal server di wm-tiles o dietro una CDN.

---

## Aperti, ma minori

- **L'uso suolo regionale** copre da 43,54: per un'area nuova va riletto da
  TGen — una sola importazione, vedi [`import-da-tgen.md`](import-da-tgen.md)
- **z16 non è mai stato validato con il confronto per elemento**, solo con le
  medie globali
- **Pochi test**: tre file, 32 test (filtro, confronto fra archivi, tile da
  rendere). Gli strumenti in
  `tools/` misurano ma nessuno gira in automatico e nessuno fallisce da solo
  se una regressione rientra: è così che due difetti gravi dell'ombreggiatura
  sono rimasti invisibili per giorni
- **Mancano le query di importazione** per Corine, toponimi e rifugi: gli
  archivi ci sono, la procedura per rifarli no. Chi ne rifà una salvi la query
  in `pipeline/sql/`
- **Le aree chiare**: TGen mostra rocce e praterie d'alta quota dove noi
  mettiamo verde, visibile a z10 e z12. Non è chiaro se sia dato o stile
- **A z15-z16 il locale è spostato di 1-3 px rispetto al riferimento**,
  circa 5 m e quasi sempre verso ovest; a z14 è allineato. Non dipende dal
  renderer PNG (la stessa tile resa da `tile-diff.mjs` è identica): è nei dati,
  probabilmente curve di livello e ombreggiatura. Mezzo pixel di un DEM a 10 m
  vale 5 m, quindi il primo sospetto è la convenzione pixel-is-area /
  pixel-is-point
