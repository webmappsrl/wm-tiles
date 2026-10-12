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
 *        [--senza layer,layer]  (collaudo: il locale senza questi layer)
 *        [--ignora layer,layer] (collaudo: questi layer non danno maschere)
 *        [--copertura "W,S,E,N;..."]  (obbligatoria se la versione non dichiara celle)
 * Senza --universo: le tile delle celle dichiarate da /version.
 */
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import zlib from 'node:zlib';
import sharp from 'sharp';
import {VectorTile} from '@mapbox/vector-tile';
import {PbfReader} from 'pbf';
import {chiave, parseZxy, tileInBbox} from '../src/raster/tiles.js';
import {blocchi, campiona, coperta, fascia} from '../src/revisione/campione.js';
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
// la copertura dei dati locali: le celle dichiarate dalla versione, o
// --copertura "W,S,E,N;W,S,E,N". Senza, ci si ferma: considerare tutto coperto
// misurerebbe le tile di confine e di costa, dove i dati locali mancano, e
// darebbe difformita' false (review 3; build-italia.sh non dichiara celle)
const riquadri = opz('copertura')
  ? opz('copertura').split(';').map(b => b.split(',').map(Number))
  : versione.provenance?.celle?.map(c => c.bbox) ?? null;
if (!riquadri) {
  console.error('la versione non dichiara la copertura dei dati: serve --copertura "W,S,E,N[;W,S,E,N...]"');
  process.exit(2);
}
const stile = await (await fetch(`${BASE}/style.json`)).json();
const profilo = JSON.parse(readFileSync('style/zoom-profile.json', 'utf8'));

// 1. universo e campione
let universo;
if (opz('universo')) universo = readFileSync(opz('universo'), 'utf8').split('\n').filter(r => r.trim()).map(parseZxy);
else {
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
const PER_LIVELLO = Number(opz('per-livello', 60));
// i parametri del campione: due giri si confrontano solo se hanno pescato le
// stesse tile, altrimenti ogni layer "sparito" e' solo un campione diverso.
// Si controlla prima della resa, per non buttare il giro
const parametri = {seed: Number(opz('seed', 1)), perLivello: PER_LIVELLO, zoom: [ZA, ZB], copertura: riquadri};
const confronta = opz('confronta');
const prima = confronta ? JSON.parse(readFileSync(`data/revisione/${confronta}/risultati.json`, 'utf8')) : null;
if (prima && JSON.stringify(prima.parametri) !== JSON.stringify(parametri)) {
  console.error(`--confronta ${confronta}: campione diverso (${JSON.stringify(prima.parametri)} contro ${JSON.stringify(parametri)})`);
  process.exit(2);
}
// si pesca da un bacino quattro volte piu' grande: le tile che TGen non ha e
// quelle uniformi (solo mare, solo un colore) non dicono niente sullo stile e
// lasciano il posto alle successive. Nella cella di Pisa erano quasi tutte mare.
const bacino = campiona(candidate, {perLivello: 4 * PER_LIVELLO, seed: Number(opz('seed', 1))});
const UNIFORME = 3; // deviazione standard media dei canali di TGen sotto cui la tile e' uniforme
const presi = new Map();
const campione = [];
for (const t of bacino) {
  const n = presi.get(t.z) ?? 0;
  if (t.z > 8 && n >= PER_LIVELLO) continue;
  let ref;
  try { ref = await scaricaTgen(chiave(t)); } catch { conta(t.z, 'tgen-errore'); continue; }
  if (!ref) { conta(t.z, 'tgen-assente'); continue; }
  const {channels} = await sharp(ref).removeAlpha().stats();
  if (channels.reduce((s, c) => s + c.stdev, 0) / channels.length < UNIFORME) { conta(t.z, 'uniforme'); continue; }
  presi.set(t.z, n + 1);
  campione.push(t);
}
console.error(`${campione.length} tile nel campione (${universo.length} nell'universo)`);

// 2. resa locale
// si rende il blocco 4x4 intero di ogni tile, come in produzione: rese da
// sole le tile perdono le etichette lungo le linee. Si misura solo il campione
writeFileSync(`${OUT}/tile.txt`, blocchi(campione, 4).map(chiave).join('\n') + '\n');
// --senza: il locale si rende senza questi layer. E' il collaudo del sistema:
// un difetto introdotto apposta deve uscire come difformita'
const senza = opz('senza') ? new Set(opz('senza').split(',')) : null;
// --ignora: questi layer non danno maschere. Con --senza simula un layer che
// nel locale non esiste proprio, il caso che deve uscire come residuo
const ignora = opz('ignora') ? new Set(opz('ignora').split(',')) : null;
const soloLayer = senza ? ['--only', stile.layers.map(l => l.id).filter(id => !senza.has(id)).join(',')] : [];
const resa = spawnSync('node', ['pipeline/render-png.mjs', '--tiles', `${OUT}/tile.txt`, '--out', `${OUT}/png`, '--base', BASE, ...soloLayer], {stdio: 'inherit'});
// render-png esce 1 anche per un solo errore, dopo aver scritto il resto: si
// prosegue, e le tile senza PNG si contano come `locale-assente` (review 8)
if (resa.status !== 0) console.error('render-png.mjs ha segnalato errori: le tile senza PNG finiscono negli scarti');

// 3. misure
// la resa tiene ferma la connessione oltre il keep-alive del server, e il primo
// fetch dopo trova il socket chiuso (EPIPE): un secondo tentativo basta
const prendi = url => fetch(url).catch(() => fetch(url));
const cacheVt = new Map();
async function tileVettoriale(sourceId, tile) {
  const sorgente = stile.sources[sourceId];
  if (sorgente?.type !== 'vector') return null;
  const s = tileSorgente(tile, sorgente.maxzoom ?? 14);
  const url = sorgente.tiles[0].replace('{z}', s.z).replace('{x}', s.x).replace('{y}', s.y);
  if (!cacheVt.has(url)) {
    cacheVt.set(url, (async () => {
      const r = await prendi(url);
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
  let ref;
  try { ref = await scaricaTgen(k); } catch { conta(t.z, 'tgen-errore'); continue; }
  if (!ref) { conta(t.z, 'tgen-assente'); continue; }
  const loc = `${OUT}/png/${k}.png`;
  if (!existsSync(loc)) { conta(t.z, 'locale-assente'); continue; }
  const visibili = new Set(profilo.levels[t.z]?.visible ?? []);
  const layers = stile.layers.filter(l => visibili.has(l.id) && l.layout?.visibility !== 'none' && !ignora?.has(l.id));
  const {maschere, etichette, etichettePunti, zone} = await maschereTile(t, {layers, tileVettoriale});
  const m = misuraTile({tgen: await raw(ref), locale: await raw(loc), maschere, etichette, etichettePunti, zone});
  risultati.push({tile: k, z: t.z, fascia: fascia(t.z), ...m});
}

// 4. aggregazione, regressioni, stati
const {tabella, difformita} = aggrega(risultati);
if (prima) difformita.push(...regressioni(tabella, prima.tabella));
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
writeFileSync(`${OUT}/risultati.json`, JSON.stringify({giro: GIRO, versione: versione.current, parametri, scarti, tabella, difformita, stati, risultati}, null, 1));
writeFileSync(`${OUT}/index.html`, pagina({giro: GIRO, tabella, difformita, stati, scarti, registro}));

const bloccanti = difformita.filter(d => bloccante(stati[d.id]));
console.log(`${risultati.length} tile misurate; ${difformita.length} difformita', ${bloccanti.length} da giudicare o correggere`);
for (const d of bloccanti) console.log(`  ${stati[d.id].padEnd(13)} ${d.id}`);
console.log(`report: ${OUT}/index.html`);
process.exit(bloccanti.length ? 1 : 0);
