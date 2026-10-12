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
 * mancante. Ogni layer symbol ha la sua zona, dove si misura quanto
 * inchiostro mettono i due lati: un nome o un'icona in piu' o in meno si vede
 * li', a prescindere dalla posizione.
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
  const zone = [];
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
    const poligoni = [], cerchi = [], zonePunto = [], zoneLinea = [];
    // le linee per larghezza: ognuna si rasterizza con la sua, non con quella
    // della feature piu' larga del layer
    const lineePer = new Map();
    let raggio = 0;
    const lungoLinea = layer.layout?.['symbol-placement'] === 'line';
    const spenta = layer.type === 'line' && valuta(layer, 'line-opacity', tile.z) === 0;
    for (let i = 0; i < l.length; i++) {
      const f = l.feature(i);
      if (!filtro.filter({zoom: tile.z - 1}, f)) continue;
      const geom = f.loadGeometry();
      if (layer.type === 'symbol') {
        if (f.type === 1) zonePunto.push(...geom.flat().map(q => punto(q, l.extent, pos)));
        // il nome di un poligono sta dentro, non sul contorno: cerchio al
        // centro del riquadro dell'anello esterno
        else if (f.type === 3 && !lungoLinea) zonePunto.push(centro(geom[0], l.extent, pos));
        else zoneLinea.push(percorso(geom, l.extent, pos, false));
        continue;
      }
      if (layer.type === 'circle') {
        raggio = Math.max(raggio, valuta(layer, 'circle-radius', tile.z, f) ?? 5);
        cerchi.push(...geom.flat().map(q => punto(q, l.extent, pos)));
      } else if (layer.type === 'fill' && f.type === 3) {
        poligoni.push(percorso(geom, l.extent, pos, true));
      } else if (layer.type === 'line' && !spenta) {
        const w = valuta(layer, 'line-width', tile.z, f) ?? 1;
        if (w <= 0) continue; // larga 0: nella resa non c'e'
        const k = Math.max(LARGHEZZA_MIN, Math.round(w * 2) / 2);
        if (!lineePer.has(k)) lineePer.set(k, []);
        lineePer.get(k).push(percorso(geom, l.extent, pos, f.type === 3));
      }
    }
    if (layer.type === 'symbol') {
      if (zonePunto.length || zoneLinea.length) {
        zone.push({id: layer.id, lungoLinea: !zonePunto.length, data: await zona(zonePunto, zoneLinea)});
      }
      continue;
    }
    if (!poligoni.length && !lineePer.size && !cerchi.length) continue;
    let data, larghezza;
    if (poligoni.length) data = await rasterizza(poligoni, {tipo: 'pieno'});
    else if (cerchi.length) data = await rasterizzaCerchi(cerchi, Math.max(LARGHEZZA_MIN / 2, raggio));
    else {
      data = new Uint8Array(LATO * LATO);
      for (const [w, ps] of lineePer) {
        const m = await rasterizza(ps, {tipo: 'tratto', larghezza: w});
        for (let i = 0; i < data.length; i++) data[i] |= m[i];
      }
      larghezza = Math.max(...lineePer.keys());
    }
    maschere.push({id: layer.id, tipo: layer.type, data, larghezza});
  }
  // tutte le zone escludono le etichette dalle superfici e dal residuo; dalle
  // linee solo quelle dei punti e dei poligoni: una fascia lungo la strada
  // per il suo nome toglieva la strada stessa dalla misura (review 2)
  const etichette = new Uint8Array(LATO * LATO), etichettePunti = new Uint8Array(LATO * LATO);
  for (const q of zone) {
    for (let i = 0; i < etichette.length; i++) {
      etichette[i] |= q.data[i];
      if (!q.lungoLinea) etichettePunti[i] |= q.data[i];
    }
  }
  return {maschere, etichette, etichettePunti, zone};
}

function centro(anello, extent, pos) {
  const xs = anello.map(q => q.x), ys = anello.map(q => q.y);
  return punto({x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2}, extent, pos);
}

/** La zona di un layer symbol: cerchi attorno ai punti, fasce lungo le linee. */
async function zona(punti, linee) {
  const vuota = new Uint8Array(LATO * LATO);
  const a = punti.length ? await rasterizzaCerchi(punti, ZONA_PUNTO) : vuota;
  const b = linee.length ? await rasterizza(linee, {tipo: 'tratto', larghezza: ZONA_LINEA}) : vuota;
  return a.map((v, i) => v | b[i]);
}
