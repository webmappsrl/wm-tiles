# Revisione delle tile — piano di implementazione

> **Per chi esegue:** sotto-skill richiesta: superpowers:subagent-driven-development
> (consigliata) o superpowers:executing-plans. I passi usano le caselle
> (`- [ ]`) per tenere il conto.

**Obiettivo:** un comando che confronta con TGen tutte le tile fino a z8 e un
campione stratificato da z9 a z16, classifica da solo cio' che si misura e
documenta con un dossier ogni difformita' che deve giudicare l'AI.

**Architettura:** moduli puri in `src/revisione/` (campione, maschere, misure,
aggregazione, registro, report), ciascuno testato da solo con vitest; un
orchestratore `tools/revisione.mjs` che li collega al server locale, a
`render-png.mjs` e alla cache di TGen; un registro dei verdetti nel repo.

**Tecnologie:** Node 18 (ESM), sharp, `@mapbox/vector-tile` + `pbf`,
`@maplibre/maplibre-gl-style-spec` (`featureFilter`,
`createPropertyExpression`), vitest.

**Spec:** [`overview.md`](overview.md)

## Vincoli globali

- Commenti, messaggi e nomi in italiano, come il resto del repo.
- **Nessun commit per task**: un solo commit a lavoro concluso, e solo dopo
  l'ok esplicito dell'utente (CLAUDE.md, regola 4).
- Il server locale deve essere acceso (`npm start`) per l'orchestratore; i
  moduli di `src/revisione/` non lo richiedono.
- Il riferimento si ferma a z16: l'orchestratore rifiuta `--zoom` oltre 16.
- I PNG locali si fanno con `pipeline/render-png.mjs` (maplibre-native), in
  `<out>/<z>/<x>/<y>.png`.
- Lo stile di `/style.json` ha le soglie di zoom gia' scalate di un livello
  (`scalaZoom`): le espressioni per la vista zN si valutano a `zoom: N - 1`.
- La visibilita' per livello si legge da `style/zoom-profile.json >
  levels[z].visible`, non da `minzoom`/`maxzoom` dello stile.
- Oltre il `maxzoom` di una sorgente la tile vettoriale e' quella del maxzoom,
  ingrandita: le maschere vanno ritagliate dal genitore.
- TGen e' sola lettura: si legge solo `https://api.webmapp.it/tiles` via HTTP.

## Punti da sorvegliare in review

1. **Tile coperte solo in parte dai dati locali** (Mac, z8 su una cella di 1
   grado): devono finire negli scarti con il motivo, mai misurate. Test in
   Task 1.
2. **Etichette disposte diversamente dai due motori**: non devono riempire il
   residuo. Le zone attorno alle nostre feature di layer `symbol` sono escluse
   dal residuo e dalla misura per classe. Test in Task 3.
3. **Livelli oltre il maxzoom della sorgente** (z15-z16 con `openmaptiles` a
   z14): le maschere devono coincidere con il disegno, non con l'angolo
   in alto a sinistra della tile genitore. Test in Task 2.
4. **Tile che TGen non ha** (404) e tile senza PNG locale: si contano, non
   rompono il giro. Test in Task 6 (orchestratore, prova vera).
5. **Verdetto vecchio su misure cambiate**: un `contenuto` di ieri non deve
   nascondere un difetto di oggi. Test in Task 5.

---

### Task 1: campione e copertura

**File:**
- Crea: `src/revisione/campione.js`
- Test: `test/revisione-campione.test.js`

**Interfacce:**
- Usa: `tileInBbox(bbox, z)` da `src/raster/tiles.js`
- Produce:
  - `limiti({z,x,y}) -> [w,s,e,n]` in gradi
  - `cellaDi({z,x,y}) -> 'lon,lat'` (angolo SO della cella di un grado che
    contiene il centro della tile)
  - `campiona(universo: {z,x,y}[], {perLivello: number, seed: number, tutteFino = 8}) -> {z,x,y}[]`
    ordinato per z, x, y
  - `coperta(t, riquadri: [w,s,e,n][] | null) -> boolean` (`null`: nessun
    limite noto, tutto coperto)
  - `fascia(z) -> '2018' | '2025'`

- [ ] **Passo 1: test che falliscono**

```js
// test/revisione-campione.test.js
import {describe, expect, it} from 'vitest';
import {campiona, cellaDi, coperta, fascia, limiti} from '../src/revisione/campione.js';
import {tileInBbox} from '../src/raster/tiles.js';

/**
 * Il campione decide quali tile si guardano: se e' instabile due giri non si
 * confrontano, se esclude un livello quel livello non lo controlla nessuno.
 */
const universo = [];
// bbox interno alle quattro celle: le tile di bordo non sconfinano in una quinta
for (let z = 6; z <= 12; z++) universo.push(...tileInBbox([10.1, 43.1, 11.9, 44.9], z));

describe('campiona', () => {
  it('prende tutte le tile fino a tutteFino', () => {
    const c = campiona(universo, {perLivello: 5, seed: 1});
    for (const z of [6, 7, 8]) {
      expect(c.filter(t => t.z === z).length).toBe(universo.filter(t => t.z === z).length);
    }
  });
  it('sopra, perLivello tile per livello', () => {
    const c = campiona(universo, {perLivello: 5, seed: 1});
    for (const z of [9, 10, 11, 12]) expect(c.filter(t => t.z === z).length).toBe(5);
  });
  it('stesso seed, stesso campione; seed diverso, campione diverso', () => {
    const a = campiona(universo, {perLivello: 8, seed: 1});
    expect(campiona(universo, {perLivello: 8, seed: 1})).toEqual(a);
    expect(campiona(universo, {perLivello: 8, seed: 2})).not.toEqual(a);
  });
  it('ripartisce fra le celle di un grado', () => {
    const c = campiona(universo, {perLivello: 8, seed: 3}).filter(t => t.z === 12);
    expect(new Set(c.map(cellaDi)).size).toBe(4); // bbox di 2x2 gradi
  });
});

describe('coperta', () => {
  it('vuole la tile intera dentro un riquadro', () => {
    const dentro = tileInBbox([10.4, 43.4, 10.5, 43.5], 12)[0];
    expect(coperta(dentro, [[10, 43, 11, 44]])).toBe(true);
    // una z8 e' larga 1,4 gradi: in una cella di 1 grado non entra mai
    const z8 = tileInBbox([10.5, 43.5, 10.5, 43.5], 8)[0];
    expect(coperta(z8, [[10, 43, 11, 44]])).toBe(false);
  });
  it('senza riquadri tutto e\' coperto', () => {
    expect(coperta({z: 5, x: 17, y: 11}, null)).toBe(true);
  });
});

describe('limiti e fascia', () => {
  it('limiti della tile 0/0/0', () => {
    const [w, s, e, n] = limiti({z: 0, x: 0, y: 0});
    expect(w).toBe(-180); expect(e).toBe(180);
    expect(n).toBeCloseTo(85.0511, 3); expect(s).toBeCloseTo(-85.0511, 3);
  });
  it('fascia: 2018 fino a z12, 2025 da z13', () => {
    expect(fascia(12)).toBe('2018');
    expect(fascia(13)).toBe('2025');
  });
});
```

- [ ] **Passo 2: verifica che fallisca**

Esegui: `npm test -- revisione-campione`
Atteso: FAIL, "Failed to load url ../src/revisione/campione.js"

- [ ] **Passo 3: implementazione**

```js
// src/revisione/campione.js
/**
 * Quali tile guarda la revisione.
 *
 * Fino a z8 l'Italia ha poche centinaia di tile e si prendono tutte; sopra
 * diventano migliaia e si campiona, ripartendo il campione fra le celle di un
 * grado (le stesse di `grid_1x1` di TGen), cosi' nessuna zona resta fuori. Il
 * seed fisso rende il campione ripetibile: due giri si confrontano tile per
 * tile.
 */

const lon = (x, k) => (x / k) * 360 - 180;
const lat = (y, k) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / k))) * 180) / Math.PI;

export function limiti({z, x, y}) {
  const k = 2 ** z;
  return [lon(x, k), lat(y + 1, k), lon(x + 1, k), lat(y, k)];
}

export function cellaDi(t) {
  const [w, s, e, n] = limiti(t);
  return `${Math.floor((w + e) / 2)},${Math.floor((s + n) / 2)}`;
}

/** mulberry32: piccolo, deterministico, sufficiente per un campione. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mescola(arr, r) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function campiona(universo, {perLivello, seed, tutteFino = 8}) {
  const r = rng(seed);
  const perZ = new Map();
  for (const t of universo) {
    if (!perZ.has(t.z)) perZ.set(t.z, []);
    perZ.get(t.z).push(t);
  }
  const out = [];
  for (const [z, tiles] of [...perZ].sort((a, b) => a[0] - b[0])) {
    if (z <= tutteFino) { out.push(...tiles); continue; }
    // ordine stabile prima di mescolare: l'universo puo' arrivare in ordini diversi
    const ordinate = [...tiles].sort((a, b) => a.x - b.x || a.y - b.y);
    const celle = new Map();
    for (const t of ordinate) {
      const c = cellaDi(t);
      if (!celle.has(c)) celle.set(c, []);
      celle.get(c).push(t);
    }
    const code = mescola([...celle.keys()].sort(), r).map(c => mescola(celle.get(c), r));
    // a giro sulle celle, una tile per cella, finche' non si arriva a perLivello
    const presi = [];
    while (presi.length < perLivello && code.some(c => c.length)) {
      for (const c of code) {
        if (c.length && presi.length < perLivello) presi.push(c.shift());
      }
    }
    out.push(...presi);
  }
  return out.sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y);
}

export function coperta(t, riquadri) {
  if (!riquadri) return true;
  const [w, s, e, n] = limiti(t);
  return riquadri.some(([rw, rs, re, rn]) => w >= rw && e <= re && s >= rs && n <= rn);
}

/** I PNG di TGen fino a z12 sono del 2018, da z13 del 2025: due stili. */
export const fascia = z => (z <= 12 ? '2018' : '2025');
```

- [ ] **Passo 4: verifica che passi**

Esegui: `npm test -- revisione-campione`
Atteso: PASS (8 test)

---

### Task 2: maschere dalle tile vettoriali

**File:**
- Crea: `src/revisione/maschere.js`
- Test: `test/revisione-maschere.test.js`

**Interfacce:**
- Usa: `featureFilter`, `createPropertyExpression`, `latest` da
  `@maplibre/maplibre-gl-style-spec`
- Produce:
  - `tileSorgente({z,x,y}, maxzoom) -> {z, x, y, k, ox, oy}`: la tile da
    chiedere alla sorgente; `k` ingrandimento, `ox`/`oy` posizione della
    tile richiesta dentro il genitore, in unita' di tile
  - `percorso(geometria, extent, {k, ox, oy}, chiuso) -> string` (path SVG
    in pixel 0-256)
  - `rasterizza(percorsi: string[], {tipo: 'pieno'|'tratto', larghezza}) -> Promise<Uint8Array>`
    (65536 valori 0/1)
  - `punto(q, extent, {k, ox, oy}) -> [x, y]` in pixel 0-256
  - `rasterizzaCerchi(centri: [x,y][], raggio) -> Promise<Uint8Array>`
  - `valuta(layer, proprieta, z, feature?) -> number|undefined` (valuta
    `paint`/`layout` a `zoom: z - 1`)
  - `maschereTile(tile, {layers, tileVettoriale}) -> Promise<{maschere: {id, tipo, data}[], etichette: Uint8Array}>`
    dove `layers` sono i layer di stile visibili a quel livello e
    `tileVettoriale(sourceId) -> Promise<{vt: VectorTile, sorgente} | null>`

- [ ] **Passo 1: test che falliscono**

```js
// test/revisione-maschere.test.js
import {describe, expect, it} from 'vitest';
import {maschereTile, percorso, rasterizza, tileSorgente, valuta} from '../src/revisione/maschere.js';

const somma = a => a.reduce((s, v) => s + v, 0);

/** Una tile vettoriale finta: quanto basta a maschereTile. */
const vtFinta = layers => ({layers: Object.fromEntries(Object.entries(layers).map(([nome, feats]) => [nome, {
  extent: 4096, length: feats.length,
  feature: i => ({type: feats[i].type, properties: feats[i].properties, loadGeometry: () => feats[i].geom}),
}]))});
const quadrato = (x0, y0, x1, y1) => [[{x: x0, y: y0}, {x: x1, y: y0}, {x: x1, y: y1}, {x: x0, y: y1}, {x: x0, y: y0}]];

describe('tileSorgente', () => {
  it('sotto il maxzoom e\' la tile stessa', () => {
    expect(tileSorgente({z: 12, x: 5, y: 7}, 14)).toEqual({z: 12, x: 5, y: 7, k: 1, ox: 0, oy: 0});
  });
  it('oltre il maxzoom e\' il genitore, con la posizione dentro di esso', () => {
    expect(tileSorgente({z: 16, x: 34639, y: 23768}, 14))
      .toEqual({z: 14, x: 8659, y: 5942, k: 4, ox: 3, oy: 0});
  });
});

describe('rasterizza', () => {
  it('un quadrato pieno di meta\' lato copre un quarto della tile', async () => {
    const d = percorso(quadrato(0, 0, 2048, 2048), 4096, {k: 1, ox: 0, oy: 0}, true);
    const m = await rasterizza([d], {tipo: 'pieno'});
    expect(somma(m) / 65536).toBeCloseTo(0.25, 2);
  });
  it('oltre il maxzoom ritaglia il quarto giusto del genitore', async () => {
    // quadrato nel quarto in basso a destra del genitore; la figlia (ox 1, oy 1) e' tutta piena
    const d = percorso(quadrato(2048, 2048, 4096, 4096), 4096, {k: 2, ox: 1, oy: 1}, true);
    const m = await rasterizza([d], {tipo: 'pieno'});
    expect(somma(m) / 65536).toBeGreaterThan(0.98);
    const vuota = percorso(quadrato(2048, 2048, 4096, 4096), 4096, {k: 2, ox: 0, oy: 0}, true);
    expect(somma(await rasterizza([vuota], {tipo: 'pieno'}))).toBe(0);
  });
});

describe('valuta', () => {
  it('valuta a zoom - 1, come ol-mapbox-style', () => {
    const layer = {type: 'line', paint: {'line-width': ['step', ['zoom'], 1, 12, 4]}};
    expect(valuta(layer, 'line-width', 12)).toBe(1);
    expect(valuta(layer, 'line-width', 13)).toBe(4);
  });
});

describe('maschereTile', () => {
  const vt = vtFinta({
    landcover: [{type: 3, properties: {class: 'wood'}, geom: quadrato(0, 0, 4096, 4096)}],
    place: [{type: 1, properties: {name: 'Agliano'}, geom: [[{x: 2048, y: 2048}]]}],
  });
  const layers = [
    {id: 'bosco', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['==', ['get', 'class'], 'wood']},
    {id: 'prati', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['==', ['get', 'class'], 'grass']},
    {id: 'paesi', type: 'symbol', source: 'omt', 'source-layer': 'place'},
  ];
  const tileVettoriale = async () => ({vt, sorgente: {maxzoom: 14}});

  it('applica il filtro del layer', async () => {
    const {maschere} = await maschereTile({z: 12, x: 0, y: 0}, {layers, tileVettoriale});
    expect(maschere.map(m => m.id)).toEqual(['bosco']); // prati: nessuna feature
    expect(somma(maschere[0].data)).toBe(65536);
  });
  it('i layer symbol diventano zone etichetta, non maschere', async () => {
    const {maschere, etichette} = await maschereTile({z: 12, x: 0, y: 0}, {layers, tileVettoriale});
    expect(maschere.find(m => m.id === 'paesi')).toBeUndefined();
    expect(etichette[128 * 256 + 128]).toBe(1);
    expect(etichette[0]).toBe(0);
  });
  it('oltre il maxzoom le zone etichetta seguono il ritaglio', async () => {
    const vt16 = vtFinta({place: [{type: 1, properties: {}, geom: [[{x: 3900, y: 3900}]]}]});
    const tv = async () => ({vt: vt16, sorgente: {maxzoom: 14}});
    const paesi = [layers[2]];
    // il punto e' nel quarto in basso a destra del genitore z14: cade nella figlia 3,3
    const giusta = await maschereTile({z: 16, x: 3, y: 3}, {layers: paesi, tileVettoriale: tv});
    const sbagliata = await maschereTile({z: 16, x: 0, y: 0}, {layers: paesi, tileVettoriale: tv});
    expect(somma(giusta.etichette)).toBeGreaterThan(0);
    expect(somma(sbagliata.etichette)).toBe(0);
  });
});
```

- [ ] **Passo 2: verifica che fallisca**

Esegui: `npm test -- revisione-maschere`
Atteso: FAIL, modulo inesistente

- [ ] **Passo 3: implementazione**

```js
// src/revisione/maschere.js
/**
 * Maschere delle nostre geometrie, layer di stile per layer di stile.
 *
 * E' il metodo di colore-per-classe.mjs reso generale: le geometrie della
 * tile vettoriale filtrate come le filtra lo stile, rasterizzate a 256 px.
 * Sotto una maschera si confrontano i colori di TGen e locali: il colore
 * giusto si misura sull'insieme giusto di geometrie.
 *
 * I layer `symbol` non danno maschere: il punto in cui un motore mette
 * un'etichetta non e' stile (Mapnik e OpenLayers la piazzano in posti
 * diversi). Danno invece ZONE ETICHETTA, larghe, che la misura esclude dal
 * residuo: senza, ogni nome spostato di qualche pixel sembrerebbe un oggetto
 * mancante.
 */
import sharp from 'sharp';
import {createPropertyExpression, featureFilter, latest} from '@maplibre/maplibre-gl-style-spec';

const LATO = 256;
// raggio della zona etichetta attorno a un punto e larghezza lungo una linea:
// un toponimo di TGen a z13 e' lungo 60-120 px, alto 12-16
const ZONA_PUNTO = 48;
const ZONA_LINEA = 24;
// sotto i 2 px una linea rasterizzata perde pixel e la mediana diventa rumore
const LARGHEZZA_MIN = 2;

export function tileSorgente({z, x, y}, maxzoom) {
  if (z <= maxzoom) return {z, x, y, k: 1, ox: 0, oy: 0};
  const k = 2 ** (z - maxzoom);
  const px = Math.floor(x / k), py = Math.floor(y / k);
  return {z: maxzoom, x: px, y: py, k, ox: x - px * k, oy: y - py * k};
}

export function percorso(geometria, extent, {k, ox, oy}, chiuso) {
  const s = (LATO * k) / extent;
  return geometria.map(anello => 'M' + anello
    .map(q => `${(q.x * s - ox * LATO).toFixed(1)},${(q.y * s - oy * LATO).toFixed(1)}`)
    .join('L') + (chiuso ? 'Z' : '')).join(' ');
}

export function punto(q, extent, {k, ox, oy}) {
  const s = (LATO * k) / extent;
  return [q.x * s - ox * LATO, q.y * s - oy * LATO];
}

const binaria = async svg => {
  const g = await sharp(Buffer.from(svg)).greyscale().raw().toBuffer();
  const out = new Uint8Array(LATO * LATO);
  for (let i = 0; i < out.length; i++) out[i] = g[i] > 128 ? 1 : 0;
  return out;
};

/** I punti come cerchi: un tratto di lunghezza nulla non si disegna con certezza. */
export function rasterizzaCerchi(centri, raggio) {
  return binaria(`<svg xmlns="http://www.w3.org/2000/svg" width="${LATO}" height="${LATO}">`
    + centri.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${raggio}" fill="#fff"/>`).join('')
    + '</svg>');
}

export async function rasterizza(percorsi, {tipo, larghezza = 1}) {
  const stile = tipo === 'pieno'
    ? 'fill="#fff" fill-rule="evenodd" stroke="none"'
    : `fill="none" stroke="#fff" stroke-width="${larghezza}" stroke-linecap="round" stroke-linejoin="round"`;
  return binaria(`<svg xmlns="http://www.w3.org/2000/svg" width="${LATO}" height="${LATO}">`
    + `<path d="${percorsi.join(' ')}" ${stile} shape-rendering="crispEdges"/></svg>`);
}

/** Le soglie di zoom di /style.json sono gia' scalate di uno: si valuta a z - 1. */
export function valuta(layer, prop, z, feature = {properties: {}}) {
  const gruppo = prop in (layer.paint ?? {}) ? 'paint' : 'layout';
  const valore = layer[gruppo]?.[prop];
  if (valore === undefined) return undefined;
  const spec = latest[`${gruppo}_${layer.type}`]?.[prop];
  const e = createPropertyExpression(valore, `${layer.id}.${prop}`, spec);
  if (e.result !== 'success') return undefined;
  return e.value.evaluate({zoom: z - 1}, feature);
}

const MISURABILI = new Set(['fill', 'line', 'circle']);

export async function maschereTile(tile, {layers, tileVettoriale}) {
  const maschere = [];
  const zonePunto = [], zoneLinea = [];
  for (const layer of layers) {
    if (layer.type === 'background') {
      maschere.push({id: layer.id, tipo: 'sfondo', data: new Uint8Array(LATO * LATO).fill(1)});
      continue;
    }
    if (!MISURABILI.has(layer.type) && layer.type !== 'symbol') continue;
    const t = await tileVettoriale(layer.source, tile);
    const l = t?.vt.layers[layer['source-layer']];
    if (!l) continue;
    const pos = tileSorgente(tile, t.sorgente.maxzoom ?? 14);
    const filtro = featureFilter(layer.filter, `${layer.id}.filter`);
    const poligoni = [], linee = [], cerchi = [];
    let larghezza = 0, raggio = 0;
    for (let i = 0; i < l.length; i++) {
      const f = l.feature(i);
      if (!filtro.filter({zoom: tile.z - 1}, f)) continue;
      const geom = f.loadGeometry();
      if (layer.type === 'symbol') {
        if (f.type === 1) zonePunto.push(...geom.flat().map(q => punto(q, l.extent, pos)));
        else zoneLinea.push(percorso(geom, l.extent, pos, false));
        continue;
      }
      if (layer.type === 'circle') {
        raggio = Math.max(raggio, valuta(layer, 'circle-radius', tile.z, f) ?? 5);
        cerchi.push(...geom.flat().map(q => punto(q, l.extent, pos)));
      } else if (layer.type === 'fill' && f.type === 3) {
        poligoni.push(percorso(geom, l.extent, pos, true));
      } else if (layer.type === 'line') {
        larghezza = Math.max(larghezza, valuta(layer, 'line-width', tile.z, f) ?? 1);
        linee.push(percorso(geom, l.extent, pos, f.type === 3));
      }
    }
    if (!poligoni.length && !linee.length && !cerchi.length) continue;
    const data = poligoni.length ? await rasterizza(poligoni, {tipo: 'pieno'})
      : cerchi.length ? await rasterizzaCerchi(cerchi, Math.max(LARGHEZZA_MIN / 2, raggio))
        : await rasterizza(linee, {tipo: 'tratto', larghezza: Math.max(LARGHEZZA_MIN, larghezza)});
    maschere.push({id: layer.id, tipo: layer.type, data});
  }
  const etichette = new Uint8Array(LATO * LATO);
  if (zonePunto.length || zoneLinea.length) {
    const punti = zonePunto.length ? await rasterizzaCerchi(zonePunto, ZONA_PUNTO) : etichette;
    const lungo = zoneLinea.length ? await rasterizza(zoneLinea, {tipo: 'tratto', larghezza: ZONA_LINEA}) : etichette;
    for (let i = 0; i < etichette.length; i++) etichette[i] = punti[i] | lungo[i];
  }
  return {maschere, etichette};
}
```

- [ ] **Passo 4: verifica che passi**

Esegui: `npm test -- revisione-maschere`
Atteso: PASS

---

### Task 3: misure per tile

**File:**
- Crea: `src/revisione/misure.js`
- Test: `test/revisione-misure.test.js`

**Interfacce:**
- Usa: l'uscita di `maschereTile` (Task 2)
- Produce:
  - `lab([r,g,b]) -> [L,a,b]`, `deltaE(rgb1, rgb2) -> number` (CIE76)
  - `quantizza([r,g,b]) -> '#rrggbb'` (classi da 32 per canale, centro della
    classe)
  - `regioni(bin: Uint8Array) -> {n, bbox:[x0,y0,x1,y1], pixel:number[]}[]`
    (componenti connesse a 4)
  - `misuraTile({tgen, locale, maschere, etichette}) -> {classi, residuo}`
    con `tgen`/`locale` Buffer RGB 256x256x3,
    `classi[id] = {n, tgen:[r,g,b], locale:[r,g,b], dE, presenza}`,
    `residuo = [{colore, n, bbox}]`
  - `SOGLIE` (oggetto esportato, unico posto delle soglie)

- [ ] **Passo 1: test che falliscono**

```js
// test/revisione-misure.test.js
import {describe, expect, it} from 'vitest';
import {deltaE, misuraTile, quantizza, regioni} from '../src/revisione/misure.js';

const N = 256 * 256;
const tinta = ([r, g, b]) => { const a = Buffer.alloc(N * 3); for (let i = 0; i < N; i++) a.set([r, g, b], 3 * i); return a; };
const dipingi = (buf, [r, g, b], x0, y0, x1, y1) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) buf.set([r, g, b], 3 * (y * 256 + x));
};
const maschera = (x0, y0, x1, y1) => {
  const m = new Uint8Array(N);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * 256 + x] = 1;
  return m;
};
const tutto = () => new Uint8Array(N).fill(1);
const niente = () => new Uint8Array(N);

describe('colore', () => {
  it('deltaE nullo fra colori uguali, grande fra bianco e nero', () => {
    expect(deltaE([10, 20, 30], [10, 20, 30])).toBe(0);
    expect(deltaE([255, 255, 255], [0, 0, 0])).toBeCloseTo(100, 0);
  });
  it('quantizza al centro della classe', () => {
    expect(quantizza([0, 31, 255])).toBe('#1010f0');
  });
});

describe('regioni', () => {
  it('separa due blocchi staccati', () => {
    const b = niente();
    for (const [x0, y0] of [[0, 0], [100, 100]]) for (let y = y0; y < y0 + 5; y++) for (let x = x0; x < x0 + 5; x++) b[y * 256 + x] = 1;
    const r = regioni(b);
    expect(r.length).toBe(2);
    expect(r.map(q => q.n)).toEqual([25, 25]);
    expect(r[1].bbox).toEqual([100, 100, 104, 104]);
  });
});

describe('misuraTile', () => {
  it('un layer col colore sbagliato da\' il suo scarto', () => {
    const tgen = tinta([200, 220, 180]), locale = tinta([200, 220, 180]);
    dipingi(tgen, [80, 140, 60], 0, 0, 128, 256);
    dipingi(locale, [100, 160, 80], 0, 0, 128, 256);
    const {classi} = misuraTile({tgen, locale, etichette: niente(), maschere: [
      {id: 'sfondo', tipo: 'sfondo', data: tutto()}, {id: 'bosco', tipo: 'fill', data: maschera(0, 0, 128, 256)},
    ]});
    expect(classi.bosco.tgen).toEqual([80, 140, 60]);
    expect(classi.bosco.locale).toEqual([100, 160, 80]);
    expect(classi.bosco.dE).toBeCloseTo(deltaE([80, 140, 60], [100, 160, 80]), 5);
    expect(classi.sfondo.dE).toBe(0); // misurato solo dove nessun altro layer copre
  });
  it('un oggetto disegnato solo da TGen finisce nel residuo', () => {
    const tgen = tinta([240, 240, 240]), locale = tinta([240, 240, 240]);
    dipingi(tgen, [40, 40, 40], 50, 50, 70, 54); // una ferrovia che non abbiamo
    const {residuo} = misuraTile({tgen, locale, etichette: niente(), maschere: [{id: 'sfondo', tipo: 'sfondo', data: tutto()}]});
    expect(residuo).toHaveLength(1);
    expect(residuo[0]).toMatchObject({colore: '#303030', n: 80, bbox: [50, 50, 69, 53]});
  });
  it('vicino a una nostra geometria non c\'e\' residuo: e\' presenza del layer', () => {
    const tgen = tinta([240, 240, 240]), locale = tinta([240, 240, 240]);
    dipingi(tgen, [40, 40, 40], 50, 50, 70, 54);
    const {residuo, classi} = misuraTile({tgen, locale, etichette: niente(), maschere: [
      {id: 'sfondo', tipo: 'sfondo', data: tutto()}, {id: 'strada', tipo: 'line', data: maschera(50, 50, 70, 54)},
    ]});
    expect(residuo).toHaveLength(0);
    expect(classi.strada.presenza).toBe(1);
  });
  it('un\'etichetta in posizione diversa non sporca residuo e classi', () => {
    const tgen = tinta([200, 220, 180]), locale = tinta([200, 220, 180]);
    dipingi(tgen, [0, 0, 0], 100, 100, 160, 112);   // il nome di TGen
    dipingi(locale, [0, 0, 0], 110, 120, 170, 132); // lo stesso nome, piu' in basso
    const {residuo, classi} = misuraTile({tgen, locale, etichette: maschera(80, 80, 190, 150), maschere: [
      {id: 'prato', tipo: 'fill', data: tutto()},
    ]});
    expect(residuo).toHaveLength(0);
    expect(classi.prato.dE).toBe(0);
  });
});
```

- [ ] **Passo 2: verifica che fallisca**

Esegui: `npm test -- revisione-misure`
Atteso: FAIL, modulo inesistente

- [ ] **Passo 3: implementazione**

```js
// src/revisione/misure.js
/**
 * Le misure di una tile: colore per classe sotto le nostre maschere, e il
 * RESIDUO, cioe' cio' che diverge e che nessuna nostra geometria spiega.
 *
 * Per classe si usano solo i pixel dove il layer e' l'unico (oltre allo
 * sfondo) e fuori dalle zone etichetta: un nome sopra un bosco non deve
 * spostare il colore del bosco. Mediana per canale, come colore-per-classe.
 */

export const SOGLIE = {
  // scarto di colore oltre cui un pixel "diverge": sopra le differenze
  // d'ombra fra i due lati (fino a ~15), sotto quelle fra due oggetti diversi
  divergenza: 30,
  // una regione di residuo piu' piccola e' rumore di antialias
  regioneMin: 25,
  // pixel esclusivi minimi perche' una classe conti in una tile
  pixelClasse: 40,
  // dilatazione delle maschere prima di calcolare il residuo: una linea
  // larga 2 px da noi e 3 da TGen non e' una mancanza
  dilatazione: 2,
};

export function lab([r, g, b]) {
  const lin = c => { c /= 255; return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

export function deltaE(c1, c2) {
  const [a, b] = [lab(c1), lab(c2)];
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export const quantizza = c => '#' + c.map(v => (Math.floor(v / 32) * 32 + 16).toString(16).padStart(2, '0')).join('');

export function regioni(bin) {
  const visto = new Uint8Array(bin.length), out = [];
  for (let i0 = 0; i0 < bin.length; i0++) {
    if (!bin[i0] || visto[i0]) continue;
    const pixel = [], pila = [i0];
    visto[i0] = 1;
    let [x0, y0, x1, y1] = [256, 256, -1, -1];
    while (pila.length) {
      const i = pila.pop(), x = i % 256, y = (i / 256) | 0;
      pixel.push(i);
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      for (const j of [x > 0 ? i - 1 : -1, x < 255 ? i + 1 : -1, y > 0 ? i - 256 : -1, y < 255 ? i + 256 : -1]) {
        if (j >= 0 && bin[j] && !visto[j]) { visto[j] = 1; pila.push(j); }
      }
    }
    out.push({n: pixel.length, bbox: [x0, y0, x1, y1], pixel});
  }
  return out;
}

function dilata(m, r) {
  if (!r) return m;
  const out = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) {
    if (!m[i]) continue;
    const x = i % 256, y = (i / 256) | 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < 256 && yy < 256) out[yy * 256 + xx] = 1;
    }
  }
  return out;
}

const px = (buf, i) => [buf[3 * i], buf[3 * i + 1], buf[3 * i + 2]];
const mediana = arr => [0, 1, 2].map(k => arr.map(c => c[k]).sort((a, b) => a - b)[arr.length >> 1]);

export function misuraTile({tgen, locale, maschere, etichette}) {
  const N = 256 * 256;
  const copertura = new Uint8Array(N);
  for (const m of maschere) if (m.tipo !== 'sfondo') for (let i = 0; i < N; i++) copertura[i] += m.data[i];
  const diverge = new Uint8Array(N);
  for (let i = 0; i < N; i++) diverge[i] = deltaE(px(tgen, i), px(locale, i)) > SOGLIE.divergenza ? 1 : 0;

  const classi = {};
  for (const m of maschere) {
    const t = [], l = [];
    let nMask = 0, nDiv = 0;
    for (let i = 0; i < N; i++) {
      if (!m.data[i]) continue;
      if (m.tipo !== 'sfondo') { nMask++; nDiv += diverge[i]; }
      const esclusivo = m.tipo === 'sfondo' ? copertura[i] === 0 : copertura[i] === 1;
      if (!esclusivo || etichette[i]) continue;
      t.push(px(tgen, i)); l.push(px(locale, i));
    }
    if (t.length < SOGLIE.pixelClasse) continue;
    const mt = mediana(t), ml = mediana(l);
    classi[m.id] = {n: t.length, tgen: mt, locale: ml, dE: deltaE(mt, ml), presenza: nMask ? nDiv / nMask : 0};
  }

  // il residuo: diverge, e nessuna maschera (dilatata) ne' zona etichetta lo spiega
  const spiegato = dilata(copertura.map(v => (v ? 1 : 0)), SOGLIE.dilatazione);
  const bin = new Uint8Array(N);
  for (let i = 0; i < N; i++) bin[i] = diverge[i] && !spiegato[i] && !etichette[i] ? 1 : 0;
  const residuo = regioni(bin)
    .filter(r => r.n >= SOGLIE.regioneMin)
    .map(r => ({colore: quantizza(mediana(r.pixel.map(i => px(tgen, i)))), n: r.n, bbox: r.bbox}));
  return {classi, residuo};
}
```

- [ ] **Passo 4: verifica che passi**

Esegui: `npm test -- revisione-misure`
Atteso: PASS. Se `deltaE` bianco/nero non da' 100 entro 0,5, controlla la
matrice sRGB->XYZ prima di toccare il test.

---

### Task 4: aggregazione, classificazione, regressioni

**File:**
- Crea: `src/revisione/aggrega.js`
- Test: `test/revisione-aggrega.test.js`

**Interfacce:**
- Usa: i risultati per tile `{tile:'z/x/y', z, classi, residuo}` (Task 3)
- Produce:
  - `aggrega(risultati) -> {tabella, difformita}`:
    `tabella[z][layer] = {dE, presenza, nTile, esito: 'conforme'|'stile'|'presenza'|'sparso'}`,
    `difformita = [{id, z, tipo, layer?, colore?, misure: {dE?, presenza?, diffusione, nTile}, esempi: [{tile, bbox?}]}]`
  - `regressioni(tabella, tabellaPrima) -> difformita[]` di tipo `regressione`
  - `CRITERI` (soglie dell'aggregazione)

- [ ] **Passo 1: test che falliscono**

```js
// test/revisione-aggrega.test.js
import {describe, expect, it} from 'vitest';
import {aggrega, regressioni} from '../src/revisione/aggrega.js';

const r = (tile, classi, residuo = []) => ({tile, z: Number(tile.split('/')[0]), classi, residuo});
const c = (dE, presenza = 0) => ({n: 500, tgen: [0, 0, 0], locale: [0, 0, 0], dE, presenza});

describe('aggrega', () => {
  it('scarto sistematico: stile; scarto su una tile sola: sparso', () => {
    const ris = [
      r('13/1/1', {bosco: c(14), strada: c(2)}),
      r('13/1/2', {bosco: c(12), strada: c(15)}),
      r('13/1/3', {bosco: c(13), strada: c(1)}),
      r('13/1/4', {bosco: c(15), strada: c(2)}),
    ];
    const {tabella, difformita} = aggrega(ris);
    expect(tabella[13].bosco.esito).toBe('stile');
    expect(tabella[13].strada.esito).toBe('sparso');
    expect(difformita.map(d => d.id)).toEqual(['z13:bosco:stile']);
    expect(difformita[0].esempi[0].tile).toBe('13/1/4'); // il peggiore per primo
  });
  it('residuo dello stesso colore su molte tile: sistematico', () => {
    const ris = Array.from({length: 10}, (_, i) => r(`14/1/${i}`, {}, i < 4 ? [{colore: '#303030', n: 90, bbox: [1, 1, 9, 9]}] : []));
    const {difformita} = aggrega(ris);
    expect(difformita).toHaveLength(1);
    expect(difformita[0]).toMatchObject({id: 'z14:residuo:#303030', tipo: 'residuo'});
    expect(difformita[0].misure.diffusione).toBeCloseTo(0.4);
  });
  it('residuo su una tile su dieci non basta', () => {
    const ris = Array.from({length: 20}, (_, i) => r(`14/1/${i}`, {}, i < 1 ? [{colore: '#303030', n: 90, bbox: [1, 1, 9, 9]}] : []));
    expect(aggrega(ris).difformita).toHaveLength(0);
  });
  it('presenza alta e sistematica: il layer e\' disegnato solo da noi o in altro modo', () => {
    const ris = Array.from({length: 4}, (_, i) => r(`15/1/${i}`, {sentieri: c(3, 0.9)}));
    expect(aggrega(ris).difformita[0]).toMatchObject({id: 'z15:sentieri:presenza', tipo: 'presenza'});
  });
});

describe('regressioni', () => {
  it('segnala un layer peggiorato oltre tolleranza, non uno migliorato', () => {
    const prima = {12: {bosco: {dE: 3}, strada: {dE: 9}}};
    const ora = {12: {bosco: {dE: 8}, strada: {dE: 4}}};
    const reg = regressioni(ora, prima);
    expect(reg.map(d => d.id)).toEqual(['z12:bosco:regressione']);
  });
});
```

- [ ] **Passo 2: verifica che fallisca**

Esegui: `npm test -- revisione-aggrega`
Atteso: FAIL, modulo inesistente

- [ ] **Passo 3: implementazione**

```js
// src/revisione/aggrega.js
/**
 * Da molte tile a poche difformita'. Lo stile e' sistematico, il contenuto
 * sparso: uno scarto che si ripete sulla maggioranza delle tile in cui un
 * layer compare e' stile; uno su una tile sola e' probabilmente OSM cambiato,
 * e resta nella tabella senza diventare una difformita'.
 */

export const CRITERI = {
  dE: 8,              // scarto di classe oltre cui una tile "non torna"
  presenza: 0.6,      // quota di pixel della maschera che divergono
  maggioranza: 0.5,   // quota delle tile del layer che deve non tornare
  tileMin: 3,         // sotto, nessuna conclusione sistematica
  residuo: 0.1,       // quota delle tile del livello con lo stesso colore di residuo
  regressione: 3,     // peggioramento di dE fra due giri
  esempi: 3,
};

const med = a => [...a].sort((x, y) => x - y)[a.length >> 1];

export function aggrega(risultati) {
  const tabella = {}, difformita = [];
  const perZ = new Map();
  for (const r of risultati) {
    if (!perZ.has(r.z)) perZ.set(r.z, []);
    perZ.get(r.z).push(r);
  }
  for (const [z, rs] of [...perZ].sort((a, b) => a[0] - b[0])) {
    tabella[z] = {};
    const layer = new Set(rs.flatMap(r => Object.keys(r.classi)));
    for (const id of [...layer].sort()) {
      const casi = rs.filter(r => r.classi[id]).map(r => ({tile: r.tile, ...r.classi[id]}));
      const fuoriDE = casi.filter(q => q.dE > CRITERI.dE);
      const fuoriP = casi.filter(q => q.presenza > CRITERI.presenza);
      const sistematico = f => casi.length >= CRITERI.tileMin && f.length / casi.length > CRITERI.maggioranza;
      const esito = sistematico(fuoriDE) ? 'stile' : sistematico(fuoriP) ? 'presenza'
        : fuoriDE.length || fuoriP.length ? 'sparso' : 'conforme';
      const riga = {dE: med(casi.map(q => q.dE)), presenza: med(casi.map(q => q.presenza)), nTile: casi.length, esito};
      tabella[z][id] = riga;
      if (esito === 'stile' || esito === 'presenza') {
        const chiave = esito === 'stile' ? 'dE' : 'presenza';
        const fuori = esito === 'stile' ? fuoriDE : fuoriP;
        difformita.push({
          id: `z${z}:${id}:${esito}`, z, tipo: esito, layer: id,
          misure: {dE: riga.dE, presenza: riga.presenza, diffusione: fuori.length / casi.length, nTile: casi.length},
          esempi: [...fuori].sort((a, b) => b[chiave] - a[chiave]).slice(0, CRITERI.esempi).map(q => ({tile: q.tile})),
        });
      }
    }
    const perColore = new Map();
    for (const r of rs) for (const q of r.residuo) {
      if (!perColore.has(q.colore)) perColore.set(q.colore, []);
      perColore.get(q.colore).push({tile: r.tile, ...q});
    }
    for (const [colore, casi] of [...perColore].sort()) {
      const tileDistinte = new Set(casi.map(q => q.tile)).size;
      if (tileDistinte < CRITERI.tileMin || tileDistinte / rs.length <= CRITERI.residuo) continue;
      difformita.push({
        id: `z${z}:residuo:${colore}`, z, tipo: 'residuo', colore,
        misure: {diffusione: tileDistinte / rs.length, nTile: rs.length, pixel: casi.reduce((s, q) => s + q.n, 0)},
        esempi: [...casi].sort((a, b) => b.n - a.n).slice(0, CRITERI.esempi).map(q => ({tile: q.tile, bbox: q.bbox})),
      });
    }
  }
  return {tabella, difformita};
}

export function regressioni(tabella, prima) {
  const out = [];
  for (const [z, layer] of Object.entries(tabella)) {
    for (const [id, riga] of Object.entries(layer)) {
      const p = prima?.[z]?.[id];
      if (!p || riga.dE - p.dE <= CRITERI.regressione) continue;
      out.push({
        id: `z${z}:${id}:regressione`, z: Number(z), tipo: 'regressione', layer: id,
        misure: {dE: riga.dE, dEPrima: p.dE, nTile: riga.nTile}, esempi: [],
      });
    }
  }
  return out;
}
```

- [ ] **Passo 4: verifica che passi**

Esegui: `npm test -- revisione-aggrega`
Atteso: PASS (5 test)

---

### Task 5: registro dei verdetti

**File:**
- Crea: `src/revisione/registro.js`, `tools/revisione-verdetto.mjs`,
  `docs/revisione/verdetti.json` (contenuto iniziale `{}`)
- Test: `test/revisione-registro.test.js`

**Interfacce:**
- Usa: le difformita' di Task 4 (`{id, misure}`)
- Produce:
  - `VERDETTI = ['stile', 'contenuto', 'buco-tgen', 'mancanza', 'motore']`
  - `leggi(percorso) -> registro` (`{}` se il file manca)
  - `registra(registro, {id, verdetto, motivo, giro, misure}) -> registro`
    (lancia se il verdetto non e' fra i `VERDETTI`)
  - `stato(difformita, registro) -> 'aperta'|'giudicata'|'riaperta'|'da-correggere'`
  - `bloccante(st) -> boolean` (tutto tranne `giudicata`)

- [ ] **Passo 1: test che falliscono**

```js
// test/revisione-registro.test.js
import {describe, expect, it} from 'vitest';
import {bloccante, registra, stato} from '../src/revisione/registro.js';

const d = (id, misure) => ({id, misure});

describe('registro', () => {
  it('senza verdetto la difformita\' e\' aperta e blocca', () => {
    expect(stato(d('z13:bosco:stile', {dE: 12}), {})).toBe('aperta');
    expect(bloccante('aperta')).toBe(true);
  });
  it('contenuto silenzia finche\' le misure restano quelle', () => {
    const reg = registra({}, {id: 'z14:residuo:#303030', verdetto: 'contenuto', motivo: 'strade nuove in OSM', giro: 'a', misure: {diffusione: 0.2}});
    expect(stato(d('z14:residuo:#303030', {diffusione: 0.25}), reg)).toBe('giudicata');
    expect(bloccante('giudicata')).toBe(false);
  });
  it('se le misure cambiano oltre tolleranza, il verdetto vecchio non vale piu\'', () => {
    const reg = registra({}, {id: 'z14:residuo:#303030', verdetto: 'contenuto', motivo: 'x', giro: 'a', misure: {diffusione: 0.2}});
    expect(stato(d('z14:residuo:#303030', {diffusione: 0.6}), reg)).toBe('riaperta');
  });
  it('stile e mancanza restano da correggere, e bloccano', () => {
    const reg = registra({}, {id: 'z13:bosco:stile', verdetto: 'stile', motivo: 'verde troppo chiaro', giro: 'a', misure: {dE: 12}});
    expect(stato(d('z13:bosco:stile', {dE: 12}), reg)).toBe('da-correggere');
    expect(bloccante('da-correggere')).toBe(true);
  });
  it('rifiuta un verdetto sconosciuto', () => {
    expect(() => registra({}, {id: 'x', verdetto: 'boh', motivo: '', giro: 'a', misure: {}})).toThrow();
  });
});
```

- [ ] **Passo 2: verifica che fallisca**

Esegui: `npm test -- revisione-registro`
Atteso: FAIL, modulo inesistente

- [ ] **Passo 3: implementazione**

```js
// src/revisione/registro.js
/**
 * I verdetti dell'AI sulle difformita', nel repo perche' li veda il team.
 *
 * Un verdetto che dice "non e' stile" (contenuto, buco di TGen, limite del
 * motore) silenzia la difformita' solo finche' le misure restano quelle del
 * giudizio: se cambiano, il caso si riapre. Senza questa condizione un
 * "contenuto" di ieri nasconderebbe un difetto di stile introdotto oggi.
 */
import {existsSync, readFileSync} from 'node:fs';

export const VERDETTI = ['stile', 'contenuto', 'buco-tgen', 'mancanza', 'motore'];
const SILENZIANO = new Set(['contenuto', 'buco-tgen', 'motore']);
// tolleranze oltre cui le misure "sono cambiate"
const TOLLERANZA = {dE: 5, presenza: 0.15, diffusione: 0.15};

export const leggi = percorso => (existsSync(percorso) ? JSON.parse(readFileSync(percorso, 'utf8')) : {});

export function registra(registro, {id, verdetto, motivo, giro, misure}) {
  if (!VERDETTI.includes(verdetto)) throw new Error(`verdetto "${verdetto}" sconosciuto: ${VERDETTI.join(', ')}`);
  return {...registro, [id]: {verdetto, motivo, giro, misure, data: new Date().toISOString().slice(0, 10)}};
}

const cambiate = (ora, allora) => Object.entries(TOLLERANZA)
  .some(([k, t]) => ora[k] != null && allora[k] != null && Math.abs(ora[k] - allora[k]) > t);

export function stato(d, registro) {
  const v = registro[d.id];
  if (!v) return 'aperta';
  if (!SILENZIANO.has(v.verdetto)) return 'da-correggere';
  return cambiate(d.misure, v.misure) ? 'riaperta' : 'giudicata';
}

export const bloccante = st => st !== 'giudicata';
```

```js
// tools/revisione-verdetto.mjs
#!/usr/bin/env node
/**
 * Scrive il verdetto dell'AI su una difformita' trovata da revisione.mjs.
 * Le misure si prendono dal giro indicato, cosi' il verdetto resta legato a
 * cio' che si e' visto.
 *
 * Uso: node tools/revisione-verdetto.mjs <giro> <id> <verdetto> "<motivo>"
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {VERDETTI, leggi, registra} from '../src/revisione/registro.js';

const [giro, id, verdetto, motivo] = process.argv.slice(2);
if (!motivo) {
  console.error(`uso: revisione-verdetto.mjs <giro> <id> <${VERDETTI.join('|')}> "<motivo>"`);
  process.exit(2);
}
const REG = 'docs/revisione/verdetti.json';
const ris = JSON.parse(readFileSync(`data/revisione/${giro}/risultati.json`, 'utf8'));
const d = ris.difformita.find(q => q.id === id);
if (!d) { console.error(`${id}: non e' fra le difformita' del giro ${giro}`); process.exit(1); }
writeFileSync(REG, JSON.stringify(registra(leggi(REG), {id, verdetto, motivo, giro, misure: d.misure}), null, 2) + '\n');
console.log(`${id}: ${verdetto}`);
```

- [ ] **Passo 4: verifica che passi**

Esegui: `npm test -- revisione-registro`
Atteso: PASS (5 test)

---

### Task 6: report, dossier e orchestratore

**File:**
- Crea: `src/revisione/tgen.js`, `src/revisione/report.js`, `tools/revisione.mjs`
- Modifica: `tools/png-vs-tgen.mjs` (usa `scaricaTgen` invece della sua
  funzione `tgen`, stesso comportamento)
- Test: `test/revisione-report.test.js`

**Interfacce:**
- Usa: tutto quanto sopra; `pipeline/render-png.mjs`; `/version`,
  `/style.json`, le URL delle sorgenti vettoriali del server
- Produce:
  - `scaricaTgen('z/x/y', cache = 'data/ref-cache') -> Promise<string|null>`
  - `dossier({d, immagini: [{tile, tgen, locale, bbox?}], out}) -> Promise<void>`
    (PNG: una riga per esempio, colonne TGen | locale | differenza a 512 px,
    intestazione con id e misure, riquadro rosso sul `bbox`)
  - `pagina({giro, tabella, difformita, stati, scarti}) -> string` (HTML)
  - `fileDossier(id) -> string`: nome del file del dossier, usato sia da chi
    lo scrive sia dal link della pagina
  - `tools/revisione.mjs`: il comando della spec; scrive
    `data/revisione/<giro>/{risultati.json,index.html,dossier/*.png,png/}`;
    esce 1 se una difformita' e' bloccante

- [ ] **Passo 1: test che falliscono**

```js
// test/revisione-report.test.js
import {describe, expect, it} from 'vitest';
import sharp from 'sharp';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {dossier, pagina} from '../src/revisione/report.js';

const tinta = v => Buffer.alloc(256 * 256 * 3, v);

describe('dossier', () => {
  it('una riga per esempio, tre colonne da 512', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'rev-')), 'd.png');
    const d = {id: 'z14:residuo:#303030', tipo: 'residuo', misure: {diffusione: 0.4, nTile: 10}};
    await dossier({d, out, immagini: [
      {tile: '14/1/1', tgen: tinta(40), locale: tinta(240), bbox: [10, 10, 50, 20]},
      {tile: '14/1/2', tgen: tinta(40), locale: tinta(240)},
    ]});
    const m = await sharp(out).metadata();
    expect(m.width).toBe(3 * 512);
    expect(m.height).toBe(40 + 2 * 512);
  });
});

describe('pagina', () => {
  it('elenca le difformita\' con il loro stato e i livelli scartati', () => {
    const html = pagina({
      giro: 'a', tabella: {13: {bosco: {dE: 12, presenza: 0, nTile: 4, esito: 'stile'}}},
      difformita: [{id: 'z13:bosco:stile', tipo: 'stile', misure: {dE: 12, diffusione: 1, nTile: 4}, esempi: []}],
      stati: {'z13:bosco:stile': 'aperta'}, scarti: {8: {copertura: 12}},
    });
    expect(html).toContain('z13:bosco:stile');
    expect(html).toContain('aperta');
    expect(html).toContain('copertura');
    expect(html).toContain('href="dossier/z13_bosco_stile.png"');
  });
});
```

- [ ] **Passo 2: verifica che fallisca**

Esegui: `npm test -- revisione-report`
Atteso: FAIL, modulo inesistente

- [ ] **Passo 3: implementazione di `tgen.js` e `report.js`**

```js
// src/revisione/tgen.js
/**
 * Le tile di TGen, lette in sola lettura da api.webmapp.it e tenute in
 * data/ref-cache come fanno gli altri strumenti. Una tile che TGen non ha
 * (404) da' null: e' contenuto, non un errore.
 */
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const LEGACY = process.env.WM_LEGACY ?? 'https://api.webmapp.it/tiles';

export async function scaricaTgen(t, cache = 'data/ref-cache') {
  mkdirSync(cache, {recursive: true});
  const f = join(cache, `${t.replaceAll('/', '-')}.png`);
  if (!existsSync(f)) {
    const r = await fetch(`${LEGACY}/${t}.png`);
    if (!r.ok) return null;
    writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  }
  return f;
}
```

```js
// src/revisione/report.js
/**
 * Cio' che l'AI legge dopo un giro: una pagina con la tabella livello x layer
 * e le difformita', e per ogni difformita' un dossier di immagini. Il dossier
 * mette affiancati TGen, locale e la differenza amplificata, con la zona del
 * residuo cerchiata: il giudizio "stile o contenuto" si da' guardando, e
 * deve poter essere ricontrollato da chi legge il verdetto.
 */
import sharp from 'sharp';

const LATO = 512, TESTA = 40;

/** `z14:residuo:#303030` -> `z14_residuo__303030.png`: niente `#` ne' `:` nei nomi. */
export const fileDossier = id => id.replace(/[^a-z0-9.-]/gi, '_') + '.png';
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const fmt = m => Object.entries(m).map(([k, v]) => `${k} ${typeof v === 'number' ? +v.toFixed(2) : v}`).join(' · ');

const png = (raw, w = 256, h = 256) => sharp(raw, {raw: {width: w, height: h, channels: 3}})
  .resize(LATO, LATO, {kernel: 'nearest'}).png().toBuffer();

export async function dossier({d, immagini, out}) {
  const strati = [{
    input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${3 * LATO}" height="${TESTA}">`
      + `<rect width="100%" height="100%" fill="#fff"/><text x="8" y="26" font-family="sans-serif" font-size="18">`
      + `${esc(d.id)} — ${esc(fmt(d.misure))} — TGen | locale | differenza</text></svg>`),
    top: 0, left: 0,
  }];
  for (const [r, im] of immagini.entries()) {
    const diff = Buffer.alloc(im.tgen.length);
    for (let i = 0; i < diff.length; i++) diff[i] = 255 - Math.min(255, 3 * Math.abs(im.tgen[i] - im.locale[i]));
    const top = TESTA + r * LATO;
    for (const [c, raw] of [im.tgen, im.locale, diff].entries()) strati.push({input: await png(raw), top, left: c * LATO});
    const [x0, y0, x1, y1] = im.bbox ?? [0, 0, 0, 0];
    const riquadro = im.bbox
      ? `<rect x="${x0 * 2 - 6}" y="${y0 * 2 - 6}" width="${(x1 - x0) * 2 + 12}" height="${(y1 - y0) * 2 + 12}" fill="none" stroke="red" stroke-width="3"/>` : '';
    const sopra = `<svg xmlns="http://www.w3.org/2000/svg" width="${LATO}" height="${LATO}">${riquadro}`
      + `<text x="6" y="${LATO - 8}" font-family="monospace" font-size="16" fill="red">${esc(im.tile)}</text></svg>`;
    for (let c = 0; c < 3; c++) strati.push({input: Buffer.from(sopra), top, left: c * LATO});
  }
  await sharp({create: {width: 3 * LATO, height: TESTA + immagini.length * LATO, channels: 3, background: '#fff'}})
    .composite(strati).png().toFile(out);
}

const COLORI = {conforme: '#d8f0d8', sparso: '#f6f0c8', stile: '#f6c8c8', presenza: '#f0d0f0'};

export function pagina({giro, tabella, difformita, stati, scarti}) {
  const layer = [...new Set(Object.values(tabella).flatMap(Object.keys))].sort();
  const livelli = Object.keys(tabella).map(Number).sort((a, b) => a - b);
  const celle = id => livelli.map(z => {
    const c = tabella[z][id];
    return c ? `<td style="background:${COLORI[c.esito]}" title="${c.nTile} tile">${c.dE.toFixed(1)}</td>` : '<td></td>';
  }).join('');
  const righe = difformita.map(d => `<tr><td>${esc(stati[d.id])}</td><td><a href="dossier/${fileDossier(d.id)}">${esc(d.id)}</a></td>`
    + `<td>${esc(fmt(d.misure))}</td><td>${d.esempi.map(e => esc(e.tile)).join(' ')}</td></tr>`).join('\n');
  const sc = Object.entries(scarti).map(([z, m]) => `<li>z${z}: ${esc(fmt(m))}</li>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>Revisione ${esc(giro)}</title>
<style>body{font:14px sans-serif;margin:16px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:2px 6px}</style>
<h1>Revisione ${esc(giro)}</h1>
<h2>Difformità</h2><table><tr><th>stato</th><th>id</th><th>misure</th><th>esempi</th></tr>${righe}</table>
<h2>Scarti</h2><ul>${sc}</ul>
<h2>ΔE mediano per livello e layer</h2><table><tr><th>layer</th>${livelli.map(z => `<th>z${z}</th>`).join('')}</tr>
${layer.map(id => `<tr><td>${esc(id)}</td>${celle(id)}</tr>`).join('\n')}</table>`;
}
```

- [ ] **Passo 4: verifica che passino**

Esegui: `npm test -- revisione-report`
Atteso: PASS (2 test)

- [ ] **Passo 5: l'orchestratore**

```js
// tools/revisione.mjs
#!/usr/bin/env node
/**
 * La revisione delle tile: confronta con TGen tutte le tile fino a z8 e un
 * campione stratificato sopra, classifica cio' che si misura e documenta in
 * un dossier ogni difformita' da giudicare. Vedi
 * docs/features/revisione-tile/overview.md.
 *
 * Esce 1 se c'e' una difformita' senza verdetto, riaperta, da correggere o
 * una regressione: si usa come un test.
 *
 * Uso: node tools/revisione.mjs --giro <nome> [--universo tile.txt] [--zoom 5-16]
 *        [--per-livello 60] [--seed 1] [--confronta <giro>]
 * Senza --universo: le tile delle celle dichiarate da /version.
 */
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import zlib from 'node:zlib';
import sharp from 'sharp';
import {VectorTile} from '@mapbox/vector-tile';
import {PbfReader} from 'pbf';
import {chiave, parseZxy, tileInBbox} from '../src/raster/tiles.js';
import {campiona, coperta, fascia} from '../src/revisione/campione.js';
import {maschereTile, tileSorgente} from '../src/revisione/maschere.js';
import {misuraTile} from '../src/revisione/misure.js';
import {aggrega, regressioni} from '../src/revisione/aggrega.js';
import {bloccante, leggi, stato} from '../src/revisione/registro.js';
import {dossier, fileDossier, pagina} from '../src/revisione/report.js';
import {scaricaTgen} from '../src/revisione/tgen.js';

const argv = process.argv.slice(2);
const opz = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const GIRO = opz('giro');
if (!GIRO) { console.error('uso: revisione.mjs --giro <nome> [--universo f] [--zoom 5-16] [--per-livello 60] [--seed 1] [--confronta g]'); process.exit(2); }
const [ZA, ZB] = opz('zoom', '5-16').split('-').map(Number);
if (ZB > 16) { console.error('il riferimento arriva a z16: oltre non c\'e\' con cosa confrontarsi'); process.exit(2); }
const BASE = process.env.WM_BASE ?? 'http://localhost:8080';
const OUT = `data/revisione/${GIRO}`;
mkdirSync(`${OUT}/dossier`, {recursive: true});

const versione = await (await fetch(`${BASE}/version`)).json();
const riquadri = versione.provenance?.celle?.map(c => c.bbox) ?? null;
const stile = await (await fetch(`${BASE}/style.json`)).json();
const profilo = JSON.parse(readFileSync('style/zoom-profile.json', 'utf8'));

// 1. universo e campione
let universo;
if (opz('universo')) universo = readFileSync(opz('universo'), 'utf8').split('\n').filter(r => r.trim()).map(parseZxy);
else {
  if (!riquadri) { console.error('/version non dichiara celle: serve --universo'); process.exit(2); }
  universo = [];
  for (let z = ZA; z <= ZB; z++) {
    const viste = new Set();
    for (const b of riquadri) for (const t of tileInBbox(b, z)) if (!viste.has(chiave(t))) { viste.add(chiave(t)); universo.push(t); }
  }
}
universo = universo.filter(t => t.z >= ZA && t.z <= ZB);
const scarti = {};
const conta = (z, motivo) => { scarti[z] ??= {}; scarti[z][motivo] = (scarti[z][motivo] ?? 0) + 1; };
const candidate = universo.filter(t => coperta(t, riquadri) || (conta(t.z, 'copertura'), false));
const campione = campiona(candidate, {perLivello: Number(opz('per-livello', 60)), seed: Number(opz('seed', 1))});
console.error(`${campione.length} tile nel campione (${universo.length} nell'universo)`);

// 2. resa locale
writeFileSync(`${OUT}/tile.txt`, campione.map(chiave).join('\n') + '\n');
const resa = spawnSync('node', ['pipeline/render-png.mjs', '--tiles', `${OUT}/tile.txt`, '--out', `${OUT}/png`, '--base', BASE], {stdio: 'inherit'});
if (resa.status !== 0) { console.error('render-png.mjs fallito'); process.exit(1); }

// 3. misure
const cacheVt = new Map();
async function tileVettoriale(sourceId, tile) {
  const sorgente = stile.sources[sourceId];
  if (sorgente?.type !== 'vector') return null;
  const s = tileSorgente(tile, sorgente.maxzoom ?? 14);
  const url = sorgente.tiles[0].replace('{z}', s.z).replace('{x}', s.x).replace('{y}', s.y);
  if (!cacheVt.has(url)) {
    cacheVt.set(url, (async () => {
      const r = await fetch(url);
      if (r.status !== 200) return null;
      let b = Buffer.from(await r.arrayBuffer());
      if (b[0] === 0x1f) b = zlib.gunzipSync(b);
      return new VectorTile(new PbfReader(b));
    })());
  }
  const vt = await cacheVt.get(url);
  return vt ? {vt, sorgente} : null;
}
const raw = f => sharp(f).removeAlpha().resize(256, 256).raw().toBuffer();
const risultati = [];
for (const t of campione) {
  const k = chiave(t);
  const ref = await scaricaTgen(k);
  if (!ref) { conta(t.z, 'tgen-assente'); continue; }
  const loc = `${OUT}/png/${k}.png`;
  if (!existsSync(loc)) { conta(t.z, 'locale-assente'); continue; }
  const visibili = new Set(profilo.levels[t.z]?.visible ?? []);
  const layers = stile.layers.filter(l => visibili.has(l.id) && l.layout?.visibility !== 'none');
  const {maschere, etichette} = await maschereTile(t, {layers, tileVettoriale});
  const m = misuraTile({tgen: await raw(ref), locale: await raw(loc), maschere, etichette});
  risultati.push({tile: k, z: t.z, fascia: fascia(t.z), ...m});
}

// 4. aggregazione, regressioni, stati
const {tabella, difformita} = aggrega(risultati);
const confronta = opz('confronta');
if (confronta) {
  const prima = JSON.parse(readFileSync(`data/revisione/${confronta}/risultati.json`, 'utf8'));
  difformita.push(...regressioni(tabella, prima.tabella));
}
const registro = leggi('docs/revisione/verdetti.json');
const stati = Object.fromEntries(difformita.map(d => [d.id, stato(d, registro)]));

// 5. dossier e pagina
for (const d of difformita) {
  const immagini = [];
  for (const e of d.esempi) {
    immagini.push({tile: e.tile, bbox: e.bbox, tgen: await raw(await scaricaTgen(e.tile)), locale: await raw(`${OUT}/png/${e.tile}.png`)});
  }
  if (immagini.length) await dossier({d, immagini, out: `${OUT}/dossier/${fileDossier(d.id)}`});
}
writeFileSync(`${OUT}/risultati.json`, JSON.stringify({giro: GIRO, versione: versione.current, scarti, tabella, difformita, stati, risultati}, null, 1));
writeFileSync(`${OUT}/index.html`, pagina({giro: GIRO, tabella, difformita, stati, scarti}));

const bloccanti = difformita.filter(d => bloccante(stati[d.id]));
console.log(`${risultati.length} tile misurate; ${difformita.length} difformita', ${bloccanti.length} da giudicare o correggere`);
for (const d of bloccanti) console.log(`  ${stati[d.id].padEnd(13)} ${d.id}`);
console.log(`report: ${OUT}/index.html`);
process.exit(bloccanti.length ? 1 : 0);
```

- [ ] **Passo 6: `png-vs-tgen.mjs` usa `scaricaTgen`**

In `tools/png-vs-tgen.mjs` togli la funzione `tgen` e le costanti `CACHE`,
`LEGACY` con il loro `mkdirSync`, e importa
`import {scaricaTgen as tgen} from '../src/revisione/tgen.js';`. Le chiamate
`tgen(t)` restano uguali. Verifica:
`node tools/png-vs-tgen.mjs` senza argomenti stampa ancora l'uso ed esce 2.

- [ ] **Passo 7: prova vera su Pisa**

Con il server acceso (`npm start` in un altro terminale):

```bash
rm -rf data/revisione/prova-pisa
node tools/revisione.mjs --giro prova-pisa --zoom 5-16 --per-livello 20
```

Atteso:
- z5–z8 tutte negli scarti per `copertura` (le celle sono di un grado);
- z9–z16 misurate, `risultati.json` e `index.html` scritti;
- uscita 1, con le difformita' elencate;
- fra le difformita' da z14 un residuo sistematico che, aperto il dossier,
  corrisponde agli strati IGM (boschi, aree non terrestri) che TGen disegna
  e il locale no. Se non c'e', **il sistema non vede le mancanze**: abbassa
  `CRITERI.residuo` solo dopo aver controllato nel dossier che il residuo
  non sia finito dentro una maschera dilatata o una zona etichetta.

Apri `data/revisione/prova-pisa/index.html` e due dossier a caso: le tre
colonne devono mostrare la stessa area.

---

### Task 7: documentazione e primo giro di verdetti

**File:**
- Modifica: `CLAUDE.md` (sezione "Confronto con il riferimento"),
  `docs/stato.md` (riga "Confronto automatico con TGen"),
  `docs/features/revisione-tile/notes.md` (crea: deviazioni dal piano)

- [ ] **Passo 1:** in `CLAUDE.md`, nel blocco dei comandi di confronto,
  aggiungi:

```bash
node tools/revisione.mjs --giro <nome> [--zoom 5-16] [--per-livello 60] [--confronta <giro>]  # revisione: difformita' documentate, esce 1 se ne restano
node tools/revisione-verdetto.mjs <giro> <id> <stile|contenuto|buco-tgen|mancanza|motore> "<motivo>"
```

  e un paragrafo breve: il sistema misura e classifica, l'AI giudica il
  residuo guardando i dossier; i verdetti in `docs/revisione/verdetti.json`
  silenziano una difformita' solo finche' le misure restano quelle.

- [ ] **Passo 2:** in `docs/stato.md` la riga "Confronto automatico con TGen"
  passa a ◐, con il comando e il risultato del giro su Pisa.

- [ ] **Passo 3:** primo giro di revisione: per ogni difformita' di
  `prova-pisa` apri il dossier, verifica dove serve con `tile-diff` o
  `colore-per-classe`, e scrivi il verdetto con `revisione-verdetto.mjs`.

- [ ] **Passo 4:** `npm test` e `npm run validate` verdi. Poi chiedi
  all'utente l'ok per il commit unico.
