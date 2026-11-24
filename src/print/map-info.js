/**
 * Il corredo della mappa stampata: barra di scala, nord, attribuzioni.
 *
 * La scheda mostra una mappa diversa per ogni sentiero, quindi la scala cambia
 * a ogni foglio. La barra e' grafica (non «1:25.000») perche' resta vera se il
 * foglio viene ridotto o fotocopiato.
 *
 * Come `src/print/fit.js`, gli ingressi si validano con un helper e gli errori
 * nominano il campo e mai il suo contenuto: dagli shard arrivano geometrie non
 * pubblicate e le coordinate non devono finire nei log (R11). Senza validazione
 * un `NaN` non fa rumore: librsvg scarta in silenzio le geometrie non numeriche
 * e la pagina esce regolare ma senza barra di scala (R17).
 */
import sharp from 'sharp';
import {PIXEL_Z0} from '../raster/ombra.js';

export const ATTRIBUTIONS = ['© OpenStreetMap', '© Webmapp'];

// Dimensioni in millimetri di carta: a 300 dpi 2,5 mm sono circa 30 px.
const ATTRIBUTION_MM = 2.5;   // il minimo leggibile stabilito dalla tipografia
const DIGIT_MM = 3;           // le cifre della barra, un po' piu' grandi
const MARGIN_MM = 4;
const PAD_MM = 1.5;
const BAR_THICKNESS_MM = 1.6;
const NORTH_MM = 9;           // lato del riquadro del nord
const BACKGROUND = 'rgba(255,255,255,0.8)';
const INK = '#1a1a1a';
const LAT_MAX = 85.0511287798; // limite di latitudine di Web Mercator, come in fit.js

function finiteNumber(v, field) {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`${field} deve essere un numero finito`);
  }
}

function positive(v, field) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
    throw new Error(`${field} deve essere un numero positivo`);
  }
}

/** Valida zoom, centro e dpi senza mai citare i valori ricevuti (R11). */
function checkMapInfo({zoom, center, dpi}) {
  finiteNumber(zoom, 'zoom');
  if (!Array.isArray(center) || center.length !== 2) {
    throw new Error('center deve essere una coppia [lon, lat]');
  }
  finiteNumber(center[0], 'center[0] (longitudine)');
  finiteNumber(center[1], 'center[1] (latitudine)');
  if (Math.abs(center[0]) > 180) {
    throw new Error('center[0] (longitudine) fuori dai limiti del mondo');
  }
  if (Math.abs(center[1]) > LAT_MAX) {
    throw new Error('center[1] (latitudine) fuori dai limiti di Web Mercator');
  }
  positive(dpi, 'dpi');
}

/** Metri per pixel alla latitudine data, tile da 256. */
const metersPerPixel = (zoom, lat) => PIXEL_Z0 * Math.cos(lat * Math.PI / 180) / 2 ** zoom;

/** Campi del corredo, restituiti anche quando non si disegna nulla. */
export function mapInfoFields({zoom, center, dpi}) {
  checkMapInfo({zoom, center, dpi});
  const denominator = Math.round(metersPerPixel(zoom, center[1]) * dpi / 25.4 * 1000);
  return {scale: `1:${denominator}`, dpi, attribution: ATTRIBUTIONS.join(' · ')};
}

/**
 * La lunghezza rotonda (1, 2, 5 x 10^k metri) piu' grande che sta in `maxPx`
 * pixel. Sotto il metro non c'e' nessun passo valido e resta il default di
 * 10 m, che in quel caso deborda: agli zoom plausibili non si raggiunge.
 */
export function niceBarLength(mpp, maxPx) {
  const maxMeters = mpp * maxPx;
  let best = 10;
  for (let k = 1; k <= 1e7; k *= 10) {
    for (const m of [1, 2, 5]) if (m * k <= maxMeters) best = m * k;
  }
  return {meters: best, px: best / mpp};
}

// Su una carta italiana il separatore decimale e' la virgola: «2,5 km».
const formatLength = m => (m >= 1000 ? `${String(m / 1000).replace('.', ',')} km` : `${m} m`);
const escapeXml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Larghezza stimata di un testo sans-serif, senza misurare i glifi. I fattori
// sono MISURATI sugli AVANZAMENTI (hmtx) del font che il container della stampa
// ha davvero, DejaVu Sans (`fonts-dejavu-core`), non sull'inchiostro: e'
// l'avanzamento che decide dove finisce una riga.
//
// Due fattori, non uno, perche' il CHIARO e il NERETTO sono due font diversi:
//  - chiaro: le attribuzioni occupano 0,563 em per carattere, non i 0,52 della
//    prima stima, e con quella le due righe sporgevano di 4,1 mm dal loro
//    riquadro (misura dentro il container, Task 10). Sul Mac, dove sans-serif e'
//    Helvetica, sono 0,536: la stima vecchia sporgeva di 1 mm e il bordo destro
//    piu' il padding la nascondevano, quindi il difetto si vedeva solo nel
//    container.
//  - NERETTO: le etichette della barra di scala sono `font-weight="bold"`, cioe'
//    DejaVu Sans Bold, dove le stringhe corte e fitte di cifre arrivano a 0,6955
//    em per carattere («500 m», «250 m»): «2,5 km» 0,638, «10 km» 0,689. Con il
//    solo 0,62 l'ultima etichetta era sottostimata fino a 0,57 mm, che oggi il
//    `pad` di 1,5 mm assorbe per fortuna, non per progetto (review del Task 10).
//    0,70 sta sopra il massimo misurato.
// Il fattore chiaro resta 0,62 perche' il chiaro lo usa solo la riga lunga delle
// attribuzioni, dove la media per carattere converge in basso; una stringa
// CORTA in chiaro arriverebbe a 0,64 e andrebbe trattata come il neretto.
//
// Il testo resta ancorato al bordo DESTRO perche' con un font ancora piu' largo
// l'eccedenza cresca verso l'interno della mappa invece che fuori pagina.
const TEXT_EM = 0.62;
const TEXT_EM_BOLD = 0.70;
const textWidth = (s, size, bold = false) => s.length * size * (bold ? TEXT_EM_BOLD : TEXT_EM);

/**
 * Compone il corredo su `rgb` (buffer grezzo width x height, 3 canali) e
 * restituisce un PNG.
 */
export async function drawMapInfo(rgb, {width, height, dpi, zoom, center, attributions = ATTRIBUTIONS}) {
  positive(width, 'width');
  positive(height, 'height');
  checkMapInfo({zoom, center, dpi});
  const mm = dpi / 25.4;
  const margin = MARGIN_MM * mm, pad = PAD_MM * mm;
  const attrSize = ATTRIBUTION_MM * mm, digitSize = DIGIT_MM * mm;
  const mpp = metersPerPixel(zoom, center[1]);
  const parts = [];

  // barra di scala: in basso a sinistra, al massimo un quarto della larghezza
  const {meters, px: barPx} = niceBarLength(mpp, width / 4);
  const half = barPx / 2, thick = BAR_THICKNESS_MM * mm;
  const labels = ['0', formatLength(meters / 2), formatLength(meters)];
  // le etichette della barra sono in NERETTO: il fattore e' quello, non quello del chiaro
  const lastHalf = textWidth(labels[2], digitSize, true) / 2;
  const panelW = barPx + pad * 2 + lastHalf;
  const panelH = pad * 2 + thick + digitSize * 1.3;
  const px0 = margin, py0 = height - margin - panelH;
  const bx = px0 + pad, by = py0 + pad + digitSize * 1.1;
  parts.push(`<rect x="${px0}" y="${py0}" width="${panelW}" height="${panelH}" rx="${pad / 2}" fill="${BACKGROUND}"/>`);
  parts.push(`<rect x="${bx}" y="${by}" width="${half}" height="${thick}" fill="${INK}" stroke="${INK}" stroke-width="${mm * 0.2}"/>`);
  parts.push(`<rect x="${bx + half}" y="${by}" width="${half}" height="${thick}" fill="#fff" stroke="${INK}" stroke-width="${mm * 0.2}"/>`);
  labels.forEach((t, i) => parts.push(
    `<text x="${bx + half * i}" y="${by - digitSize * 0.25}" font-size="${digitSize}" text-anchor="middle" fill="${INK}" font-family="sans-serif" font-weight="bold">${escapeXml(t)}</text>`));

  // attribuzioni: in basso a destra, e piu' in alto della barra se le toccherebbe.
  // Su una pagina stretta i due riquadri si sovrappongono (600 px di larghezza
  // bastano a farlo), e due pannelli attaccati sembrano un difetto di resa.
  const attr = attributions.join(' · ');
  const aw = textWidth(attr, attrSize) + pad * 2, ah = attrSize + pad * 2;
  const ax = width - margin - aw;
  let ay = height - margin - ah;
  if (ax < px0 + panelW + pad) ay = py0 - pad - ah;
  parts.push(`<rect x="${ax}" y="${ay}" width="${aw}" height="${ah}" rx="${pad / 2}" fill="${BACKGROUND}"/>`);
  parts.push(`<text x="${ax + aw - pad}" y="${ay + pad + attrSize * 0.8}" font-size="${attrSize}" text-anchor="end" fill="${INK}" font-family="sans-serif">${escapeXml(attr)}</text>`);

  // nord: in alto a destra, freccia con la N (le mappe hanno sempre il nord in alto)
  const ns = NORTH_MM * mm, nx = width - margin - ns, ny = margin;
  const cx = nx + ns / 2, nSize = ns * 0.32;
  parts.push(`<rect x="${nx}" y="${ny}" width="${ns}" height="${ns}" rx="${pad / 2}" fill="${BACKGROUND}"/>`);
  parts.push(`<text x="${cx}" y="${ny + nSize * 1.15}" font-size="${nSize}" text-anchor="middle" fill="${INK}" font-family="sans-serif" font-weight="bold">N</text>`);
  parts.push(`<path d="M${cx} ${ny + nSize * 1.45} L${cx + ns * 0.17} ${ny + ns * 0.88} L${cx} ${ny + ns * 0.74} L${cx - ns * 0.17} ${ny + ns * 0.88} Z" fill="${INK}"/>`);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`;
  return sharp(rgb, {raw: {width, height, channels: 3}})
    .composite([{input: Buffer.from(svg), top: 0, left: 0}])
    .png()
    .toBuffer();
}
