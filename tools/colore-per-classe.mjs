/**
 * Colore del riferimento per CLASSE di oggetti: rasterizza le nostre
 * geometrie di una classe come maschera e legge i pixel del PNG di TGen sotto
 * di essa, su molte tile.
 *
 * Nasce da un errore: "le provinciali sono gialle a z11" era stato misurato
 * su una strada sola, che nel 2018 era classificata primaria, e aveva portato
 * a colorare di giallo tutte le secondarie. Su 93 tile delle celle di prova le
 * secondarie a z11 risultano grigie e sottili. Una mediana su migliaia di
 * pixel di una classe non si lascia ingannare da un caso particolare.
 *
 * Modi: `mediana` (tutti i pixel sotto la maschera: il colore di una strada
 * larga) e `verde` (il quarto piu' verde: i tratti di una linea tratteggiata
 * verde su fondo chiaro). I riferimenti vanno in data/ref-cache (tile-diff li
 * scarica); le tile senza riferimento si saltano.
 *
 * Le superfici (poligoni) si mascherano col riempimento, le linee col tratto.
 * Con `--locale <dir>` (PNG resi da render-png.mjs, in z/x/y.png) riporta
 * anche la mediana dei nostri pixel sotto la stessa maschera e lo scarto: per
 * le superfici e' il confronto giusto, perche' entrambi i lati sono scuriti
 * dall'ombra e il valore della palette da solo non dice nulla.
 *
 * Uso: node tools/colore-per-classe.mjs <mediana|verde> <archivio> <source-layer> '<filtro JS su p>' [--locale dir] <z/x/y> [...]
 * es.: node tools/colore-per-classe.mjs mediana osm transportation "p.class === 'primary'" 12/2207/1587
 */
import {VectorTile} from '@mapbox/vector-tile';
import {PbfReader} from 'pbf';
import sharp from 'sharp';
import zlib from 'node:zlib';
import {existsSync} from 'node:fs';

const argv = process.argv.slice(2);
const iLoc = argv.indexOf('--locale');
const LOCALE = iLoc >= 0 ? argv.splice(iLoc, 2)[1] : null;
// --bordo: dei poligoni si prende il contorno (largo 4 px) invece dell'interno,
// per le bande lungo i confini di parchi e riserve
const iBordo = argv.indexOf('--bordo');
const BORDO = iBordo >= 0 ? (argv.splice(iBordo, 1), true) : false;
const [modo, archivio, layer, filtroJs, ...tiles] = argv;
if (!['mediana', 'verde', 'viola'].includes(modo) || !tiles.length) {
  console.error("uso: colore-per-classe.mjs <mediana|verde> <archivio> <source-layer> '<filtro>' <z/x/y> [...]");
  process.exit(2);
}
const BASE = process.env.WM_BASE ?? 'http://localhost:8080';
const filtro = new Function('p', `return ${filtroJs}`);
const versione = (await (await fetch(`${BASE}/version`)).json()).current;
const set = (await (await fetch(`${BASE}/preview/config.json`)).json()).defaultSet;

const pixel = [], nostri = [];
for (const tile of tiles) {
  const [z, x, y] = tile.split('/');
  const ref = `data/ref-cache/${z}-${x}-${y}.png`;
  if (!existsSync(ref)) continue;
  // le curve di livello e il DEM stanno nella versione `dem`, non in quella corrente
  const r = await fetch(`${BASE}/t/${archivio === 'contours' ? 'dem' : versione}/${set}/${archivio}/${tile}.pbf`);
  if (r.status !== 200) continue;
  let b = Buffer.from(await r.arrayBuffer());
  if (b[0] === 0x1f) b = zlib.gunzipSync(b);
  const l = new VectorTile(new PbfReader(b)).layers[layer];
  if (!l) continue;
  const d = [];
  let poligoni = false;
  for (let i = 0; i < l.length; i++) {
    const f = l.feature(i);
    if (!filtro(f.properties)) continue;
    poligoni ||= f.type === 3;
    d.push(f.loadGeometry().map(ring => 'M' + ring.map(q => `${(q.x / l.extent) * 256},${(q.y / l.extent) * 256}`).join('L') + (f.type === 3 ? 'Z' : '')).join(' '));
  }
  if (!d.length) continue;
  const tratto = poligoni && !BORDO ? 'fill="#fff" fill-rule="evenodd" stroke="none"'
    : `fill="none" stroke="#fff" stroke-width="${BORDO ? 4 : 1}"`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><path d="${d.join(' ')}" ${tratto} shape-rendering="crispEdges"/></svg>`;
  const maschera = await sharp(Buffer.from(svg)).greyscale().raw().toBuffer();
  const px = await sharp(ref).removeAlpha().raw().toBuffer();
  const loc = LOCALE && existsSync(`${LOCALE}/${z}/${x}/${y}.png`)
    ? await sharp(`${LOCALE}/${z}/${x}/${y}.png`).removeAlpha().raw().toBuffer() : null;
  if (LOCALE && !loc) continue;
  for (let i = 0; i < 256 * 256; i++) {
    if (maschera[i] <= 128) continue;
    pixel.push([px[3 * i], px[3 * i + 1], px[3 * i + 2]]);
    if (loc) nostri.push([loc[3 * i], loc[3 * i + 1], loc[3 * i + 2]]);
  }
}
if (!pixel.length) { console.log('nessun pixel: classe assente o riferimenti mancanti'); process.exit(0); }
let q = pixel;
if (modo === 'verde' || modo === 'viola') {
  const tinta = modo === 'verde' ? c => c[1] - (c[0] + c[2]) / 2 : c => (c[0] + c[2]) / 2 - c[1];
  q = [...pixel].sort((a, b) => tinta(b) - tinta(a)).slice(0, Math.max(1, Math.floor(pixel.length / 4)));
}
const mediana = (arr, k) => arr.map(c => c[k]).sort((a, b) => a - b)[Math.floor(arr.length / 2)];
const med = k => mediana(q, k);
const hex = [0, 1, 2].map(k => med(k).toString(16).padStart(2, '0')).join('');
let riga = `${pixel.length} pixel; ${modo === 'mediana' ? 'mediana' : `quarto piu' ${modo}`} TGen rgb(${med(0)},${med(1)},${med(2)}) = #${hex}`;
if (nostri.length) {
  // nei modi `verde` e `viola` anche il lato locale va ridotto al suo quarto
  // piu' verde o piu' viola: confrontarlo con la mediana di tutti i pixel
  // metteva a confronto la banda di TGen con il fondo locale
  let nq = nostri;
  if (modo === 'verde' || modo === 'viola') {
    const tinta = modo === 'verde' ? c => c[1] - (c[0] + c[2]) / 2 : c => (c[0] + c[2]) / 2 - c[1];
    nq = [...nostri].sort((a, b) => tinta(b) - tinta(a)).slice(0, Math.max(1, Math.floor(nostri.length / 4)));
  }
  const n = [0, 1, 2].map(k => mediana(nq, k));
  const f = v => (v >= 0 ? '+' : '') + v;
  riga += `; locale rgb(${n.join(',')}); scarto locale-TGen ${f(n[0] - med(0))} ${f(n[1] - med(1))} ${f(n[2] - med(2))}`;
}
console.log(riga);
