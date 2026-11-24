#!/usr/bin/env node
/**
 * Misura il costo di UN frame a formato pagina (A4 a ~300 dpi) reso con
 * maplibre-native: millisecondi, picco di RSS, byte del PNG.
 *
 * Imita il flusso di pipeline/render-png.mjs (due mbgl.Map, ombra calcolata in
 * mezzo, poi `componi`) ma su UN rettangolo qualsiasi invece che su un metatile.
 *
 * Significato delle opzioni:
 *   --width/--height  pixel dell'immagine finale (A4 a 300 dpi: 2480 x 3508)
 *   --ratio           ingrandimento rispetto a una tile: quanti pixel di uscita per
 *                     ogni pixel di una tile dello stesso livello. Con 2 una mappa
 *                     z14 e' disegnata come una z15 (linee e testi doppi); il pixel
 *                     ratio di maplibre-native e' PIXEL_RATIO * ratio.
 *   --zoom, --center  livello dello stile e centro lon,lat
 *   --geojson         linee da sovrapporre (es. la traccia), file GeoJSON
 *   --out             scrive il PNG; senza, non tocca il disco
 *
 * Nota: ombra.js accetta frame rettangolari. E' questo tool che, per comodita',
 * rende le due metà maplibre-native a W x H (costo reale) e poi le riempie fino a un
 * quadrato di lato max(W, H) per l'ombra, che quindi risulta sovrastimata (circa
 * +40% su un A4). Il livello di quote dell'ombra e' zoom + log2(ratio). Si misura il
 * costo, non si produce l'immagine finale.
 * Opzione --no-shade: salta l'ombra (per separare il suo costo).
 *
 * Uso: node tools/page-cost.mjs --width 2480 --height 3508 --ratio 2 --center 10.72,44.21 --zoom 14
 */
import mbgl from '@maplibre/maplibre-gl-native';
import sharp from 'sharp';
import {readFileSync, writeFileSync} from 'node:fs';
import {adattaStile, localizza, PIXEL_RATIO} from '../src/raster/stile-nativo.js';
import {componi, decodificaTerrarium, fasciaDi, grigi, PIXEL_Z0, quoteVista} from '../src/raster/ombra.js';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const BASE = opt('base', process.env.WM_BASE ?? 'http://localhost:8080');
const WIDTH = Number(opt('width', 2480));
const HEIGHT = Number(opt('height', 3508));
const RATIO = Number(opt('ratio', 2));
const ZOOM = Number(opt('zoom', 14));
const [LON, LAT] = opt('center', '10.72,44.21').split(',').map(Number);
const NO_SHADE = argv.includes('--no-shade');
if (![WIDTH, HEIGHT, RATIO, ZOOM, LON, LAT].every(Number.isFinite)) {
  console.error('uso: page-cost.mjs --width W --height H --ratio R --zoom Z --center lon,lat [--geojson f] [--out f.png] [--no-shade]');
  process.exit(2);
}
if (!Number.isInteger(WIDTH) || !Number.isInteger(HEIGHT) || WIDTH <= 0 || HEIGHT <= 0) {
  console.error('--width e --height devono essere interi positivi (pixel)');
  process.exit(2);
}
// il livello delle quote: a ratio 2 ogni pixel di uscita e' un pixel del livello zoom+1
const SHADE_ZOOM = ZOOM + Math.log2(RATIO);
if (!Number.isInteger(SHADE_ZOOM)) {
  console.error('--ratio deve essere una potenza di 2 (1, 2, 4): il livello delle quote e\' zoom + log2(ratio)');
  process.exit(2);
}

// --- picco di RSS: si campiona, perche' il valore finale non e' il picco -----------
let peakRss = 0;
const sample = () => { peakRss = Math.max(peakRss, process.memoryUsage().rss); };
sample();
const sampler = setInterval(sample, 20);

// --- stile: sotto e sopra l'ombra, come render-png.mjs -------------------------------
const ver = await fetch(`${BASE}/version`).then(r => r.json()).catch(() => null);
if (!ver?.current) {
  console.error(`il server ${BASE} non risponde o non ha una versione corrente`);
  process.exit(1);
}
const style = adattaStile(localizza(await fetch(`${BASE}/style.json`).then(r => r.json()), BASE));
const shadeIndex = style.layers.findIndex(l => l.id.startsWith('contour'));
if (shadeIndex < 0) throw new Error('nessun layer contour: non so dove mettere l\'ombreggiatura');
const below = {...style, layers: style.layers.slice(0, shadeIndex)};
const above = {...style, layers: style.layers.slice(shadeIndex).filter(l => l.type !== 'background')};
if (opt('geojson')) {
  // la traccia sta sopra a tutto; la larghezza segue l'ingrandimento come le linee dello stile
  above.sources = {...above.sources, 'page-track': {type: 'geojson', data: JSON.parse(readFileSync(opt('geojson'), 'utf8'))}};
  above.layers.push({
    id: 'page-track', type: 'line', source: 'page-track',
    layout: {'line-cap': 'round', 'line-join': 'round'},
    paint: {'line-color': '#e0301e', 'line-width': 6},
  });
}
const bands = style.metadata?.['wm:hillshade']?.fasce ?? [];
const terrain = style.sources.terrain;
const DEM_MIN = terrain?.minzoom ?? 8;
const DEM_MAX = terrain?.maxzoom ?? 16;

// --- maplibre-native ------------------------------------------------------------------
let mbglErrors = 0;
mbgl.on('message', m => {
  if (m.severity === 'ERROR') mbglErrors++;
  if (m.severity === 'WARNING' || m.severity === 'ERROR') console.error(`  maplibre ${m.severity}: ${m.text}`);
});
const empty = Buffer.alloc(0);
const request = (req, cb) => {
  fetch(req.url).then(async r => {
    if (r.status === 204 || r.status === 404) return cb(null, {data: empty});
    if (!r.ok) return cb(new Error(`${r.status} ${req.url}`));
    cb(null, {data: Buffer.from(await r.arrayBuffer())});
  }).catch(e => cb(e));
};
const newMap = s => {
  const m = new mbgl.Map({request, ratio: PIXEL_RATIO * RATIO});
  m.load(s);
  return m;
};
const draw = (m, view) => new Promise((ok, ko) => m.render(view, (e, b) => (e ? ko(e) : ok(b))));

// --- quote del DEM (come render-png.mjs, senza cache a meta') ---------------------------
const demTile = async (z, x, y) => {
  const r = await fetch(terrain.tiles[0].replace('{z}', z).replace('{x}', x).replace('{y}', y));
  if (r.status !== 200) return new Float32Array(256 * 256);
  const {data, info} = await sharp(Buffer.from(await r.arrayBuffer())).raw().toBuffer({resolveWithObject: true});
  return decodificaTerrarium(data, info.channels);
};
async function demMosaic(zd, u0, v0, Wd, Hd) {
  const D = new Float32Array(Wd * Hd), k = 2 ** zd, jobs = [];
  for (let ty = Math.floor(v0 / 256); ty <= Math.floor((v0 + Hd - 1) / 256); ty++) {
    for (let tx = Math.floor(u0 / 256); tx <= Math.floor((u0 + Wd - 1) / 256); tx++) {
      if (tx < 0 || ty < 0 || tx >= k || ty >= k) continue;
      jobs.push(demTile(zd, tx, ty).then(q => {
        for (let r = 0; r < 256; r++) {
          const dr = ty * 256 + r - v0;
          if (dr < 0 || dr >= Hd) continue;
          for (let c = 0; c < 256; c++) {
            const dc = tx * 256 + c - u0;
            if (dc >= 0 && dc < Wd) D[dr * Wd + dc] = q[r * 256 + c];
          }
        }
      }));
    }
  }
  await Promise.all(jobs);
  return D;
}
/** Quote del quadrato N x N con angolo (x0, y0) in pixel mondo al livello z. */
async function viewElevations(z, x0, y0, N) {
  const zd = Math.min(z, DEM_MAX), s = 2 ** (z - zd), B = 3 * s;
  const u0 = Math.floor((x0 - B + 0.5) / s - 0.5), u1 = Math.floor((x0 + N + B - 0.5) / s - 0.5) + 1;
  const v0 = Math.floor((y0 - B + 0.5) / s - 0.5), v1 = Math.floor((y0 + N + B - 0.5) / s - 0.5) + 1;
  const Wd = u1 - u0 + 1, Hd = v1 - v0 + 1;
  const D = await demMosaic(zd, u0, v0, Wd, Hd);
  return {E: quoteVista(D, Wd, u0, v0, x0, y0, N, N, B, s), B, s, step: PIXEL_Z0 / 2 ** zd};
}

/** Copia un RGBA W x H dentro un quadrato L x L, con l'angolo in (ox, oy). */
function padToSquare(buf, W, H, L, ox, oy) {
  const out = Buffer.alloc(L * L * 4);
  for (let r = 0; r < H; r++) buf.copy(out, ((r + oy) * L + ox) * 4, r * W * 4, (r + 1) * W * 4);
  return out;
}

// --- il frame -----------------------------------------------------------------------------
const mBelow = newMap(below);
const mAbove = newMap(above);
const mbglRatio = PIXEL_RATIO * RATIO;
const view = {zoom: ZOOM, center: [LON, LAT], width: WIDTH / mbglRatio, height: HEIGHT / mbglRatio, bearing: 0, pitch: 0};
const timing = {};
let png;
const t0 = performance.now();
try {
  let mark = performance.now();
  const lap = name => { const n = performance.now(); timing[name] = n - mark; mark = n; };

  const a = await draw(mBelow, view); lap('mapBelow');
  const b = await draw(mAbove, view); lap('mapAbove');

  const L = Math.max(WIDTH, HEIGHT), ox = Math.floor((L - WIDTH) / 2), oy = Math.floor((L - HEIGHT) / 2);
  let sh = null, f = null;
  if (!NO_SHADE && terrain && SHADE_ZOOM >= DEM_MIN) {
    f = fasciaDi(bands, SHADE_ZOOM);
    // pixel mondo al livello SHADE_ZOOM del centro, poi dell'angolo del quadrato
    const world = 256 * 2 ** SHADE_ZOOM;
    const cx = (LON + 180) / 360 * world;
    const sinLat = Math.sin(LAT * Math.PI / 180);
    const cy = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * world;
    const x0 = Math.round(cx - WIDTH / 2) - ox, y0 = Math.round(cy - HEIGHT / 2) - oy;
    const q = await viewElevations(SHADE_ZOOM, x0, y0, L); lap('demQuotes');
    sh = grigi(q.E, L, L, q.B, q.step, f, q.s); lap('shade');
  }
  const full = componi(padToSquare(a, WIDTH, HEIGHT, L, ox, oy), padToSquare(b, WIDTH, HEIGHT, L, ox, oy), sh, f, L, L);
  lap('compose');
  const rgb = await sharp(full, {raw: {width: L, height: L, channels: 3}})
    .extract({left: ox, top: oy, width: WIDTH, height: HEIGHT}).raw().toBuffer();
  png = await sharp(rgb, {raw: {width: WIDTH, height: HEIGHT, channels: 3}}).png().toBuffer();
  lap('png');
} finally {
  mBelow.release();
  mAbove.release();
}
const ms = performance.now() - t0;
sample();
clearInterval(sampler);
if (opt('out')) writeFileSync(opt('out'), png);

const MB = v => (v / 1048576).toFixed(0);
console.log(`  ${WIDTH}x${HEIGHT} ratio ${RATIO} z${ZOOM} @ ${LON},${LAT}${NO_SHADE ? ' (senza ombra)' : ` ombra al livello ${SHADE_ZOOM}`}`);
console.log(`  tempo      ${ms.toFixed(0)} ms  (${Object.entries(timing).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', ')})`);
console.log(`  picco RSS  ${MB(peakRss)} MB  (campionato; maxRSS del processo ${MB(process.resourceUsage().maxRSS * 1024)} MB)`);
console.log(`  PNG        ${png.length} byte`);
if (mbglErrors) {
  console.error(`  ${mbglErrors} errori di maplibre-native: la misura non e' valida`);
  process.exit(1);
}
