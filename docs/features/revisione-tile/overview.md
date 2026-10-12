# Revisione delle tile: un sistema che documenta le difformita'

> Spec del 12 ottobre 2026. Stato: da approvare.

## Cosa vogliamo

Un comando che si lancia, confronta con TGen un insieme solido di tile — tutte
dove sono poche, un campione stratificato dove sono migliaia — e **documenta
ogni difformita' con le sue evidenze**. Poi l'AI legge la documentazione e
decide cosa fare: correggere lo stile, ignorare, approfondire.

Divisione dei ruoli:

- **il sistema misura e classifica cio' che si puo' misurare** (Δ colore per
  classe, regressioni rispetto al giro precedente) e funziona da test: esce 1
  se trova difformita' non ancora giudicate;
- **l'AI giudica cio' che il codice non sa classificare**: soprattutto la
  differenza fra stile e contenuto quando i due lati divergono e nessuna
  geometria locale lo spiega. Ogni giudizio e' scritto, cita la sua evidenza e
  resta nel registro.

## Perche' gli strumenti attuali non bastano

- `png-vs-tgen.mjs` da' medie globali per tile, che risentono del contenuto.
- `colore-per-classe.mjs` misura nel modo giusto (maschera dalle nostre
  geometrie, pixel di TGen sotto), ma una classe e un elenco di tile per volta,
  scelti a mano.
- `tgen-copertura.mjs` trova i layer mancanti leggendo il `.mml`, non i
  pixel: non vede cio' che `parse-cartocss` non legge (selettori di classe).
- Nessuno strumento ricorda il giro precedente: una correzione a z13 che
  peggiora z10 si scopre solo se qualcuno guarda z10.
- I livelli z5-z6 non li ha mai guardati nessuno (in `data/ref-cache` c'e' una
  tile per livello).

## Il principio: lo stile e' sistematico, il contenuto e' sparso

Un layer mancante o un colore sbagliato si ripete con lo stesso tono su
centinaia di tile; una strada cambiata in OSM compare in un punto. Aggregando
su molte tile lo stile emerge dal contenuto. E' la regola fondante del
progetto ("si confronta lo STILE, non il contenuto") tradotta in statistica.

## Il flusso

```
universo (tile-italia.py) -> campione -> copertura -> resa locale + TGen
   -> misure per tile -> aggregazione -> classificazione -> report + dossier
   -> [AI] verdetti nel registro -> correzioni -> giro successivo (regressioni)
```

```bash
node tools/revisione.mjs --universo tile.txt --zoom 5-16 --per-livello 60 \
  --giro 20261012-a [--seed 1] [--confronta 20261011-b]
node tools/revisione-verdetto.mjs <id-difformita> <stile|contenuto|buco-tgen|mancanza|motore> "<motivo>"
```

### 1. Universo e campione (`src/revisione/campione.js`)

L'universo e' l'elenco di tile che si renderebbero davvero:
`pipeline/tile-italia.py` (Italia + `grid_1x1`). Il campione:

- **z5-z8: tutte le tile** dell'universo (Italia a z5 sono circa 6, a z8 circa
  250);
- **da z9: campione stratificato** per cella di un grado (`grid_1x1`), N tile
  per livello ripartite fra le celle, estratte con un seed fisso: lo stesso
  seed da' lo stesso campione, cosi' due giri si confrontano tile per tile.

### 2. Copertura

Una tile entra solo se **i dati locali la coprono per intero** (bbox delle
versioni da `/version`). Le altre si scartano e il report le conta per
livello, con il motivo. E' cio' che rende il comando usabile sia sul Mac
(celle di prova: z5-z8 risultano tutte scartate, ed e' giusto) sia sul server
(Italia), senza opzioni diverse.

Una tile che TGen non ha (HTTP 404) e' contenuto: si conta, non si misura.

### 3. Resa

- locale: `pipeline/render-png.mjs --tiles` (maplibre-native, cio' che si
  consegna) in `data/revisione/<giro>/png/`;
- TGen: `data/ref-cache/`, come gli altri strumenti.

### 4. Misure per tile (`src/revisione/misure.js`)

Per ogni layer dello stile visibile a quel livello (dal profilo):

- **maschera**: le geometrie della tile vettoriale filtrate con il filtro del
  layer (`featureFilter` di `@maplibre/maplibre-gl-style-spec`), rasterizzate
  come in `colore-per-classe` (poligoni pieni, linee con la loro larghezza a
  quel livello, minimo 2 px);
- **pixel esclusivi**: si misura solo dove il layer e' l'unico a coprire il
  pixel, cosi' un'etichetta sopra un bosco non sporca il colore del bosco;
- **misura**: mediana dei colori TGen e locali sotto la maschera, ΔE in Lab,
  numero di pixel;
- **presenza**: la quota di pixel della maschera dove TGen e locale divergono
  oltre soglia (il layer c'e' da noi e non da TGen, o e' disegnato
  diversamente).

**Residuo**: i pixel dove TGen e locale divergono oltre soglia e che nessuna
maschera (dilatata di 2 px) spiega. Si uniscono in regioni connesse e si
raggruppano per colore di TGen (RGB in classi da 32 per canale: l'id resta
leggibile, `#303030`). Il residuo e' dove stanno le
mancanze: cio' che TGen disegna e noi no.

I layer `symbol` non danno maschere ma **zone etichetta** attorno alle nostre
feature: Mapnik e OpenLayers piazzano i nomi in punti diversi, e quella
differenza e' del motore, non dello stile. Le zone etichetta sono escluse dal
residuo e dalla misura per classe.

Ogni tile porta la fascia di stile del PNG (2018 fino a z12, 2025 da z13).

### 5. Aggregazione e classificazione (`src/revisione/aggrega.js`)

Per (livello, layer) e per (livello, gruppo di colore del residuo):

| esito | condizione | chi decide |
|---|---|---|
| conforme | ΔE mediano entro soglia | il sistema |
| **stile** | ΔE fuori soglia sulla maggioranza delle tile in cui il layer compare | il sistema la segnala, l'AI conferma e corregge |
| **residuo sistematico** | un gruppo di colore del residuo su almeno il 10% delle tile del livello | l'AI |
| **presenza** | un layer con presenza alta su molte tile | l'AI |
| sparso | residuo o scarto su poche tile | nessuno: nel report come probabile contenuto |
| **regressione** | Δ peggiorato rispetto al giro di `--confronta` oltre tolleranza | l'AI |

Le soglie sono costanti in un solo punto, con il motivo scritto accanto.

### 6. Report e dossier (`data/revisione/<giro>/`)

- `risultati.json`: tutte le misure, per tile e aggregate (serve al giro
  successivo e all'AI);
- `index.html`: tabella livello x layer, colorata per esito, le difformita'
  ordinate per gravita';
- `dossier/<id>.png` per ogni difformita' da giudicare: le 3 tile piu'
  rappresentative, TGen | locale | differenza, ingrandite, con la regione
  cerchiata e i numeri. E' cio' che l'AI guarda prima di giudicare.

L'`id` di una difformita' e' stabile fra un giro e l'altro:
`z<livello>:<layer>:<tipo>` o `z<livello>:residuo:<colore quantizzato>`.

Piano: [`plan.md`](plan.md).

### 7. Registro dei verdetti (`docs/revisione/verdetti.json`, nel repo)

Una voce per id: verdetto (`stile`, `contenuto`, `buco-tgen`, `mancanza`,
`motore` per i limiti di OpenLayers e maplibre-native), motivo, giro, misure al
momento del giudizio. Al giro successivo:

- una difformita' gia' giudicata `contenuto`/`buco-tgen`/`motore` non torna da
  rivedere, **a meno che le sue misure siano cambiate oltre tolleranza**;
- una `stile` o `mancanza` resta aperta finche' le misure non rientrano;
- il codice di uscita e' 1 se esistono difformita' senza verdetto o
  regressioni.

Le immagini restano in `data/` (pesano e si rigenerano); i verdetti nel repo,
perche' li veda il team come `docs/stato.md`.

### 8. La parte dell'AI

Dopo un giro l'AI legge `risultati.json`, apre i dossier delle difformita'
aperte, controlla dove serve con gli strumenti esistenti (`tile-diff`,
`colore-per-classe`, `/inspect`, `project.xml`) e per ognuna scrive il
verdetto con `revisione-verdetto.mjs`. Poi decide le correzioni. Su un
campione nazionale i dossier si possono dividere fra piu' agenti, uno per
fascia di livelli, con lo stesso formato di verdetto.

## Dove gira

- **Mac**: celle di prova (Pisa, Caltanissetta); la copertura scarta da sola
  i livelli che le celle non riempiono.
- **Server** (`ssh wm-tiles`): l'Italia, da z5. Il report si copia sul Mac per
  la revisione.

## Fuori da questo lavoro

- Oltre z16: non c'e' riferimento (vedi CLAUDE.md).
- Il confronto OpenLayers contro maplibre-native: lo fa gia'
  `ombra-native-vs-ol.mjs` per l'ombra; le etichette disposte diversamente
  sono un prezzo accettato.
- Una pagina interattiva nella preview: solo se il report statico non basta.

## Test

- `campione`: stesso seed, stesso campione; tutte le tile fino a z8;
  ripartizione fra celle.
- `misure`: immagini sintetiche — un layer di colore sbagliato da' ΔE atteso,
  un oggetto disegnato solo da TGen finisce nel residuo, un'etichetta sopra
  una superficie non sposta la mediana della superficie.
- `aggrega`: sistematico contro sparso, regressione, id stabili.
- registro: un verdetto `contenuto` silenzia la difformita' solo finche' le
  misure restano quelle.
- prova vera: un giro su Pisa z9-z16 deve ritrovare le difformita' gia' note
  in `docs/stato.md`: gli strati IGM che TGen disegna da z14 e il locale no
  devono uscire come residuo sistematico (i ghiacciai no: sono del Piemonte).
