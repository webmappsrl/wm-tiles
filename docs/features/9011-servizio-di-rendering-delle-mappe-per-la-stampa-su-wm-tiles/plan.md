> Ticket: oc:9011
> Stato: approvato il 2026-11-23

# Servizio di rendering delle mappe per la stampa — piano

> **Per chi esegue:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`
> (consigliata) oppure `superpowers:executing-plans`, task per task. Gli step usano
> le caselle (`- [ ]`) per segnare l'avanzamento.
> **Nessun commit durante l'esecuzione.** I comandi `git commit` nel piano sono
> istruzioni testuali: il primo commit lo fa il dev, a lavoro finito.

**Obiettivo:** dare a `wm-tiles` un endpoint che, ricevute geometrie GeoJSON e un
formato pagina, restituisce la mappa come PNG a risoluzione di stampa.

**Architettura:** il renderer vive in `src/print/`, gira in un container separato da
quello che serve le tile e riusa il percorso nativo esistente
(`adattaStile` + le due mappe con l'ombra CPU in mezzo), estratto da
`pipeline/render-png.mjs` in una funzione che accetta un frame rettangolare.

**Stack:** Node 20, Express 5, `@maplibre/maplibre-gl-native` 6.2.0, `sharp`, Vitest,
Docker (ubuntu:22.04 + Xvfb + Mesa).

**Spec:** [overview.md](overview.md) — i requisiti `R1`–`R17` sono lì, e il piano li cita.

## Vincoli globali

- **Identificatori del codice nuovo in inglese**, anche dentro file che hanno nomi
  italiani (`ombra.js`, `stile-nativo.js`): i parametri nuovi sono `width`/`height`
  accanto a `grigi` e `sfoca`, che **non si rinominano**. Il refactor dei nomi
  esistenti e' un ticket a parte, che apre il dev. Commenti, log e documentazione
  restano in italiano. [R14](overview.md#r14)
- **`PIXEL_RATIO` resta `0.5`.** Il fattore tipografico agisce sulle sole grandezze
  di `IN_PIXEL`, mai su `minzoom`, `maxzoom` o sulle soglie di `step`/`interpolate`.
- **I PNG di produzione non cambiano di un byte** ai livelli interi. Vale per ogni
  task che tocca `ombra.js` o `stile-nativo.js`.
- **I PBF e le regole che li generano non si toccano.** Nessun profilo di stampa
  separato: si usa `style/zoom-profile.json` com'e'.
- **Nessuna geometria nei log, nelle cache, nei messaggi di errore, nei core dump.**
  [R11](overview.md#r11)
- **Nessun URL accettato in nessun campo della richiesta.** [R10](overview.md#r10)
- Commit: `feat(oc:9011): ...`, `fix(oc:9011): ...`, `refactor(oc:9011): ...`.

## Attenzione in review

Cinque condizioni che la spec implica e che nessun task esercita da solo. Per
ognuna il test sta nel task che possiede il codice.

1. **Geometria a cavallo dell'antimeridiano o oltre il limite di Mercatore**: il bbox
   si avvolge e l'inquadratura esce dal mondo. Test nel Task 4.
2. **`FeatureCollection` vuota, `geometry: null`, coordinate invertite lat/lon**:
   lo shard sbaglia, e l'errore deve dirlo senza citare i dati. Test nel Task 4 e 9.
3. **`padding` piu' grande della pagina**: lo zoom calcolato diventa negativo o
   infinito. Test nel Task 4.
4. **`maxZoom` oltre il `maxzoom` delle sorgenti** (curve z15, OSM z14): la pagina
   esce senza rilievo leggibile. Test nel Task 4.
5. **Rendering che non richiama mai la callback**: lo slot resta occupato e il
   servizio risponde `503` per sempre con il processo sano. Test nel Task 9.

---

### Task 1: la prova di costo a formato pagina

Viene prima di tutto: da qui escono i tetti del container, la concorrenza e la
soglia di dpi.

**Files:**
- Crea: `tools/page-cost.mjs`
- Crea: `docs/features/9011-servizio-di-rendering-delle-mappe-per-la-stampa-su-wm-tiles/notes.md` (sezione «Decisioni»)

**Interfaces:**
- Consuma: `pipeline/render-png.mjs` come modello del flusso (due mappe, ombra in mezzo)
- Produce: i numeri su cui i Task 9 e 10 fissano slot, timeout e tetti

- [ ] **Step 1: scrivere il criterio di accettazione in `notes.md`, prima di misurare**

Nella sezione «Decisioni», con la data: un A4 a 300 dpi (2480x3508) **sotto i 30 s**
e **sotto 2 GB** di picco, con il testo piu' piccolo **non inferiore a 2,5 mm** sulla
carta. Scriverlo prima serve a non far diventare il numero che esce il metro di se
stesso.

- [ ] **Step 2: scrivere `tools/page-cost.mjs`**

Prende `--width`, `--height`, `--ratio`, `--zoom`, `--center`, `--geojson` e, usando
lo stesso flusso di `render-png.mjs` (due `mbgl.Map`, `grigi`/`componi` in mezzo),
rende **un** frame e stampa: millisecondi, picco di `process.memoryUsage().rss`,
byte del PNG. Non scrive su disco se non con `--out`.

- [ ] **Step 3: eseguire la prova su una traccia vera**

Run: `node tools/page-cost.mjs --width 2480 --height 3508 --ratio 2 --center 10.72,44.21 --zoom 14`
Atteso: tre numeri; nessun errore nel riquadro `#err`, che `tile-diff.mjs` legge e che
la misura altrimenti nasconde.

- [ ] **Step 4: registrare in `notes.md` la misura e la soglia di dpi scelta**

Se la misura sta nel criterio, il dpi resta 300. Se non ci sta, si scende
(300 → 250 → 200) e si scrive **di quanto** e **perche'**, con il numero misurato.
Sotto i 200 dpi le linee sottili scalettano: quello e' il pavimento, e scenderci
significa uscire da WEBSITE-21, da dichiarare al dev invece di deciderlo qui.

- [ ] **Step 5: commit**

```bash
git add tools/page-cost.mjs docs/features/9011-*/notes.md
git commit -m "feat(oc:9011): strumento di misura del costo di un frame a formato pagina"
```

---

### Task 2: il gate di identita' byte sui PNG

Precede ogni modifica a `ombra.js`: senza, non si sa se un PNG cambiato sia colpa
della generalizzazione o di altro.

**Files:**
- Crea: `tools/png-identity.mjs`
- Crea: `test/png-identity.test.js`

**Interfaces:**
- Produce: `hashTiles(elenco, base) -> Map<string, string>` (chiave `z/x/y`, valore sha256)

- [ ] **Step 1: scrivere il test che fallisce**

```js
it('due rese della stessa tile danno lo stesso hash', async () => {
  const a = await hashTiles(['14/8668/5972'], BASE);
  const b = await hashTiles(['14/8668/5972'], BASE);
  expect(b.get('14/8668/5972')).toBe(a.get('14/8668/5972'));
});
```

- [ ] **Step 2: eseguirlo e verificare che fallisca**

Run: `npm test -- png-identity`
Atteso: FAIL, `hashTiles is not a function`.

- [ ] **Step 3: implementare `hashTiles(tiles: string[], base: string) -> Promise<Map<string,string>>` in `tools/png-identity.mjs`**

Rende le tile con il percorso nativo e restituisce lo sha256 dei byte PNG. Con
`--save <file>` scrive gli hash, con `--check <file>` li confronta ed esce 1 alla
prima differenza, nominando la tile.

- [ ] **Step 4: eseguire il test e verificare che passi**

Run: `npm test -- png-identity`
Atteso: PASS.

- [ ] **Step 5: salvare gli hash di riferimento PRIMA di toccare `ombra.js`**

Run: `node tools/png-identity.mjs --save test/fixtures/png-hash.json 14/8668/5972 15/17335/11944 13/4334/2986 16/34639/23768`
Atteso: il file esiste e contiene quattro voci.

- [ ] **Step 6: commit**

```bash
git add tools/png-identity.mjs test/png-identity.test.js test/fixtures/png-hash.json
git commit -m "feat(oc:9011): gate di identita' byte dei PNG prima del refactor dell'ombra"
```

---

### Task 3: l'ombra da frame quadrato a rettangolare

**Files:**
- Modifica: `src/raster/ombra.js` (`quoteVista` 96, `grigi` 53, `sfoca` 114, `componi` 144)
- Modifica: `pipeline/render-png.mjs`, `tools/ombra-native-vs-ol.mjs`, `tools/ombra-per-classe.mjs` (chiamanti)
- Modifica: `test/raster-ombra.test.js`

**Interfaces:**
- Produce: `grigi(E, width, height, B, passo, f, s)`, `quoteVista(D, Wd, u0, v0, x0, y0, width, height, B, s)`, `sfoca(a, width, height)`, `componi(sotto, sopra, sh, f, width, height)`

- [ ] **Step 1: scrivere il test che fallisce**

In `test/raster-ombra.test.js`, accanto a quelli sul piano inclinato:

```js
it('un frame rettangolare non e\' il quadrato del lato maggiore', () => {
  const {luce} = grigi(pianoRect(0, 1, 24, 16), 24, 16, B, 10, set);
  expect(luce.length).toBe(24 * 16);
});
it('su un piano inclinato il rettangolo da\' gli stessi valori del quadrato', () => {
  const q = grigi(piano(0, 1), 16, 16, B, 10, set).luce;
  const r = grigi(pianoRect(0, 1, 16, 16), 16, 16, B, 10, set).luce;
  expect(Array.from(r)).toEqual(Array.from(q));
});
```

- [ ] **Step 2: eseguirlo e verificare che fallisca**

Run: `npm test -- raster-ombra`
Atteso: FAIL sulla lunghezza (oggi il secondo argomento e' il solo `N`).

- [ ] **Step 3: generalizzare le quattro funzioni**

Ogni `N * N` diventa `width * height`, ogni `W * W` diventa `(width + 2*B) * (height + 2*B)`,
e i cicli scorrono righe e colonne separatamente. **Le formule non cambiano**: la
finestra di Horn 3x3, i segni di `dz/dx` e `dz/dy`, il passo del DEM restano quelli.
Aggiornare i tre chiamanti passando `N, N` dove oggi passano `N`.

- [ ] **Step 4: eseguire i test e il gate**

Run: `npm test -- raster-ombra && node tools/png-identity.mjs --check test/fixtures/png-hash.json`
Atteso: PASS e uscita 0. Un hash diverso significa che la generalizzazione ha
cambiato il risultato: si corregge, non si aggiorna il riferimento.

- [ ] **Step 5: verificare che l'ombra resti quella delle app**

Run: `node tools/ombra-native-vs-ol.mjs`
Atteso: uscita 0.

- [ ] **Step 6: commit**

```bash
git add src/raster/ombra.js pipeline/render-png.mjs tools/ombra-native-vs-ol.mjs tools/ombra-per-classe.mjs test/raster-ombra.test.js
git commit -m "refactor(oc:9011): l'ombreggiatura accetta frame rettangolari"
```

---

### Task 4: formati di pagina e inquadratura

[R2](overview.md#r2), [R3](overview.md#r3)

**Files:**
- Crea: `src/print/formats.js`, `src/print/fit.js`
- Crea: `test/print-fit.test.js`

**Interfaces:**
- Produce: `PAGE_FORMATS` (`{a4: {widthMm: 210, heightMm: 297}, a5: …}`),
  `pageSize({format, orientation, dpi}) -> {width, height}`,
  `fitBounds(featureCollection, {width, height, padding, maxZoom}) -> {center: [lon, lat], zoom}`

- [ ] **Step 1: scrivere i test che falliscono**

```js
it('un A4 verticale a 300 dpi e\' 2480x3508', () => {
  expect(pageSize({format: 'a4', orientation: 'portrait', dpi: 300})).toEqual({width: 2480, height: 3508});
});
it('orizzontale scambia i lati', () => {
  expect(pageSize({format: 'a4', orientation: 'landscape', dpi: 300})).toEqual({width: 3508, height: 2480});
});
it('un punto solo non porta lo zoom all\'infinito', () => {
  const {zoom} = fitBounds(punto(10.72, 44.21), {width: 2480, height: 3508, padding: 24, maxZoom: 15});
  expect(zoom).toBe(15);
});
it('una traccia larga entra per il lato lungo', () => {
  const {zoom} = fitBounds(linea([[10.0, 44.2], [10.2, 44.2]]), {width: 2480, height: 3508, padding: 24, maxZoom: 18});
  expect(zoom).toBeLessThan(fitBounds(linea([[10.0, 44.2], [10.02, 44.2]]), {width: 2480, height: 3508, padding: 24, maxZoom: 18}).zoom);
});
it('un padding piu\' grande della pagina e\' un errore, non uno zoom negativo', () => {
  expect(() => fitBounds(linea([[10, 44], [10.1, 44.1]]), {width: 100, height: 100, padding: 200, maxZoom: 18}))
    .toThrow(/padding/);
});
it('una collection vuota e\' un errore che non cita i dati', () => {
  expect(() => fitBounds({type: 'FeatureCollection', features: []}, base)).toThrow(/nessuna geometria/);
});
it('coordinate invertite cadono fuori dal mondo e lo dicono', () => {
  expect(() => fitBounds(punto(44.21, 10.72), base)).not.toThrow();
  expect(() => fitBounds(punto(200, 95), base)).toThrow(/fuori/);
});
it('oltre il limite di Mercatore la latitudine si ferma', () => {
  const {center} = fitBounds(punto(10, 85.5), base);
  expect(center[1]).toBeLessThanOrEqual(85.0512);
});
```

- [ ] **Step 2: eseguirli e verificare che falliscano**

Run: `npm test -- print-fit`
Atteso: FAIL, i moduli non esistono.

- [ ] **Step 3: implementare `pageSize` e `fitBounds`**

`pageSize`: millimetri per dpi diviso 25,4, arrotondato. `fitBounds`: bbox delle
feature, proiezione Web Mercator, zoom che fa entrare il bbox nei pixel al netto del
`padding` su entrambi i lati, limitato da `maxZoom`; la latitudine si tronca a
±85,0512. Un bbox degenere (punto) usa `maxZoom`. L'errore per i casi limite nomina
il campo, **mai il suo contenuto**.

- [ ] **Step 4: eseguire i test e verificare che passino**

Run: `npm test -- print-fit`
Atteso: PASS.

- [ ] **Step 5: commit**

```bash
git add src/print/formats.js src/print/fit.js test/print-fit.test.js
git commit -m "feat(oc:9011): formati di pagina e inquadratura dalla geometria"
```

---

### Task 5: `renderFrame()`, il frame estratto dallo script

> ⚠️ Realizzato con divergenze: vedi [notes.md](notes.md#task-5) — validazione
> dello stile spostata in `createMaps`, piu' un rilievo del revisore respinto con prova.

**Files:**
- Crea: `src/print/render.js`
- Modifica: `pipeline/render-png.mjs` (usa la funzione estratta)
- Crea: `test/print-render.test.js`

**Interfaces:**
- Consuma: `grigi`, `quoteVista`, `componi`, `fasciaDi` da `src/raster/ombra.js` (Task 3)
- Produce: `renderFrame({style, center, zoom, width, height, ratio, shade}) -> Promise<Buffer>` (RGB grezzo),
  `createMaps(style)` che restituisce la coppia sotto/sopra

- [ ] **Step 1: scrivere il test che fallisce**

```js
it('restituisce width*height*3 byte', async () => {
  const rgb = await renderFrame({style: stileMinimo, center: [10.72, 44.21], zoom: 12, width: 64, height: 96, ratio: 1, shade: null});
  expect(rgb.length).toBe(64 * 96 * 3);
});
it('un errore del renderer non diventa un frame parziale', async () => {
  await expect(renderFrame({style: stileRotto, ...base})).rejects.toThrow();
});
```

- [ ] **Step 2: eseguirlo e verificare che fallisca**

Run: `npm test -- print-render`
Atteso: FAIL, `renderFrame is not a function`.

- [ ] **Step 3: implementare `renderFrame` e `createMaps` in `src/print/render.js`**

Riproduce il flusso di `pipeline/render-png.mjs:184-199`: due mappe, `disegna` su
entrambe con la stessa vista, l'ombra calcolata in mezzo quando `shade` c'e', e
`componi` alla fine. La callback delle risorse resta un `fetch` verso il server delle
tile. Le dimensioni della vista sono `width / ratio` e `height / ratio`.

- [ ] **Step 4: correlare gli errori del renderer alla richiesta** [R17](overview.md#r17)

`mbgl.on('message')` e' un gestore di processo: raccogliere i messaggi di gravita'
`error` in un contesto per-chiamata (un contatore creato da `renderFrame` e letto
alla fine) e far fallire la promessa invece di restituire un frame a cui manca un
layer.

- [ ] **Step 5: far usare la funzione a `pipeline/render-png.mjs`**

Lo script passa `width: N, height: N` e continua a produrre gli stessi PNG.

- [ ] **Step 6: eseguire test e gate**

Run: `npm test -- print-render && node tools/png-identity.mjs --check test/fixtures/png-hash.json`
Atteso: PASS e uscita 0.

- [ ] **Step 7: commit**

```bash
git add src/print/render.js pipeline/render-png.mjs test/print-render.test.js
git commit -m "feat(oc:9011): renderFrame, un frame di dimensioni arbitrarie"
```

---

### Task 6: le geometrie sopra la mappa

[R4](overview.md#r4)

**Files:**
- Crea: `src/print/overlay.js`
- Crea: `test/print-overlay.test.js`

**Interfaces:**
- Produce: `addOverlay(style, featureCollection) -> style` (copia, non muta)

- [ ] **Step 1: scrivere i test che falliscono**

```js
it('aggiunge una source geojson e due layer, alone sotto e traccia sopra', () => {
  const s = addOverlay(stileMinimo, linea([[10, 44], [10.1, 44.1]]));
  expect(s.sources['print-overlay'].type).toBe('geojson');
  const ids = s.layers.slice(-2).map(l => l.id);
  expect(ids).toEqual(['print-overlay-halo', 'print-overlay-line']);
});
it('legge stroke e stroke-width dalla feature', () => {
  const s = addOverlay(stileMinimo, lineaConStile('#c1272d', 4));
  const l = s.layers.at(-1);
  expect(l.paint['line-color']).toEqual(['coalesce', ['get', 'stroke'], DEFAULT_STROKE]);
  expect(l.paint['line-width']).toEqual(['coalesce', ['get', 'stroke-width'], DEFAULT_WIDTH]);
});
it('non muta lo stile ricevuto', () => {
  const prima = JSON.stringify(stileMinimo);
  addOverlay(stileMinimo, linea([[10, 44], [10.1, 44.1]]));
  expect(JSON.stringify(stileMinimo)).toBe(prima);
});
```

- [ ] **Step 2: eseguirli e verificare che falliscano**

Run: `npm test -- print-overlay`
Atteso: FAIL, il modulo non esiste.

- [ ] **Step 3: implementare `addOverlay`**

Aggiunge una source `geojson` con i dati **inline** (mai un URL) e due layer in fondo:
l'alone, piu' largo e chiaro, e la traccia. Colore e spessore si leggono per feature
con `['coalesce', ['get', 'stroke'], …]`, cosi' N tracce con colori propri si
distinguono senza parametri in piu'. L'alone non e' configurabile: e' leggibilita' su
carta.

- [ ] **Step 4: eseguire i test e verificare che passino**

Run: `npm test -- print-overlay`
Atteso: PASS.

- [ ] **Step 5: commit**

```bash
git add src/print/overlay.js test/print-overlay.test.js
git commit -m "feat(oc:9011): le geometrie ricevute si disegnano sopra la mappa"
```

---

### Task 7: la tipografia per la carta

> ⚠️ Il valore di partenza del fattore e' cambiato dopo la misura del Task 1:
> [notes.md](notes.md#2026-11-23--il-fattore-tipografico-parte-da-15-non-da-31)

[R5](overview.md#r5)

**Files:**
- Modifica: `src/raster/stile-nativo.js` (`adattaStile`, `IN_PIXEL`)
- Modifica: `pipeline/build-sprite.mjs:99`
- Crea: `tools/print-legibility.mjs`
- Crea: `test/print-typography.test.js`

**Interfaces:**
- Produce: `adattaStile(stileOl, {typeScale = 1} = {})` — firma retrocompatibile,
  `typeScale` moltiplica le sole proprieta' di `IN_PIXEL`

- [ ] **Step 1: scrivere i test che falliscono**

```js
it('senza typeScale lo stile e\' identico a prima', () => {
  expect(adattaStile(stileOl)).toEqual(adattaStile(stileOl, {typeScale: 1}));
});
it('typeScale moltiplica text-size ma non le soglie di zoom', () => {
  const s = adattaStile(stileOl, {typeScale: 3.125});
  const l = s.layers.find(x => x.id === 'place-label');
  expect(l.layout['text-size']).toBe(16 * 2 * 3.125);
  expect(l.minzoom).toBe(adattaStile(stileOl).layers.find(x => x.id === 'place-label').minzoom);
});
```

- [ ] **Step 2: eseguirli e verificare che falliscano**

Run: `npm test -- print-typography`
Atteso: FAIL, `adattaStile` ignora il secondo argomento.

- [ ] **Step 3: implementare `typeScale`**

Moltiplica le proprieta' di `IN_PIXEL` dopo il raddoppio esistente. **Non tocca**
`minzoom`, `maxzoom`, `sposta()` ne' le soglie di `step`/`interpolate`: il valore di
partenza e' `3.125 = 300 / 96`, il rapporto fra il pixel di schermo e quello di
stampa.

- [ ] **Step 4: aggiungere una densita' allo sprite**

In `pipeline/build-sprite.mjs:99`, `[1, 2]` diventa `[1, 2, 3]`. L'indice scrive gia'
`pixelRatio` per icona (riga 144), quindi non serve altro. Rigenerare lo sprite.

- [ ] **Step 5: scrivere `tools/print-legibility.mjs`**

Rende una pagina e misura **l'altezza in millimetri** del testo piu' piccolo:
riconosce le righe di glifi per densita' di inchiostro e converte i pixel in
millimetri con il dpi dichiarato. Esce 1 sotto la soglia passata con `--min-mm`.

- [ ] **Step 6: tarare `typeScale` e lo zoom insieme**

Run: `node tools/print-legibility.mjs --center 10.72,44.21 --format a4 --dpi 300 --min-mm 2.5`
Atteso: uscita 0. Se le etichette sono poche, salire di uno zoom e rimisurare: il
declutter ne scarta di piu' quando sono grandi. Registrare in `notes.md` i valori
scelti.

- [ ] **Step 7: eseguire test e gate**

Run: `npm test && node tools/png-identity.mjs --check test/fixtures/png-hash.json`
Atteso: PASS e uscita 0 — i PNG non usano `typeScale`, quindi non devono muoversi.

- [ ] **Step 8: commit**

```bash
git add src/raster/stile-nativo.js pipeline/build-sprite.mjs style/sprite tools/print-legibility.mjs test/print-typography.test.js
git commit -m "feat(oc:9011): fattore tipografico per la stampa e sprite a densita' maggiore"
```

---

### Task 8: il corredo della mappa

> ⚠️ Realizzato con divergenze: vedi [notes.md](notes.md#task-8) — validazione degli
> ingressi aggiunta ([R17](overview.md#r17)) e testo del corredo ancorato a destra.

[R15](overview.md#r15)

**Files:**
- Crea: `src/print/map-info.js`
- Crea: `test/print-map-info.test.js`

**Interfaces:**
- Produce: `drawMapInfo(rgb, {width, height, dpi, zoom, center, attributions}) -> Promise<Buffer>` (PNG),
  `mapInfoFields({zoom, center, dpi}) -> {scale: '1:25000', dpi, attribution: '© OpenStreetMap · © Webmapp'}`

- [ ] **Step 1: scrivere i test che falliscono**

```js
it('la scala si ricava da zoom e latitudine', () => {
  expect(mapInfoFields({zoom: 14, center: [10.72, 44.21], dpi: 300}).scale).toMatch(/^1:\d+$/);
});
it('l\'attribuzione cita OpenStreetMap e Webmapp', () => {
  expect(mapInfoFields(base).attribution).toBe('© OpenStreetMap · © Webmapp');
});
it('con mapInfo spento i campi ci sono lo stesso', () => {
  expect(mapInfoFields(base)).toBeTruthy();
});
```

- [ ] **Step 2: eseguirli e verificare che falliscano**

Run: `npm test -- print-map-info`
Atteso: FAIL.

- [ ] **Step 3: implementare `mapInfoFields` e `drawMapInfo`**

La scala e' `metri per pixel x dpi / 25,4`, con i metri per pixel presi da
`PIXEL_Z0 * cos(lat) / 2^zoom`. `drawMapInfo` compone sul PNG, con `sharp`, una barra
graduata in metri, un indicatore del nord e la riga di attribuzione. La barra e'
grafica perche' resta corretta se il foglio viene ridotto.

- [ ] **Step 4: eseguire i test e verificare che passino**

Run: `npm test -- print-map-info`
Atteso: PASS.

- [ ] **Step 5: commit**

```bash
git add src/print/map-info.js test/print-map-info.test.js
git commit -m "feat(oc:9011): barra di scala, nord e attribuzioni sul PNG"
```

---

### Task 9: la rotta, il token, i limiti

> ⚠️ Realizzato con divergenze: vedi [notes.md](notes.md#task-9) — secondo contatore
> dei rendering in volo, header in byte UTF-8, `GeometryCollection` rifiutato.

[R1](overview.md#r1), [R7](overview.md#r7), [R8](overview.md#r8), [R9](overview.md#r9), [R10](overview.md#r10), [R11](overview.md#r11), [R16](overview.md#r16)

**Files:**
- Crea: `src/print/route.js`, `src/print/tokens.js`, `src/print/limits.js`
- Modifica: `src/server.js` (registra la rotta; e' la prima `app.post` del server)
- Crea: `test/print-route.test.js`

**Interfaces:**
- Consuma: `pageSize`, `fitBounds` (Task 4), `renderFrame` (Task 5), `addOverlay` (Task 6), `drawMapInfo`/`mapInfoFields` (Task 8)
- Produce: `printRouter(deps) -> express.Router`, `loadTokens(path) -> Map<string, {shard, rpm}>`

- [ ] **Step 1: scrivere i test che falliscono**

```js
it('senza token risponde 401', async () => {
  await request(app).post('/v1/print/map').send(richiestaValida).expect(401);
});
it('con token valido risponde image/png', async () => {
  const r = await request(app).post('/v1/print/map').set('Authorization', `Bearer ${TOKEN}`).send(richiestaValida);
  expect(r.status).toBe(200);
  expect(r.headers['content-type']).toBe('image/png');
});
it('i campi di corredo tornano negli header anche con mapInfo false', async () => {
  const r = await request(app).post('/v1/print/map').set('Authorization', `Bearer ${TOKEN}`)
    .send({...richiestaValida, mapInfo: false});
  expect(r.headers['x-wm-attribution']).toBe('© OpenStreetMap · © Webmapp');
  expect(r.headers['x-wm-scale']).toMatch(/^1:\d+$/);
  expect(r.headers['x-wm-dpi']).toBe('300');
});
it('oltre gli slot risponde 503 con Retry-After', async () => {
  const r = await oltreLaSoglia();
  expect(r.status).toBe(503);
  expect(r.headers['retry-after']).toBeDefined();
});
it('un rendering che non finisce libera lo slot e fallisce', async () => {
  const r = await request(app).post('/v1/print/map').set('Authorization', `Bearer ${TOKEN}`).send(richiestaCheAppende);
  expect(r.status).toBe(504);
  expect(slotLiberi()).toBe(MAX_SLOTS);
});
it('un corpo oltre il tetto risponde 413 dicendo il limite', async () => {
  const r = await request(app).post('/v1/print/map').set('Authorization', `Bearer ${TOKEN}`).send(geometriaEnorme);
  expect(r.status).toBe(413);
  expect(r.body.error).toMatch(/dimensione massima/);
});
it('uno styleId sconosciuto o un URL sono rifiutati', async () => {
  for (const styleId of ['http://interno/stile.json', '../../etc/passwd', 'inesistente']) {
    const r = await request(app).post('/v1/print/map').set('Authorization', `Bearer ${TOKEN}`)
      .send({...richiestaValida, styleId});
    expect(r.status).toBe(400);
  }
});
it('l\'errore di validazione non contiene le coordinate ricevute', async () => {
  const r = await request(app).post('/v1/print/map').set('Authorization', `Bearer ${TOKEN}`)
    .send({...richiestaValida, geometry: punto(999, 999)});
  expect(JSON.stringify(r.body)).not.toContain('999');
});
```

- [ ] **Step 2: eseguirli e verificare che falliscano**

Run: `npm test -- print-route`
Atteso: FAIL, la rotta non esiste.

- [ ] **Step 3: implementare i tre moduli**

`tokens.js` legge un file **fuori dal repo** (percorso da variabile d'ambiente) che
associa token a shard e limite al minuto; `limits.js` tiene gli slot, il limite per
token e il tempo massimo, e libera lo slot in un `finally`; `route.js` valida,
inquadra, rende e risponde. `styleId` si risolve su una mappa chiusa di nomi noti:
tutto il resto e' `400`, URL compresi. Il corpo si legge con `express.json({limit})`,
con il tetto dichiarato e non il default.

- [ ] **Step 4: registrare la rotta in `src/server.js`**

Accanto alle altre, con il prefisso versionato. Il `set` arriva dal corpo, come per
le tile (rischio accettato e scritto nell'overview).

- [ ] **Step 5: impedire i core dump nel processo** [R11](overview.md#r11)

Nel container, `ulimit -c 0`: un segfault del modulo nativo scriverebbe su disco la
memoria con dentro le geometrie.

- [ ] **Step 6: eseguire i test e verificare che passino**

Run: `npm test -- print-route`
Atteso: PASS.

- [ ] **Step 7: commit**

```bash
git add src/print/route.js src/print/tokens.js src/print/limits.js src/server.js test/print-route.test.js
git commit -m "feat(oc:9011): POST /v1/print/map con token, slot e limiti"
```

---

### Task 10: container, deploy, Caddy

> ⚠️ Realizzato con divergenze: vedi [notes.md](notes.md#task-10) — spegnimento mite
> su SIGTERM, Caddyfile validato prima del `mv`, router montato solo con i token.

[R6](overview.md#r6), [R12](overview.md#r12)

**Files:**
- Crea: `Dockerfile.print`, `compose.yml`
- Modifica: `infra/pubblica-dominio.sh` (il site block, **nello script**)
- Crea: `.github/workflows/print.yml`

**Interfaces:**
- Consuma: i numeri del Task 1 per i tetti e per `MAX_SLOTS`

- [ ] **Step 1: scrivere `Dockerfile.print`**

Parte da `pipeline/render-png.Dockerfile` (ubuntu:22.04, Xvfb, Mesa, Node 20.18.1,
maplibre-gl-native 6.2.0), ma **incorpora il codice** invece di montarlo, e avvia con
`--init`: senza, `xvfb-run` diventa il processo 1 e resta in attesa per sempre.

- [ ] **Step 2: scrivere `compose.yml` con i tetti misurati**

Memoria e CPU dal Task 1, `restart: unless-stopped`, riciclo periodico del processo e
`ulimit -c 0`. Il tetto di memoria e' un limite del **container**, non di Node:
`--max-old-space-size` non conta i buffer nativi di sharp ne' la memoria del contesto
GL.

- [ ] **Step 3: aggiungere il site block nello script, non sul server**

In `infra/pubblica-dominio.sh`, dentro l'heredoc che rigenera `/etc/caddy/Caddyfile`:
il percorso di stampa va in `reverse_proxy` verso il container. Caddy non ha rate
limit (verificato: 2.11.7, nessun modulo `rate_limit`), quindi qui c'e' solo
l'instradamento.

- [ ] **Step 4: verificare che il Caddyfile resti valido**

Run: `caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`
Atteso: valido, e `import /etc/caddy/siti/*.caddy` ancora presente.

- [ ] **Step 5: scrivere il workflow di build e deploy**

`.github/workflows/print.yml`: build dell'immagine e deploy sull'host. La cartella
`.github/` oggi non esiste.

- [ ] **Step 6: provare il container con un rendering vero**

Run: `docker compose run --rm print node tools/page-cost.mjs --width 2480 --height 3508 --ratio 2 --center 10.72,44.21 --zoom 14`
Atteso: gli stessi numeri del Task 1, entro il margine di una macchina diversa.

- [ ] **Step 7: commit**

```bash
git add Dockerfile.print compose.yml infra/pubblica-dominio.sh .github/workflows/print.yml
git commit -m "feat(oc:9011): container, compose e deploy del servizio di stampa"
```

---

### Task 11: l'implementazione finta e l'accesso dei dev

> ⚠️ Realizzato con divergenze: vedi [notes.md](notes.md#task-11) — tipi di geometria
> come mappa chiusa e tabella delle scale marcata nord-sud.

[R13](overview.md#r13)

**Files:**
- Crea: `src/print/fake.js`
- Crea: `docs/howto/stampa-mappe.md`
- Crea: `test/print-fake.test.js`

**Interfaces:**
- Consuma: `pageSize` e la validazione del Task 4 e 9 — la finta **condivide** la
  validazione, non la imita

- [ ] **Step 1: scrivere il test che fallisce**

```js
it('la finta rifiuta le stesse richieste del servizio vero', async () => {
  for (const cattiva of [{...valida, styleId: 'http://x'}, {...valida, format: 'a0'}, vuota]) {
    await expect(fakePrint(cattiva)).rejects.toThrow();
  }
});
it('la finta restituisce un PNG delle dimensioni giuste', async () => {
  const png = await fakePrint(valida);
  const {width, height} = await sharp(png).metadata();
  expect({width, height}).toEqual({width: 2480, height: 3508});
});
```

- [ ] **Step 2: eseguirlo e verificare che fallisca**

Run: `npm test -- print-fake`
Atteso: FAIL.

- [ ] **Step 3: implementare `fakePrint`**

Un PNG uniforme con sopra scritte le dimensioni, **ma con la validazione e
`PAGE_FORMATS` veri**: una finta che accetta tutto fa passare i test degli shard e
lascia scoprire i difetti solo contro il servizio reale.

- [ ] **Step 4: scrivere la procedura per i dev**

`docs/howto/stampa-mappe.md`: come ottenere un token, come chiamare l'endpoint, come
usare la finta in locale. Nessuna credenziale nel file: il repo e' pubblico.

- [ ] **Step 5: eseguire i test e verificare che passino**

Run: `npm test`
Atteso: PASS, tutta la suite.

- [ ] **Step 6: commit**

```bash
git add src/print/fake.js docs/howto/stampa-mappe.md test/print-fake.test.js
git commit -m "feat(oc:9011): implementazione finta e procedura per i dev"
```

### Task 12: lo schema OpenAPI come fonte della validazione

[R1](overview.md#r1), [R10](overview.md#r10), [R11](overview.md#r11)

> ⚠️ Task aggiunto dal dev a lavoro concluso, non presente nel piano approvato:
> vedi [notes.md](notes.md#task-12).

**Files:**
- Crea: lo schema (`openapi.yaml`), la pagina di lettura, `test/print-openapi.test.js`
- Modifica: `src/print/route.js` (la validazione usa lo schema), `src/server.js`
  (serve lo schema), `docs/howto/stampa-mappe.md` (rimanda allo schema)

**Interfaces:**
- Consuma: `parseRequest` e i tetti del Task 9, la finta del Task 11 (resta in parita')

- [ ] **Step 1: scrivere lo schema con i valori veri di oggi**

Corpo 2 MiB, dpi 72-600, `maxZoom` 0-19, `stroke-width` fino a 40, `set` 12 esadecimali,
formati `a4`/`a5`, orientamenti `portrait`/`landscape`, `mapInfo` acceso di default.
Risposte 200, 400, 401, 413, 429, 503, 504, con `Retry-After` dove c'e'.

- [ ] **Step 2: far validare la rotta contro lo schema**

Ajv con versione esatta. **I messaggi di Ajv non arrivano mai al chiamante**: contengono
i valori ricevuti, e [R11](overview.md#r11) lo vieta. Si traduce l'errore nel percorso
del campo e basta.

- [ ] **Step 3: verificare che i 43 test della rotta passino senza modifiche**

Run: `npm test -- print-route`
Atteso: PASS. Ogni test che si e' dovuto cambiare va motivato in notes.md: un test
cambiato per far passare il codice nuovo e' una garanzia persa.

- [ ] **Step 4: servire lo schema e la pagina di lettura**

Nessuna dipendenza in piu' nel runtime per la UI: Redoc o Swagger UI da CDN.

- [ ] **Step 5: un test che fallisca se schema e comportamento divergono**

- [ ] **Step 6: commit**

```bash
git add openapi.yaml src/print/route.js src/server.js test/print-openapi.test.js docs/howto/stampa-mappe.md
git commit -m "feat(oc:9011): lo schema OpenAPI e' la fonte della validazione"
```
