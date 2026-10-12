/**
 * L'ombra confrontata con TGen per CLASSE DI VERSANTE, e la griglia dei
 * parametri che la pareggia.
 *
 * Le medie globali (Δ luminosita', Δ deviazione standard) dicevano che a z15
 * l'ombra era gia' giusta (-2,1 / -0,2) mentre a occhio TGen restava piu'
 * marcato: quelle medie mescolano ombra, curve, etichette e uso del suolo, e
 * un eccesso da una parte compensa un difetto dall'altra. Qui si guarda solo
 * l'ombra. Per ogni zona (un blocco di tile attorno a quella data) si rendono
 * con maplibre-native le superfici e il resto SENZA ombra; sui pixel dove non
 * c'e' niente sopra si confronta TGen con il modello d'ombra di
 * `src/raster/ombra.js`, raggruppando i pixel per pendenza (piano, 2-8, 8-15,
 * 15-25, 25-35, oltre 35 gradi) ed esposizione (al sole, di lato, in ombra).
 * L'occhio legge proprio quello: il tono dei piani, dei versanti al sole e di
 * quelli in ombra.
 *
 * Il numero da guardare e' lo scarto medio per classe (rms fra le classi,
 * mediato fra le zone). E' cosi' che si e' visto che TGen da z14 schiarisce i
 * piani e scurisce i versanti ripidi quasi a prescindere dall'esposizione, e
 * che a renderlo serve una luce piu' alta (11 ottobre 2026).
 *
 * Il modello e' quello di grigi() + componi() senza il blur di mezzo pixel,
 * che sulle medie per classe non pesa. Serve il server acceso (lo stile e le
 * quote) e la cache dei PNG di TGen (data/ref-cache, riempita al bisogno).
 *
 * Uso: node tools/ombra-per-classe.mjs <z/x/y> [z/x/y ...]
 *   WM_BASE=https://tiles.maphub.it   server da cui leggere stile e quote (default localhost:8080)
 *   GRIGLIA='{"vert":[1.8,2],"gamma":[1,1.2],"opacity":[0.35],"slope":[0],"el":[55,60]}'
 *   PASSO=2   un pixel ogni PASSO per lato (default 2)     LATO=4   tile per lato di ogni zona
 */
import {createRequire} from 'node:module';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import sharp from 'sharp';
import {adattaStile, localizza, PIXEL_RATIO} from '../src/raster/stile-nativo.js';
import {decodificaTerrarium, fasciaDi, PIXEL_Z0, quoteVista} from '../src/raster/ombra.js';
import {parseZxy, vistaMetatile} from '../src/raster/tiles.js';

const mbgl = createRequire(import.meta.url)('@maplibre/maplibre-gl-native');
const BASE = process.env.WM_BASE ?? 'http://localhost:8080';
const PASSO = Number(process.env.PASSO ?? 2);
const LATO = Number(process.env.LATO ?? 4);
const G = JSON.parse(process.env.GRIGLIA ?? '{}');
const zone = process.argv.slice(2).map(parseZxy);
if (!zone.length || LATO % 2) {
  console.error('uso: ombra-per-classe.mjs <z/x/y> [...]   (LATO pari)');
  process.exit(2);
}

const stile = adattaStile(localizza(await fetch(`${BASE}/style.json`).then(r => r.json()), BASE));
const iOmbra = stile.layers.findIndex(l => l.id.startsWith('contour'));
const sotto = {...stile, layers: stile.layers.slice(0, iOmbra)};
const sopra = {...stile, layers: stile.layers.slice(iOmbra).filter(l => l.type !== 'background')};
const fasce = stile.metadata?.['wm:hillshade']?.fasce ?? [];
const terrain = stile.sources.terrain;
const vuoto = Buffer.alloc(0);
const richiesta = (req, cb) => {
  fetch(req.url).then(async r => {
    if (r.status === 204 || r.status === 404) return cb(null, {data: vuoto});
    if (!r.ok) return cb(new Error(`${r.status} ${req.url}`));
    cb(null, {data: Buffer.from(await r.arrayBuffer())});
  }).catch(e => cb(e));
};
const mappa = s => { const m = new mbgl.Map({request: richiesta, ratio: PIXEL_RATIO}); m.load(s); return m; };
const disegna = (m, vista) => new Promise((ok, ko) => m.render(vista, (e, b) => (e ? ko(e) : ok(b))));
const mSotto = mappa(sotto), mSopra = mappa(sopra);

async function quoteTile(z, x, y) {
  const r = await fetch(terrain.tiles[0].replace('{z}', z).replace('{x}', x).replace('{y}', y));
  if (r.status !== 200) return new Float32Array(256 * 256);
  const {data, info} = await sharp(Buffer.from(await r.arrayBuffer())).raw().toBuffer({resolveWithObject: true});
  return decodificaTerrarium(data, info.channels);
}

async function tgen(z, x, y) {
  const f = `data/ref-cache/${z}-${x}-${y}.png`;
  if (!existsSync(f)) {
    mkdirSync('data/ref-cache', {recursive: true});
    const r = await fetch(`https://api.webmapp.it/tiles/${z}/${x}/${y}.png`, {signal: AbortSignal.timeout(60000)});
    if (!r.ok) throw new Error(`TGen ${z}/${x}/${y}: ${r.status}`);
    writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  }
  return (await sharp(readFileSync(f)).removeAlpha().raw().toBuffer({resolveWithObject: true})).data;
}

const AZ = ((90 - 315) * Math.PI) / 180;
const NOMI_P = ['0-2', '2-8', '8-15', '15-25', '25-35', '35+'], NOMI_A = ['piano', 'sole', 'lato', 'ombra'];

/** I pixel liberi di una zona, con quello che serve al modello e la loro classe. */
async function preparaZona({z, x, y}) {
  const X0 = x - LATO / 2, Y0 = y - LATO / 2;
  // vistaMetatile usa solo mx * lato: un blocco non allineato va bene
  const v = vistaMetatile({z, mx: X0 / LATO, my: Y0 / LATO, lato: LATO}, 0);
  const N = v.pixel;
  const vista = {zoom: z, center: [v.lon, v.lat], width: N / PIXEL_RATIO, height: N / PIXEL_RATIO, bearing: 0, pitch: 0};
  const a = await disegna(mSotto, vista);
  const b = await disegna(mSopra, vista);

  // quote come quoteDellaVista di render-png, con il bordo per la finestra della pendenza
  const zd = Math.min(z, terrain.maxzoom ?? 16), s = 2 ** (z - zd), B = 3 * s;
  const x0 = X0 * 256, y0 = Y0 * 256;
  const u0 = Math.floor((x0 - B + 0.5) / s - 0.5), u1 = Math.floor((x0 + N + B - 0.5) / s - 0.5) + 1;
  const v0 = Math.floor((y0 - B + 0.5) / s - 0.5), v1 = Math.floor((y0 + N + B - 0.5) / s - 0.5) + 1;
  const Wd = u1 - u0 + 1, Hd = v1 - v0 + 1;
  const D = new Float32Array(Wd * Hd);
  for (let ty = Math.floor(v0 / 256); ty <= Math.floor((v0 + Hd - 1) / 256); ty++) {
    for (let tx = Math.floor(u0 / 256); tx <= Math.floor((u0 + Wd - 1) / 256); tx++) {
      const q = await quoteTile(zd, tx, ty);
      for (let r = 0; r < 256; r++) {
        const dr = ty * 256 + r - v0;
        if (dr < 0 || dr >= Hd) continue;
        for (let c = 0; c < 256; c++) {
          const dc = tx * 256 + c - u0;
          if (dc >= 0 && dc < Wd) D[dr * Wd + dc] = q[r * 256 + c];
        }
      }
    }
  }
  const W = N + 2 * B;
  const E = quoteVista(D, Wd, u0, v0, x0, y0, N, B, s);
  const passo = PIXEL_Z0 / 2 ** zd;

  // TGen montato sulla stessa griglia
  const T = Buffer.alloc(N * N * 3);
  for (let j = 0; j < LATO; j++) {
    for (let i = 0; i < LATO; i++) {
      const t = await tgen(z, X0 + i, Y0 + j);
      for (let r = 0; r < 256; r++) t.copy(T, ((j * 256 + r) * N + i * 256) * 3, r * 256 * 3, (r + 1) * 256 * 3);
    }
  }

  // un metro della mappa vale cos(lat) metri sul terreno: le classi si fanno sulla pendenza vera
  const COS = Math.cos((v.lat * Math.PI) / 180);
  const e = (R, C) => E[R * W + C];
  const hx = (R, C, P) => (e(R - P, C - P) - e(R - P, C + P)) + 2 * (e(R, C - P) - e(R, C + P)) + (e(R + P, C - P) - e(R + P, C + P));
  const hy = (R, C, P) => (e(R - P, C - P) - e(R + P, C - P)) + 2 * (e(R - P, C) - e(R + P, C)) + (e(R - P, C + P) - e(R + P, C + P));
  const px = [];
  for (let r = 3; r < N - 3; r += PASSO) {
    for (let c = 3; c < N - 3; c += PASSO) {
      // libero: niente di "sopra" (curve, strade, etichette) entro 3 pixel
      let libero = true;
      for (let dr = -3; dr <= 3 && libero; dr++) for (let dc = -3; dc <= 3; dc++) if (b[((r + dr) * N + c + dc) * 4 + 3]) { libero = false; break; }
      if (!libero) continue;
      const i = r * N + c, R = r + B, C = c + B;
      const gx = hx(R, C, s) / (8 * passo), gy = hy(R, C, s) / (8 * passo);
      const gradi = (Math.atan(Math.hypot(gx, gy) / COS) * 180) / Math.PI;
      const versoSole = Math.cos(AZ - Math.atan2(-gy, gx));
      const kp = gradi < 2 ? 0 : gradi < 8 ? 1 : gradi < 15 ? 2 : gradi < 25 ? 3 : gradi < 35 ? 4 : 5;
      const ka = kp === 0 ? 0 : versoSole > 0.5 ? 1 : versoSole < -0.5 ? 3 : 2;
      px.push({
        gx, gy, gx3: hx(R, C, 3 * s) / (24 * passo), gy3: hy(R, C, 3 * s) / (24 * passo),
        b: [a[i * 4], a[i * 4 + 1], a[i * 4 + 2]], t: (T[i * 3] + T[i * 3 + 1] + T[i * 3 + 2]) / 3, k: kp * 4 + ka,
      });
    }
  }
  return {nome: `${z}/${x}/${y}`, z, px};
}

const overlay = (cb, cs) => (cb <= 0.5 ? 2 * cb * cs : 1 - 2 * (1 - cb) * (1 - cs));

/** Scarto TGen - modello per classe, zona per zona. `set` e' un set d'ombra o una funzione della zona. */
function valuta(dati, set) {
  const minimo = 2000 / PASSO ** 2;
  const perZona = dati.map(zona => {
    const f = typeof set === 'function' ? set(zona) : set;
    const vert = f.vert ?? 1, gamma = f.gamma ?? 1, slope = f.slope ?? 0, op = f.opacity ?? 0;
    const molt = (f.blend ?? 'multiply') === 'multiply';
    const el = ((f.sunElevation ?? 45) * Math.PI) / 180, sEl = Math.sin(el), cEl = Math.cos(el);
    const somme = new Float64Array(24), conta = new Float64Array(24);
    let s2 = 0, n = 0;
    for (const q of zona.px) {
      const dx = vert * q.gx, dy = vert * q.gy, p = Math.atan(Math.hypot(dx, dy));
      const inc = Math.min(1, Math.max(0, sEl * Math.cos(p) + cEl * Math.sin(p) * Math.cos(AZ - Math.atan2(-dy, dx))));
      const luce = Math.pow(inc, gamma) * (1 - slope * Math.sin(p));
      const pend = slope > 0 ? Math.min(1, Math.max(0, 0.5 + slope * (0.35 - Math.sin(Math.atan(Math.hypot(vert * q.gx3, vert * q.gy3)))))) : 0.5;
      let m = 0;
      for (const b of q.b) {
        let c = b / 255;
        c = molt ? c * (op * luce + 1 - op) : op * luce + (1 - op) * c;
        if (slope > 0) c = overlay(c, pend);
        m += (255 * c) / 3;
      }
      const d = q.t - m;
      // oltre 30 livelli e' contenuto diverso (un'etichetta, una strada che da noi non c'e'), non ombra
      if (Math.abs(d) > 30) continue;
      somme[q.k] += d; conta[q.k]++; s2 += d * d; n++;
    }
    const per = [];
    let cl2 = 0, cln = 0;
    for (let k = 0; k < 24; k++) if (conta[k] > minimo) { per[k] = somme[k] / conta[k]; cl2 += per[k] ** 2; cln++; }
    return {per, classi: cln ? Math.sqrt(cl2 / cln) : NaN, rmse: Math.sqrt(s2 / n)};
  }).filter(r => Number.isFinite(r.classi));
  const media = k => perZona.reduce((a, r) => a + r[k], 0) / perZona.length;
  const per = [];
  for (let k = 0; k < 24; k++) {
    const v = perZona.filter(r => r.per[k] !== undefined);
    if (v.length) per[k] = v.reduce((a, r) => a + r.per[k], 0) / v.length;
  }
  return {classi: media('classi'), rmse: media('rmse'), per, perZona};
}

const dati = [];
try {
  for (const t of zone) {
    const d = await preparaZona(t);
    console.log(`  ${d.nome}: ${d.px.length} pixel liberi`);
    if (d.px.length * PASSO ** 2 < 20000) console.log('    pochi pixel liberi: la zona pesa poco nella media');
    dati.push(d);
  }
} finally {
  mSotto.release();
  mSopra.release();
}

const nome = f => `vert ${f.vert} gamma ${f.gamma} opacita' ${f.opacity} pendenza ${f.slope} luce ${f.sunElevation ?? 45}`;
const riga = (etichetta, r) => console.log(`  ${etichetta.padEnd(62)} ${r.classi.toFixed(2).padStart(5)} ${r.rmse.toFixed(2).padStart(6)}   ${r.perZona.map(z => z.classi.toFixed(1)).join(' ')}`);
const attuale = valuta(dati, zona => fasciaDi(fasce, zona.z));
console.log(`\n  ${'set'.padEnd(62)} ${'classi'.padStart(5)} ${'rmse'.padStart(6)}   per zona (classi)`);
riga('attuale (dallo stile)', attuale);

const griglia = [];
for (const vert of G.vert ?? [1.5, 2, 2.5])
  for (const gamma of G.gamma ?? [0.8, 1, 1.2])
    for (const opacity of G.opacity ?? [0.3, 0.35])
      for (const slope of G.slope ?? [0])
        for (const sunElevation of G.el ?? [45, 55, 60, 65]) {
          const blend = dati[0].z >= 14 ? 'normal' : 'multiply';
          const f = {vert, gamma, opacity, slope, sunElevation, blend};
          griglia.push({f, ...valuta(dati, f)});
        }
griglia.sort((a, b) => a.classi - b.classi);
for (const g of griglia.slice(0, 10)) riga(nome(g.f), g);

const migliore = griglia[0];
console.log(`\n  scarto medio TGen - modello per classe (positivo: TGen piu' chiaro)\n  ${'classe'.padEnd(14)} ${'attuale'.padStart(8)} ${'migliore'.padStart(9)}`);
for (let k = 0; k < 24; k++) {
  if (attuale.per[k] === undefined && migliore.per[k] === undefined) continue;
  const f = v => (v === undefined ? '' : (v >= 0 ? '+' : '') + v.toFixed(1));
  console.log(`  ${(NOMI_P[k >> 2] + ' ' + NOMI_A[k & 3]).padEnd(14)} ${f(attuale.per[k]).padStart(8)} ${f(migliore.per[k]).padStart(9)}`);
}
