#!/usr/bin/env node
/**
 * Rende le tile PNG con maplibre-native, dallo stesso `style.json` che le app
 * disegneranno con OpenLayers.
 *
 * Perche' maplibre-native e non OpenLayers in un browser (decisione dell'11
 * ottobre 2026, vedi notes.md): senza GPU e' circa 60 volte piu' veloce — la
 * resa dell'Italia passa da settimane a ore — e non ha le corse del browser
 * (ombra non ancora disegnata, scatti ripetuti). Il prezzo accettato: qualche
 * etichetta disposta diversamente da come la disporra' un'app col vettoriale.
 *
 * Lo stile non si tocca: `src/raster/stile-nativo.js` lo adatta in automatico
 * (zoom pieno con pixel ratio 0,5, cosi' le tile vettoriali sono quelle del
 * livello giusto). L'ombreggiatura non e' un layer dello stile: la calcola
 * `src/raster/ombra.js` con le formule e i parametri della preview, e la si
 * compone come il browser, sopra le superfici e sotto le curve di livello.
 *
 * Si disegna a metatile (blocchi di `--lato` x `--lato` tile con un margine
 * attorno) e si ritaglia: una tile disegnata da sola taglierebbe le etichette
 * sui bordi, e la vicina le metterebbe altrove.
 *
 * Le tile scritte sono quelle della versione CORRENTE del server: il flusso e'
 * pubblicare la nuova versione, confrontarla con la precedente
 * (`diff-versioni.mjs`) e rendere l'elenco.
 *
 * Uso:
 *   node pipeline/render-png.mjs --tiles tile.txt [--out data/png]
 *   node pipeline/render-png.mjs --bbox W,S,E,N --zoom 8-16 [--out data/png]
 * Opzioni: --base http://localhost:8080  --lato 4  --margine 128
 *          --only a,b  (solo questi layer, come `?only=` della preview; l'ombra resta)
 * Su Linux senza le librerie giuste: pipeline/render-png-docker.sh, stessi argomenti.
 */
import mbgl from '@maplibre/maplibre-gl-native';
import sharp from 'sharp';
import {mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {parseZxy, raggruppa, tileInBbox, vistaMetatile} from '../src/raster/tiles.js';
import {adattaStile, PIXEL_RATIO} from '../src/raster/stile-nativo.js';
import {componi, decodificaTerrarium, fasciaDi, grigi, PIXEL_Z0} from '../src/raster/ombra.js';

const argv = process.argv.slice(2);
const opz = (nome, def) => {
  const i = argv.indexOf(`--${nome}`);
  return i >= 0 ? argv[i + 1] : def;
};
const OUT = opz('out', 'data/png');
const BASE = opz('base', process.env.WM_BASE ?? 'http://localhost:8080');
const LATO = Number(opz('lato', 4));
const MARGINE = Number(opz('margine', 128));
const SOLO = opz('only') ? new Set(opz('only').split(',')) : null;

let tiles;
if (opz('tiles')) {
  tiles = readFileSync(opz('tiles'), 'utf8').split('\n').filter(r => r.trim()).map(parseZxy);
} else if (opz('bbox')) {
  const bbox = opz('bbox').split(',').map(Number);
  const [za, zb] = (opz('zoom', '8-16')).split('-').map(Number);
  if (bbox.length !== 4 || bbox.some(v => !Number.isFinite(v))) throw new Error('--bbox vuole W,S,E,N');
  tiles = [];
  for (let z = za; z <= (zb ?? za); z++) tiles.push(...tileInBbox(bbox, z));
} else {
  console.error('uso: render-png.mjs --tiles <file> | --bbox W,S,E,N --zoom a-b  [--out dir]');
  process.exit(2);
}

const ver = await fetch(`${BASE}/version`).then(r => r.json()).catch(() => null);
if (!ver?.current) {
  console.error(`il server ${BASE} non risponde o non ha una versione corrente`);
  process.exit(1);
}

// --- stile: due meta', sotto e sopra l'ombreggiatura ---------------------------
// Il server scrive gli URL delle sorgenti con l'host della richiesta, quindi da
// un container basta passare --base con l'host raggiungibile da li'.
const stile = adattaStile(await fetch(`${BASE}/style.json`).then(r => r.json()));
if (SOLO) for (const l of stile.layers) if (!SOLO.has(l.id)) (l.layout ??= {}).visibility = 'none';
// l'ombra sta sopra le superfici e sotto le curve di livello, come posizionaOmbra() della preview
const iOmbra = stile.layers.findIndex(l => l.id.startsWith('contour'));
if (iOmbra < 0) throw new Error('nessun layer contour: non so dove mettere l\'ombreggiatura');
const sotto = {...stile, layers: stile.layers.slice(0, iOmbra)};
const sopra = {...stile, layers: stile.layers.slice(iOmbra).filter(l => l.type !== 'background')};
const fasce = stile.metadata?.['wm:hillshade']?.fasce ?? [];
const terrain = stile.sources.terrain;
const DEM_MIN = terrain?.minzoom ?? 8;
const DEM_MAX = terrain?.maxzoom ?? 16;

// --- maplibre-native -------------------------------------------------------------
let errori = 0;
mbgl.on('message', m => {
  if (m.severity === 'ERROR') errori++;
  if (m.severity === 'WARNING' || m.severity === 'ERROR') console.error(`  maplibre ${m.severity}: ${m.text}`);
});
const vuoto = Buffer.alloc(0);
const richiesta = (req, cb) => {
  fetch(req.url).then(async r => {
    // fuori copertura il server risponde 204 o 404: tile vuota, non errore
    if (r.status === 204 || r.status === 404) return cb(null, {data: vuoto});
    if (!r.ok) return cb(new Error(`${r.status} ${req.url}`));
    cb(null, {data: Buffer.from(await r.arrayBuffer())});
  }).catch(e => cb(e));
};
const nuovaMappa = s => {
  const m = new mbgl.Map({request: richiesta, ratio: PIXEL_RATIO});
  m.load(s);
  return m;
};
const mSotto = nuovaMappa(sotto);
const mSopra = nuovaMappa(sopra);
const disegna = (m, vista) => new Promise((ok, ko) => m.render(vista, (e, b) => (e ? ko(e) : ok(b))));

// --- quote del DEM -----------------------------------------------------------------
const cacheDem = new Map();
const quote = (z, x, y) => {
  const k = `${z}/${x}/${y}`;
  if (!cacheDem.has(k)) {
    if (cacheDem.size > 2000) cacheDem.delete(cacheDem.keys().next().value);
    cacheDem.set(k, (async () => {
      const r = await fetch(terrain.tiles[0].replace('{z}', z).replace('{x}', x).replace('{y}', y));
      // fuori copertura quota 0, come la preview: il bordo dell'area non diventa un muro
      if (r.status !== 200) return new Float32Array(256 * 256);
      const {data, info} = await sharp(Buffer.from(await r.arrayBuffer())).raw().toBuffer({resolveWithObject: true});
      return decodificaTerrarium(data, info.channels);
    })());
  }
  return cacheDem.get(k);
};

/** Quote della vista N x N con angolo (x0, y0) in pixel mondo a zoom z, piu' un bordo B. */
async function mosaico(z, x0, y0, N, B) {
  const W = N + 2 * B, E = new Float32Array(W * W), k = 2 ** z;
  const lavori = [];
  for (let ty = Math.floor((y0 - B) / 256); ty <= Math.floor((y0 + N + B - 1) / 256); ty++) {
    for (let tx = Math.floor((x0 - B) / 256); tx <= Math.floor((x0 + N + B - 1) / 256); tx++) {
      if (tx < 0 || ty < 0 || tx >= k || ty >= k) continue;
      lavori.push(quote(z, tx, ty).then(q => {
        for (let r = 0; r < 256; r++) {
          const er = ty * 256 + r - (y0 - B);
          if (er < 0 || er >= W) continue;
          for (let c = 0; c < 256; c++) {
            const ec = tx * 256 + c - (x0 - B);
            if (ec >= 0 && ec < W) E[er * W + ec] = q[r * 256 + c];
          }
        }
      }));
    }
  }
  await Promise.all(lavori);
  return E;
}

// --- i metatile ----------------------------------------------------------------------
const blocchi = raggruppa(tiles, LATO);
console.log(`  ${tiles.length} tile in ${blocchi.length} metatile, versione ${ver.current} -> ${OUT}`);
let scritte = 0;
const t0 = Date.now();
try {
  for (const [i, m] of blocchi.entries()) {
    const v = vistaMetatile(m, MARGINE);
    const N = v.pixel;
    const vista = {zoom: m.z, center: [v.lon, v.lat], width: N / PIXEL_RATIO, height: N / PIXEL_RATIO, bearing: 0, pitch: 0};
    const a = await disegna(mSotto, vista);
    const b = await disegna(mSopra, vista);
    let f = null, sh = null;
    if (m.z >= DEM_MIN && terrain) {
      if (m.z > DEM_MAX) throw new Error(`z${m.z}: oltre il livello massimo del DEM (${DEM_MAX}) l'ombra non e' calcolata`);
      f = fasciaDi(fasce, m.z);
      const B = 3;
      const E = await mosaico(m.z, m.mx * m.lato * 256 - MARGINE, m.my * m.lato * 256 - MARGINE, N, B);
      sh = grigi(E, N, B, PIXEL_Z0 / 2 ** m.z, f);
    }
    const rgb = componi(a, b, sh, f, N);
    for (const t of m.tiles) {
      const png = await sharp(rgb, {raw: {width: N, height: N, channels: 3}}).extract(v.ritaglio(t)).png().toBuffer();
      const dest = join(OUT, String(t.z), String(t.x), `${t.y}.png`);
      mkdirSync(dirname(dest), {recursive: true});
      // scrittura atomica: chi serve la cartella non vede mai un PNG a meta'
      writeFileSync(`${dest}.tmp`, png);
      renameSync(`${dest}.tmp`, dest);
      scritte++;
    }
    const s = (Date.now() - t0) / 1000;
    console.log(`  [${i + 1}/${blocchi.length}] z${m.z} ${m.mx},${m.my}: ${m.tiles.length} tile — ${scritte} scritte in ${s.toFixed(1)} s`);
  }
} finally {
  mSotto.release();
  mSopra.release();
}
console.log(`  fatto: ${scritte} PNG in ${OUT}`);
if (errori) {
  console.error(`  ${errori} errori di maplibre-native: i PNG potrebbero mancare di qualcosa`);
  process.exit(1);
}
