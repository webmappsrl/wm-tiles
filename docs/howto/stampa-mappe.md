# Chiedere una mappa da stampare a wm-tiles

Guida per chi scrive il consumatore — oggi lo shard di **oc:8982**, che deve
produrre una scheda PDF con dentro una mappa. Il servizio e' `wm-tiles`
(oc:9011): riceve le geometrie di un percorso e restituisce **un PNG a
risoluzione di stampa**, gia' inquadrato, con barra di scala, nord e
attribuzioni.

Se non hai mai visto questo servizio, leggi prima
[«Le cinque cose che costano un pomeriggio»](#le-cinque-cose-che-costano-un-pomeriggio):
sono i comportamenti che sorprendono, non le opzioni.

---

## 1. L'endpoint

```
POST <base>/v1/print/map
Authorization: Bearer <token dello shard>
Content-Type: application/json
```

`<base>` e' l'indirizzo del servizio di stampa, che **non e' lo stesso del
server delle tile**: gira in un container a se', e l'indirizzo pubblico te lo da'
chi gestisce l'host (vedi [«Il token»](#4-il-token-e-laccesso-vero)). Il
controllo di salute e' `GET <base>/health`.

### Il corpo — lo dichiara lo schema

**La forma del corpo sta in [`src/print/openapi.json`](../../src/print/openapi.json),
ed e' la validazione vera.** Non e' una descrizione del codice: la rotta compila
quello schema con Ajv e rifiuta con `400` tutto cio' che non lo rispetta, e
`src/print/limits.js` legge di li' anche i tetti. Quindi qui sotto non c'e' la
tabella dei campi: ripeterla significherebbe tenerne allineate due, e quella in
prosa prima o poi direbbe il falso proprio a te che la leggi.

Tre modi di leggerlo, in ordine di comodita':

```bash
# una pagina da sfogliare, con dentro lo schema in esecuzione sul servizio
<base>/v1/print/docs
# il documento, senza bisogno di token
curl -sS <base>/v1/print/openapi.json | jq .
# oppure, senza il servizio acceso, il file nel repo
jq . src/print/openapi.json
```

Da li' si generano anche il client e i suoi tipi (`openapi-generator`,
`redocly`), invece di scriverli a mano guardando questa pagina.

> **Resta la cosa numero uno da confermare o cambiare.** La forma del corpo e'
> stata scritta dalla parte di wm-tiles, senza che lo shard avesse ancora voce in
> capitolo: e' una proposta, non un contratto. Se serve un campo in piu' (un
> titolo da stampare, un secondo riquadro, un elenco di waypoint con icone) o un
> nome diverso, **si cambia lo schema prima di scrivere il job**: e' un file solo,
> e cambiarlo cambia insieme validazione, documentazione e finta. Nessun campo e'
> ancora in produzione, quindi oggi non costa niente; dopo costa una migrazione su
> due repo.

Una richiesta di esempio — la stessa che sta nello schema, dove ce n'e' anche una
con `mapInfo: false`:

```json
{
  "geometry": {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "properties": {"stroke": "#e2001a", "stroke-width": 4},
        "geometry": {"type": "LineString", "coordinates": [[10.50, 43.78], [10.55, 43.81]]}
      }
    ]
  },
  "page": {"format": "a4", "orientation": "portrait", "dpi": 300},
  "styleId": "webmapp",
  "mapInfo": true
}
```

Le tre cose dello schema che sorprendono, e che dallo schema non si leggono a
colpo d'occhio:

- **un campo non previsto e' un errore, non un campo ignorato**: il corpo si
  rifiuta con `400`. E' voluto — uno shard che scrive `styleUrl` invece di
  `styleId` deve accorgersene subito, non ricevere una pagina con lo stile di
  serie;
- **`GeometryCollection` si rifiuta con `400`**: se ne hai una, spacchettala in
  una feature per geometria. Non e' una svista — le sue geometrie non stanno in
  `coordinates` ma in `geometries`, e il tetto delle 100.000 coordinate non le
  contava, quindi la collection era il modo per aggirarlo. Nessuno shard ne ha
  bisogno e la regola e' la stessa dell'antimeridiano: si rifiuta invece di
  indovinare;
- **tre tetti non sono nello schema** perche' JSON Schema non li esprime, e
  stanno in `x-wm-regole-aggiuntive`: il totale delle coordinate di tutte le
  feature insieme, i pixel della pagina (che dipendono da formato, orientamento e
  dpi presi insieme — per questo `dpi: 600` e' dichiarato ammesso ma su ogni
  formato sfora il tetto dei pixel) e l'inquadratura, che rifiuta un riquadro a
  cavallo dell'antimeridiano e un `padding` che non lascia area utile.

### Una chiamata, da copiare e incollare

Con il servizio (o [la finta](#3-la-finta-per-sviluppare-senza-il-servizio))
in ascolto, questa scrive `mappa.png` nella cartella corrente e stampa gli
header di corredo:

```bash
BASE=http://127.0.0.1:8099   # la finta; in produzione l'indirizzo del servizio
TOKEN=<il tuo token>

curl -sS -D - -o mappa.png \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{
    "geometry": {
      "type": "FeatureCollection",
      "features": [
        {
          "type": "Feature",
          "properties": {"stroke": "#e2001a", "stroke-width": 4},
          "geometry": {"type": "LineString", "coordinates": [[10.50, 43.78], [10.55, 43.81]]}
        }
      ]
    },
    "page": {"format": "a4", "orientation": "portrait", "dpi": 300},
    "styleId": "webmapp",
    "mapInfo": true
  }' \
  "$BASE/v1/print/map" | grep -i '^x-wm-\|^HTTP/'
```

Attesi: `HTTP/1.1 200 OK`, i tre header `x-wm-*` e un PNG di 2480 x 3508 px
(`file mappa.png` lo conferma). Se arriva un `401`, il token e' sbagliato; se
arriva un `400`, il corpo lo e' e il messaggio dice quale campo.

### La risposta

`200` con `Content-Type: image/png`, `Cache-Control: no-store` e tre header di
corredo, sempre presenti:

| header | esempio | cos'e' |
|---|---|---|
| `x-wm-scale` | `1:42736` | la scala **calcolata**, da stampare sotto la mappa |
| `x-wm-dpi` | `300` | la densita' con cui e' stato reso il PNG |
| `x-wm-attribution` | `© OpenStreetMap · © Webmapp` | l'attribuzione obbligatoria |

I valori sono **byte UTF-8**: in PHP si leggono senza conversioni, ma se il tuo
client li passa per `latin1` il `©` e il `·` escono malformati.

### Gli errori

| stato | quando | cosa fa il job |
|---|---|---|
| `400` | richiesta non valida | non riprovare: e' un difetto del chiamante. Il messaggio nomina il **campo**, mai il suo contenuto |
| `401` | token mancante o sconosciuto | non riprovare |
| `413` | corpo oltre 2 MiB | non riprovare: semplifica la geometria |
| `429` | troppe richieste per quel token | **rispetta `Retry-After`** |
| `502` | il rendering e' fallito | riprovabile una volta; poi e' un guasto da segnalare |
| `503` | servizio pieno (vedi sotto) | **rispetta `Retry-After`** (30 s) |
| `504` | il rendering ha superato i 120 s | **rispetta `Retry-After`** (60 s) |

Gli stessi codici, con le stesse istruzioni per il job, sono nello schema
(`responses` dell'operazione `printMap`): quella e' la versione che un
generatore di client legge.

Il corpo di un errore e' `{"error": "..."}`. Non contiene mai le geometrie
ricevute, e nemmeno un pezzo: dagli shard arrivano anche tracce non pubblicate.
Non aspettarti di ricapire *quale* coordinata era sbagliata guardando la
risposta — non c'e', per progetto.

---

## 2. Le cinque cose che costano un pomeriggio

### a. La scala esce dall'inquadratura: non si chiede, non e' fissa

Non c'e' nessun campo `scale`. Il servizio inquadra la `FeatureCollection` sulla
pagina (come `zoomToExtent` di OpenLayers) e la scala e' **quello che ne viene
fuori**, diversa per ogni percorso. Su un A4 verticale a 300 dpi, misurata su
estensioni **nord-sud** — cioe' nel verso lungo del foglio, che e' il caso
MIGLIORE:

| estensione della traccia (nord-sud) | scala risultante | est-ovest, stessa estensione |
|---|---|---|
| fino a ~5 km | 1:20.300 (si ferma li': `maxZoom` 16) | 1:25.800 |
| 8 km | 1:28.500 | 1:41.200 |
| 10 km | 1:35.600 | 1:51.500 |
| 12 km | 1:42.700 | 1:61.800 |
| 20 km | 1:71.200 | 1:103.100 |

**Nello stesso foglio il verso conta: una traccia est-ovest sta a un
denominatore fino a ~1,45 volte quello della stessa lunghezza nord-sud**, perche'
su un A4 verticale il lato corto e' quello orizzontale. La colonna di destra e'
il caso peggiore, le due colonne sono i due estremi, e un percorso obliquo sta in
mezzo.

Quindi **un sentiero di media lunghezza su un A4 viene circa 1:40.000, non
1:25.000.** Chi si aspetta la scala delle carte escursionistiche resta
sorpreso: a 1:25.000 su un A4 ci sta **circa 7 km se il percorso si sviluppa
nord-sud e circa 4,8 km se si sviluppa est-ovest**. Se la scheda deve dichiarare
una scala, prendila da `x-wm-scale`; se deve averne una fissa, allora servono
piu' fogli e il servizio non li taglia da solo — e' una cosa da decidere
insieme, non da aggirare con `maxZoom`.

Nota: conta il **riquadro** della traccia, non la sua lunghezza. Un anello di
20 km stretto in 3 km di raggio si inquadra come una traccia da 6 km.

### b. `mapInfo` e' acceso di serie, e spegnerlo sposta i dati negli header

Di serie (`mapInfo: true`) la pagina esce con barra di scala, freccia del nord e
attribuzioni **disegnate sopra la mappa**, in basso.

Con `mapInfo: false` la pagina e' mappa e basta — ma gli header `x-wm-scale`,
`x-wm-dpi` e `x-wm-attribution` **ci sono comunque**, in entrambi i casi. Serve
esattamente a questo: se il PDF vuole la scala e le attribuzioni in una fascia
*sotto* la mappa, nel suo font e nel suo layout, chiedi `mapInfo: false` e
componile tu dagli header.

Attenzione: le attribuzioni sono obbligatorie per la licenza di OpenStreetMap.
Con `mapInfo: false` diventano responsabilita' del PDF, e un foglio senza
attribuzione e' un problema legale, non estetico.

### c. `503` vuol dire due cose diverse, e dal di fuori non si distinguono

- **«siamo carichi»** — i due slot di rendering sono occupati. Normale sotto
  carico: riprova dopo il `Retry-After`.
- **«siamo rotti»** — ci sono rendering abbandonati dopo la scadenza che non
  sono mai rientrati. Non si puo' annullare una `render()` di maplibre-native,
  quindi il servizio li conta e rifiuta di avviarne altri sopra: altrimenti il
  processo verrebbe ucciso dal tetto di memoria. Si risolve solo con il riciclo
  del processo (un timer, ogni 6 ore).

La risposta e' la stessa, e **oggi i due casi si distinguono solo dai log del
container** (`print: slot pieni`, con `freeSlots`, `inFlight` e `cause`). Per
chi scrive il job Horizon la conseguenza pratica e':

- **rispetta `Retry-After`**, sempre: e' 30 s per gli slot pieni e 60 s per una
  scadenza. Riprovare subito peggiora le cose, perche' il servizio e' al peggio
  proprio mentre un rendering abbandonato e' ancora in volo;
- metti un **tetto ai tentativi** e falli crescere: se il `503` e' del secondo
  tipo, nessun numero di tentativi lo risolve prima del riciclo;
- se un job batte sul `503` per piu' di qualche minuto, **la cosa da guardare
  sono i log del container**, non il codice dello shard.

### d. Una pagina costa secondi e un gigabyte: non e' un endpoint sincrono

Misurato nel container, A4 a 300 dpi:

- **da 3 a 5,2 secondi** per pagina (5,2 su una zona densa come Pisa);
- **circa 1 GB di RSS** per rendering, con tetto del container a 3 GB;
- **2 slot**: oltre, `503`.

Il tetto di tempo per rendering e' 120 s, oltre il quale arriva `504`.

Vuol dire che **una richiesta web non puo' chiamare questo endpoint e aspettare
la risposta.** Il consumatore previsto e' un job in coda (Horizon): l'utente
chiede il PDF, il job rende la mappa, il PDF si compone quando la mappa c'e'.
Con due slot in tutto, dieci utenti che chiedono una scheda nello stesso minuto
sono cinque giri di coda, non dieci richieste parallele.

### e. Il disegno delle tracce viaggia **dentro** il GeoJSON

Non ci sono parametri `color` o `width` nel corpo. Il colore e lo spessore
stanno nelle `properties` di ogni feature, nella convenzione
[simplestyle-spec](https://github.com/mapbox/simplestyle-spec):

```json
"properties": {"stroke": "#e2001a", "stroke-width": 4}
```

- `stroke`: **solo esadecimale**, `#rgb` o `#rrggbb`. Niente nomi di colore,
  niente `rgba()`, niente `url(...)`.
- `stroke-width`: numero di pixel css, maggiore di 0 e fino a 40. Viene
  moltiplicato per il fattore di stampa, quindi `4` non sono 4 pixel sul PNG.
- **Tutto il resto delle `properties` viene buttato via** prima del rendering:
  nomi, id, descrizioni. Non e' una svista, e' il requisito R11 — le tracce non
  pubblicate degli shard non devono entrare nel processo. Non aspettarti che un
  `title` finisca sulla mappa.

---

## 3. La finta, per sviluppare senza il servizio

`src/print/fake.js` e' un'implementazione finta della stessa interfaccia:
restituisce una **pagina grigia con sopra scritte le sue dimensioni**, delle
misure esatte che avrebbe la pagina vera, con il corredo vero e gli header veri.
Non ha bisogno di maplibre-native, del DEM, ne' del server delle tile acceso, e
una pagina A4 a 300 dpi costa un quarto di secondo invece di cinque.

**La finta condivide la validazione del servizio vero, non la imita.** Importa
`parseRequest` e `fitBounds` dai moduli di produzione e monta il router vero,
sostituendo solo il rendering. Quindi rifiuta esattamente cio' che rifiuta il
servizio — URL in qualunque campo, `styleId` o `format` sconosciuti,
`FeatureCollection` vuota, traccia che attraversa l'antimeridiano, corpo oltre
il tetto, `stroke` o `stroke-width` fuori scala, coordinate annidate oltre il
limite, `GeometryCollection` — **con gli stessi messaggi di errore**. E' il punto: una finta che
accetta tutto fa passare i test dello shard e lascia scoprire i difetti contro
il servizio reale, cioe' in produzione.

Non essendo una mappa, invece, non si puo' usare per: provare la leggibilita',
contare le etichette, misurare l'ombreggiatura o verificare lo stile.

**Una differenza resta, nel verso prudente.** `fakePrint(body)` riceve un
oggetto gia' deserializzato e puo' misurare solo la sua ri-serializzazione
**minificata**, mentre il servizio conta i byte che arrivano sul filo: il suo
tetto del corpo e' quindi un limite **inferiore**. Un corpo indentato puo'
passare dalla funzione e prendersi `413` in produzione (misurata la stessa
richiesta: 748.840 byte compatta, 5.069.090 indentata). Chi vuole la misura
vera usa la finta **come server**: li' il 413 lo da' lo stesso
`express.json` del servizio.

### Metterla in piedi

Serve il repo e le sue dipendenze: non c'e' un pacchetto da installare.

```bash
git clone https://github.com/webmappsrl/wm-tiles.git
cd wm-tiles
npm ci          # ~1 minuto
node src/print/fake.js
```

Node **18 o 20** (il container del servizio usa 20.18.1; sviluppato su 18.20.8).
`npm ci` compila anche `sharp` e scarica il binario di maplibre-native, che alla
finta non serve: se quel pacchetto fallisce sulla tua macchina, la finta
funziona lo stesso — non viene mai importato da `fake.js`.

### Come server HTTP (shard PHP, test d'integrazione)

```bash
# un token generato a ogni avvio e stampato sul terminale
node src/print/fake.js

# oppure un token stabile, per i test automatici dello shard
PRINT_FAKE_TOKEN=<token di prova, almeno 24 caratteri> PRINT_FAKE_PORT=8099 \
  node src/print/fake.js

# e con il limite al minuto alzato, per una suite che fa molte richieste di fila
PRINT_FAKE_RPM=600 node src/print/fake.js
```

Il token deve essere lungo **almeno 24 caratteri**, come quelli veri: la finta
rifiuta di partire con uno piu' corto, e lo dice. E' voluto — un token di sei
caratteri funzionava qui e faceva *fallire l'avvio* del servizio vero, cioe' il
difetto si scopriva in deploy.

Il limite al minuto di serie e' **quello della produzione** (30 richieste per
token): uno shard che lo supera si prende il `429` qui, non la prima volta che
chiama il servizio vero. `PRINT_FAKE_RPM` lo alza quando serve.

Ascolta sulla porta `8099` (`PRINT_FAKE_PORT` per cambiarla) ed espone le
stesse rotte: `POST /v1/print/map` e `GET /health`, che risponde
`{"status":"ok","fake":true}` — da li' un test capisce di stare parlando con la
finta. Puntaci la configurazione dello shard al posto dell'indirizzo vero.

Codici di stato, header, token, limite al minuto e slot sono quelli di
produzione, perche' e' il router vero: si possono esercitare anche il `401` e il
`429`.

### Come funzione, in un test in JavaScript

```js
import {fakePrint} from '../src/print/fake.js';

const png = await fakePrint({
  geometry: {type: 'FeatureCollection', features: [/* ... */]},
  page: {format: 'a4', orientation: 'portrait', dpi: 300},
});
// 2480 x 3508
```

Lancia un errore con il messaggio del servizio vero se la richiesta non e'
valida. Gli esempi stanno in `test/print-fake.test.js`.

---

## 4. Il token, e l'accesso vero

**In questo repo non c'e' nessun token, e non ce ne sara' mai uno:** il repo e'
pubblico su GitHub. Nemmeno un esempio, perche' un token di esempio plausibile
prima o poi viene copiato da qualcuno che lo crede valido.

I token stanno in un file **fuori dal repo**, sull'host del servizio, il cui
percorso arriva dalla variabile d'ambiente `PRINT_TOKENS_PATH` (nel container e'
`/etc/wm-tiles/print-tokens.json`, montato in sola lettura). Il formato e' un
oggetto JSON, un token per chiave:

```json
{
  "<il segreto, almeno 24 caratteri>": {"shard": "<nome dello shard>", "rpm": 30}
}
```

- `shard` finisce **nei log** al posto del contenuto della richiesta: serve a
  sapere chi ha chiamato. Mettici il nome dello shard, non quello di una persona.
- `rpm` e' il limite di richieste al minuto di quel token (senza, 30). Il limite
  e' per token, non per indirizzo: due shard non si rubano la quota.

**Per ottenere il tuo token:** chiedilo a chi gestisce l'host del servizio di
stampa, dicendo per quale shard. Chi lo crea lo aggiunge a quel file e gli da'
`chmod 600`, poi riavvia il container. Il token non va mai incollato in un
ticket, in una chat di gruppo, in un `.env` committato o in un messaggio di
commit; nello shard sta nella sua configurazione segreta, come le altre
credenziali.

Due cose da sapere:

- **un deploy senza il file dei token e' un endpoint chiuso, non aperto**: il
  servizio parte, scrive «print: nessun token» e risponde `401` a tutti. Se ti
  prendi `401` con un token che ti e' appena stato dato, il sospetto numero uno
  e' che il file non sia stato riletto (va riavviato il container);
- **il token non compare mai in un log**, nemmeno troncato, nemmeno in un
  messaggio di errore. Quindi non si puo' verificare guardando i log del
  servizio quale token e' arrivato: si verifica dalla parte dello shard.

Finche' il token non c'e', si sviluppa contro la finta — ed e' il modo giusto di
cominciare comunque, perche' non consuma slot a nessuno.

---

## 5. Riferimenti

- requisiti e vincoli:
  `docs/features/9011-servizio-di-rendering-delle-mappe-per-la-stampa-su-wm-tiles/overview.md`
- **lo schema, che e' la validazione**: `src/print/openapi.json` (servito dal
  servizio su `/v1/print/openapi.json`, da sfogliare su `/v1/print/docs`)
- la rotta: `src/print/route.js`; la compilazione dello schema e la traduzione
  dei suoi errori in messaggi che non riportano i valori ricevuti:
  `src/print/schema.js`
- i tetti, tutti in numero — letti dallo schema: `src/print/limits.js`
- i formati di pagina: `src/print/formats.js`
- la finta: `src/print/fake.js`
- il container e i suoi tetti: `compose.yml`, `Dockerfile.print`
