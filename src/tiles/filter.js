/**
 * Filtro dei layer di una tile MVT operando sui byte del protobuf.
 *
 * UNICO punto di applicazione del filtro dei livelli in tutto il sistema.
 * Non introdurre altrove selezioni di layer: due punti di applicazione
 * producono prima o poi due comportamenti diversi e un'esposizione silenziosa.
 *
 * Struttura MVT (Mapbox Vector Tile spec 2.1):
 *   Tile  { repeated Layer layers = 3; }
 *   Layer { required string name = 1; ... }
 *
 * Il sotto-messaggio di ogni layer viene copiato o scartato integralmente:
 * le geometrie non vengono mai decodificate, quindi il risultato e' lossless
 * e il costo e' proporzionale al numero di layer, non di feature.
 */

const FIELD_LAYERS = 3;
const FIELD_LAYER_NAME = 1;
const WIRE_LENGTH_DELIMITED = 2;

function readVarint(buf, pos) {
  let value = 0;
  let shift = 0;
  let p = pos;
  while (p < buf.length) {
    const b = buf[p];
    value += (b & 0x7f) * Math.pow(2, shift);
    p++;
    if ((b & 0x80) === 0) return {value, next: p};
    shift += 7;
    if (shift > 63) throw new Error('mvt: varint troppo lungo');
  }
  throw new Error('mvt: varint troncato');
}

function skipField(buf, pos, wire) {
  switch (wire) {
    case 0:
      return readVarint(buf, pos).next;
    case 1:
      return pos + 8;
    case 2: {
      const len = readVarint(buf, pos);
      return len.next + len.value;
    }
    case 5:
      return pos + 4;
    default:
      throw new Error(`mvt: wire type non supportato ${wire}`);
  }
}

function readLayerName(buf, start, end) {
  let p = start;
  while (p < end) {
    const key = readVarint(buf, p);
    const field = key.value >>> 3;
    const wire = key.value & 0x07;
    p = key.next;
    if (field === FIELD_LAYER_NAME && wire === WIRE_LENGTH_DELIMITED) {
      const len = readVarint(buf, p);
      const from = len.next;
      return Buffer.from(buf.subarray(from, from + len.value)).toString('utf8');
    }
    p = skipField(buf, p, wire);
  }
  return null;
}

/** Elenca i nomi dei layer presenti nella tile. */
export function layerNames(tile) {
  const names = [];
  let p = 0;
  while (p < tile.length) {
    const key = readVarint(tile, p);
    const field = key.value >>> 3;
    const wire = key.value & 0x07;
    p = key.next;
    if (field === FIELD_LAYERS && wire === WIRE_LENGTH_DELIMITED) {
      const len = readVarint(tile, p);
      const from = len.next;
      const to = from + len.value;
      const name = readLayerName(tile, from, to);
      if (name !== null) names.push(name);
      p = to;
    } else {
      p = skipField(tile, p, wire);
    }
  }
  return names;
}

/**
 * Restituisce una nuova tile contenente solo i layer il cui nome e' in `allowed`.
 * I byte dei layer mantenuti sono copiati senza alcuna trasformazione.
 */
export function filterLayers(tile, allowed) {
  if (tile.length === 0) return new Uint8Array(0);
  const allow = new Set(allowed);
  const chunks = [];
  let p = 0;
  while (p < tile.length) {
    const keyStart = p;
    const key = readVarint(tile, p);
    const field = key.value >>> 3;
    const wire = key.value & 0x07;
    p = key.next;
    if (field === FIELD_LAYERS && wire === WIRE_LENGTH_DELIMITED) {
      const len = readVarint(tile, p);
      const from = len.next;
      const to = from + len.value;
      const name = readLayerName(tile, from, to);
      if (name !== null && allow.has(name)) {
        chunks.push(tile.subarray(keyStart, to));
      }
      p = to;
    } else {
      // Campi top-level diversi da `layers`: conservati per non alterare la tile.
      const end = skipField(tile, p, wire);
      chunks.push(tile.subarray(keyStart, end));
      p = end;
    }
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}
