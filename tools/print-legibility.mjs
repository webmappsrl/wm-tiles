#!/usr/bin/env node
/**
 * Misura in MILLIMETRI l'altezza del testo piu' piccolo su una pagina resa.
 * E' l'unico controllo di R5 (ticket oc:9011): nessuna metrica di tempo o di
 * memoria dice se un toponimo si legge in cammino.
 *
 * METODO. Per ogni layer di testo dello stile si rende la stessa vista due
 * volte, con tutto il testo spento e con acceso quel solo layer: la differenza
 * fra i due frame e' l'inchiostro di quel layer (glifi e alone), senza
 * confonderlo con strade, curve di livello o simboli. Sull'inchiostro si
 * uniscono i glifi in parole (dilatazione di 0,8 mm in orizzontale e 1 px in verticale, per non fondere le righe di un'etichetta a piu' righe), si prendono i
 * riquadri delle componenti connesse e dell'altezza (estensione lungo l'asse minore, quindi giusta anche per il testo ruotato) si legge il 90 percentile:
 * una parola senza aste ne' code e' bassa quanto l'altezza della x, il
 * percentile alto sceglie le righe con ascendenti e discendenti, che occupano
 * circa un corpo (1 em). Dall'altezza si toglie l'alone (2 x `text-halo-width`
 * x ratio). La grandezza dichiarata dallo stile (`text-size` valutato allo zoom
 * del renderer, per ratio) e' riportata accanto come controllo incrociato.
 * Il numero che decide l'uscita e' il MINIMO fra i layer del CORPO STIMATO
 * (inchiostro / 0,71: altezza delle cifre e delle maiuscole in corpi, la
 * stessa grandezza dei 2,5 mm = 7 pt di una carta), cioe' il testo piu' piccolo
 * che compare davvero. E' esatto per cifre e maiuscole (le quote sono quasi
 * sempre il minimo) e OTTIMISTA fino a circa il 25% per il testo minuscolo con
 * ascendenti, la cui inchiostro e' piu' vicino a un corpo intero.
 *
 * LIMITI. Si escludono le componenti piu' alte di 2,5 volte il corpo dichiarato
 * (o di 6 mm se la grandezza viene dal dato), che sono fusioni di piu' etichette;
 * i layer con meno di 3 componenti non si misurano (colonna "n"). Le etichette
 * di sole cifre (quote, numeri dei sentieri) non hanno ascendenti: misurano
 * l'altezza delle maiuscole, circa 0,7 corpi, quindi per loro 2,5 mm di
 * inchiostro sono circa 3,5 mm di corpo. Parole di una sola x (es. "no") abbassano il
 * percentile se sono la maggioranza. L'alone e' stimato, non misurato: errore
 * atteso circa mezzo punto (0,05 mm). Si misurano solo i layer visibili nella
 * finestra: un layer assente non puo' mai far fallire il controllo.
 * Per la finestra (--crop, in pixel) si rende un quadrato attorno al centro:
 * la scala in millimetri non dipende dalla sua dimensione. Il conteggio dei
 * nomi sulla pagina intera (--count, di serie) e' componenti connesse
 * dell'inchiostro di tutto il testo, con la stessa dilatazione: e' un indice
 * per confrontare configurazioni, non il numero esatto di toponimi.
 *
 * Uso:
 *   node tools/print-legibility.mjs --center 10.55,43.78 --format a4 --dpi 300 \
 *     --zoom 15 --ratio 1 --type-scale 1.48 --min-mm 2.5
 * --zoom e' lo zoom cartografico a 256 px (quello di renderFrame e di fitBounds);
 * --ratio e' il pixel ratio di maplibre-native (1 = ogni pixel css dello stile
 * adattato vale un pixel dell'immagine, quindi text-size 16 -> 32 px).
 * Esce 1 sotto --min-mm, 2 per argomenti sbagliati.
 */
import {adattaStile, localizza, PIXEL_RATIO} from '../src/raster/stile-nativo.js';
import {createMaps, renderFrame} from '../src/print/render.js';
import {pageSize} from '../src/print/formats.js';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const BASE = opt('base', process.env.WM_BASE ?? 'http://localhost:8080');
const DPI = Number(opt('dpi', 300));
const FORMAT = opt('format', 'a4');
const ORIENT = opt('orientation', 'portrait');
const ZOOM = Number(opt('zoom', 15));
const RATIO = Number(opt('ratio', 1));
const TYPE_SCALE = Number(opt('type-scale', 1));
const MIN_MM = opt('min-mm') === undefined ? null : Number(opt('min-mm'));
const CROP = Number(opt('crop', 2480));
const [LON, LAT] = opt('center', '10.55,43.78').split(',').map(Number);
const COUNT = !argv.includes('--no-count');
if (![DPI, ZOOM, RATIO, TYPE_SCALE, CROP, LON, LAT].every(Number.isFinite) || (MIN_MM !== null && !Number.isFinite(MIN_MM))) {
  console.error('uso: print-legibility.mjs --center lon,lat --format a4|a5 --dpi 300 --zoom Z --ratio R --type-scale T [--min-mm N] [--crop px] [--no-count]');
  process.exit(2);
}
const PX_MM = DPI / 25.4;
const mm = px => px / PX_MM;

// --- stile ---------------------------------------------------------------------------
const stile = adattaStile(localizza(await fetch(`${BASE}/style.json`).then(r => r.json()), BASE), {typeScale: TYPE_SCALE});
const isText = l => l.type === 'symbol' && l.layout?.['text-field'] !== undefined && l.layout?.['icon-image'] === undefined;
const testo = stile.layers.filter(isText);

/** Valore numerico fisso di una proprieta'; NaN se dipende da zoom o dato (ci pensa la misura sui pixel). */
const valore = v => (typeof v === 'number' ? v : NaN);
const sizeOf = l => valore(l.layout['text-size'] ?? 32);
const haloOf = l => valore(l.paint?.['text-halo-width'] ?? 0);

const senzaTesto = {...stile, layers: stile.layers.map(l => (isText(l) ? {...l, layout: {...l.layout, visibility: 'none'}} : l))};
const soloQuesto = id => ({...stile, layers: stile.layers.map(l => (isText(l) && l.id !== id ? {...l, layout: {...l.layout, visibility: 'none'}} : l))});

// --- pixel ---------------------------------------------------------------------------
async function frame(s, width, height) {
  return renderFrame({style: s, center: [LON, LAT], zoom: ZOOM, width, height, ratio: RATIO});
}
/** Maschera dei pixel che differiscono (somma dei canali oltre la soglia). */
function differenze(a, b, n) {
  const m = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const d = Math.abs(a[i * 3] - b[i * 3]) + Math.abs(a[i * 3 + 1] - b[i * 3 + 1]) + Math.abs(a[i * 3 + 2] - b[i * 3 + 2]);
    if (d > 45) m[i] = 1;
  }
  return m;
}
/** Dilatazione con rettangolo (2rx+1) x (2ry+1), a somme scorrevoli, separabile. */
function dilata(m, W, H, rx, ry) {
  const tmp = new Uint8Array(m.length), out = new Uint8Array(m.length);
  for (let y = 0; y < H; y++) {
    let acc = 0;
    const row = y * W;
    for (let x = -rx; x < W; x++) {
      if (x + rx < W) acc += m[row + x + rx];
      if (x - rx - 1 >= 0) acc -= m[row + x - rx - 1];
      if (x >= 0) tmp[row + x] = acc > 0 ? 1 : 0;
    }
  }
  for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let y = -ry; y < H; y++) {
      if (y + ry < H) acc += tmp[(y + ry) * W + x];
      if (y - ry - 1 >= 0) acc -= tmp[(y - ry - 1) * W + x];
      if (y >= 0) out[y * W + x] = acc > 0 ? 1 : 0;
    }
  }
  return out;
}
/**
 * Componenti connesse (4 vicini) della maschera dilatata. Per ognuna si legge
 * l'inchiostro ORIGINALE: `h` e' l'estensione lungo l'asse minore (analisi delle
 * componenti principali), cioe' l'altezza della riga anche se il testo e' ruotato;
 * `w` quella lungo l'asse maggiore.
 */
function componenti(grossa, ink, W, H) {
  const visto = new Uint8Array(grossa.length), box = [], pila = new Int32Array(grossa.length);
  for (let s = 0; s < grossa.length; s++) {
    if (!grossa[s] || visto[s]) continue;
    let sp = 0;
    const px = [];
    pila[sp++] = s; visto[s] = 1;
    while (sp) {
      const p = pila[--sp], x = p % W;
      if (ink[p]) px.push(p);
      if (x > 0 && grossa[p - 1] && !visto[p - 1]) { visto[p - 1] = 1; pila[sp++] = p - 1; }
      if (x < W - 1 && grossa[p + 1] && !visto[p + 1]) { visto[p + 1] = 1; pila[sp++] = p + 1; }
      if (p >= W && grossa[p - W] && !visto[p - W]) { visto[p - W] = 1; pila[sp++] = p - W; }
      if (p < grossa.length - W && grossa[p + W] && !visto[p + W]) { visto[p + W] = 1; pila[sp++] = p + W; }
    }
    const n = px.length;
    if (!n) continue;
    let mx = 0, my = 0;
    for (const p of px) { mx += p % W; my += Math.floor(p / W); }
    mx /= n; my /= n;
    let sxx = 0, syy = 0, sxy = 0;
    for (const p of px) { const dx = p % W - mx, dy = Math.floor(p / W) - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), c = Math.cos(th), sn = Math.sin(th);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of px) {
      const dx = p % W - mx, dy = Math.floor(p / W) - my;
      const u = dx * c + dy * sn, v = -dx * sn + dy * c;
      if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    box.push({w: u1 - u0 + 1, h: v1 - v0 + 1, n});
  }
  return box;
}
const percentile = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

/** Altezza delle maiuscole e delle cifre in corpi (Noto Sans): taratura sulle quote, 10 px css = 1,69 mm di corpo e 1,20 mm di inchiostro. */
const CAP = 0.71;
const RX = Math.round(0.8 * PX_MM), RY = 1;

// --- misura per layer ------------------------------------------------------------------
const finestra = Math.min(CROP, pageSize({format: FORMAT, orientation: ORIENT, dpi: DPI}).width);
const base = await frame(senzaTesto, finestra, finestra);
const righe = [];
for (const l of testo) {
  const f = await frame(soloQuesto(l.id), finestra, finestra);
  const ink = differenze(f, base, finestra * finestra);
  const comp = componenti(dilata(ink, finestra, finestra, RX, RY), ink, finestra, finestra);
  const nominale = sizeOf(l) * RATIO; // NaN se la grandezza viene dal dato (["get","s"])
  const halo = (haloOf(l) || 0) * RATIO;
  // fuori i riquadri molto piu' alti del corpo (testo ruotato o lungo una linea);
  // se la grandezza viene dal dato non c'e' un corpo noto: tetto fisso di 6 mm
  const validi = comp.filter(c => c.n >= 12 && c.h <= (Number.isNaN(nominale) ? 6 * PX_MM : nominale * 2.5 + 2 * halo));
  if (!comp.length) continue;
  const h = validi.length >= 3 ? Math.max(0, percentile(validi.map(c => c.h), 0.9) - 2 * halo) : NaN;
  righe.push({id: l.id, n: validi.length, tot: comp.length, nominaleMm: mm(nominale), misuratoMm: mm(h), corpoMm: mm(h) / CAP});
}
righe.sort((a, b) => (a.misuratoMm || 99) - (b.misuratoMm || 99));

console.log(`pagina ${FORMAT} ${ORIENT} ${DPI} dpi, zoom ${ZOOM} (256 px), ratio ${RATIO}, typeScale ${TYPE_SCALE}, centro ${LON},${LAT}; finestra ${finestra} px, 1 mm = ${PX_MM.toFixed(2)} px`);
console.log('  layer                          n  tot  nominale mm  inchiostro mm  corpo stimato mm');
for (const r of righe) {
  console.log(`  ${r.id.padEnd(28)} ${String(r.n).padStart(3)} ${String(r.tot).padStart(4)}  ${(Number.isNaN(r.nominaleMm) ? 'dato' : r.nominaleMm.toFixed(2)).padStart(10)}  ${Number.isNaN(r.misuratoMm) ? '            --' : r.misuratoMm.toFixed(2).padStart(13)}  ${Number.isNaN(r.misuratoMm) ? '' : r.corpoMm.toFixed(2).padStart(15)}`);
}
const misurati = righe.filter(r => !Number.isNaN(r.misuratoMm));
const minMisurato = misurati.length ? Math.min(...misurati.map(r => r.corpoMm)) : NaN;
const minNominale = Math.min(...righe.filter(r => r.n >= 3 && !Number.isNaN(r.nominaleMm)).map(r => r.nominaleMm));
console.log(`testo piu' piccolo: corpo stimato ${minMisurato.toFixed(2)} mm (${misurati.reduce((a, r) => (r.corpoMm < a.corpoMm ? r : a)).id}), dichiarato dallo stile (solo layer a grandezza fissa) ${minNominale.toFixed(2)} mm`);

if (COUNT) {
  const {width, height} = pageSize({format: FORMAT, orientation: ORIENT, dpi: DPI});
  const [tutto, niente] = [await frame(stile, width, height), await frame(senzaTesto, width, height)];
  const ink = differenze(tutto, niente, width * height);
  const comp = componenti(dilata(ink, width, height, RX, RY), ink, width, height).filter(c => c.n >= 12);
  console.log(`nomi sulla pagina intera (${width}x${height}): ${comp.length} blocchi di testo`);
}
if (MIN_MM !== null) {
  if (!(minMisurato >= MIN_MM)) {
    console.error(`FALLITO: ${Number.isNaN(minMisurato) ? 'nessun layer misurabile' : minMisurato.toFixed(2) + ' mm'} < ${MIN_MM} mm`);
    process.exit(1);
  }
  console.log(`ok: ${minMisurato.toFixed(2)} mm >= ${MIN_MM} mm`);
}
process.exit(0);
