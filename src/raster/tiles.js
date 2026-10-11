/**
 * Aritmetica delle tile XYZ per il rendering dei PNG: quali tile rifare dopo
 * un aggiornamento e come raggrupparle in metatile.
 *
 * Il rendering avviene a METATILE — un blocco di tile disegnato in una sola
 * vista e poi ritagliato — per lo stesso motivo per cui lo fa Mapnik: una
 * tile disegnata da sola perde le etichette e i simboli che sconfinano dai
 * bordi, e la tile accanto, disegnata in un'altra vista, li mette altrove.
 * Le cuciture si vedrebbero a ogni bordo.
 */

const MEZZO_MONDO = 20037508.342789244; // EPSG:3857, metri

export const chiave = t => `${t.z}/${t.x}/${t.y}`;

export function parseZxy(s) {
  const m = /^(\d+)\/(\d+)\/(\d+)$/.exec(String(s).trim());
  if (!m) throw new Error(`tile non valida: "${s}" (atteso z/x/y)`);
  const [z, x, y] = m.slice(1).map(Number);
  const n = 2 ** z;
  if (x >= n || y >= n) throw new Error(`tile fuori dalla griglia di z${z}: ${s}`);
  return {z, x, y};
}

/** La tile e le otto intorno, senza uscire dalla griglia. */
export function vicini({z, x, y}) {
  const n = 2 ** z;
  const out = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < n && ny < n) out.push({z, x: nx, y: ny});
    }
  }
  return out;
}

/** Tutte le tile contenute in questa, dal livello sotto fino a `zmax`. */
export function discendenti({z, x, y}, zmax) {
  const out = [];
  for (let zz = z + 1; zz <= zmax; zz++) {
    const k = 2 ** (zz - z);
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) out.push({z: zz, x: x * k + i, y: y * k + j});
    }
  }
  return out;
}

/**
 * Dalle tile vettoriali cambiate di UN archivio alle tile PNG da rifare.
 *
 * - Le vicine si rifanno sempre: OpenLayers disegna un'etichetta anche fuori
 *   dalla tile che contiene il punto, quindi una modifica puo' cambiare il
 *   PNG accanto pur lasciandone identici i dati.
 * - Una tile al maxzoom dell'archivio trascina tutti i livelli sopra, fino a
 *   `zmax`: oltre il maxzoom il client disegna quella tile ingrandita.
 * - Sotto il maxzoom non si scende: i livelli superiori hanno tile proprie,
 *   gia' confrontate, e quelle non cambiate restano valide.
 */
export function tileDaRendere(cambiate, {archMaxZoom, zmin, zmax}) {
  const set = new Map();
  const aggiungi = t => {
    if (t.z >= zmin && t.z <= zmax) set.set(chiave(t), t);
  };
  for (const t of cambiate) {
    for (const v of vicini(t)) {
      aggiungi(v);
      if (t.z >= archMaxZoom) discendenti(v, zmax).forEach(aggiungi);
    }
  }
  return [...set.values()].sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y);
}

/** Raggruppa le tile in blocchi `lato` x `lato` dello stesso livello. */
export function raggruppa(tiles, lato) {
  const blocchi = new Map();
  for (const t of tiles) {
    const l = Math.min(lato, 2 ** t.z);
    const mx = Math.floor(t.x / l), my = Math.floor(t.y / l);
    const k = `${t.z}/${mx}/${my}`;
    if (!blocchi.has(k)) blocchi.set(k, {z: t.z, mx, my, lato: l, tiles: []});
    blocchi.get(k).tiles.push(t);
  }
  return [...blocchi.values()];
}

/**
 * La vista che disegna un metatile: centro in gradi, lato del viewport in
 * pixel e il ritaglio di ogni tile. Il margine attorno al blocco serve a
 * disegnare le etichette che vi sconfinano da fuori.
 *
 * Il centro del blocco cade su un angolo di tile, quindi con un viewport di
 * lato pari il ritaglio e' a pixel interi: niente ricampionamento.
 */
export function vistaMetatile({z, mx, my, lato}, margine) {
  const passo = (2 * MEZZO_MONDO) / 2 ** z;
  const cx = -MEZZO_MONDO + (mx * lato + lato / 2) * passo;
  const cy = MEZZO_MONDO - (my * lato + lato / 2) * passo;
  const lon = (cx / MEZZO_MONDO) * 180;
  const lat = (Math.atan(Math.exp((cy / MEZZO_MONDO) * Math.PI)) * 360) / Math.PI - 90;
  return {
    lon, lat,
    pixel: lato * 256 + 2 * margine,
    ritaglio: t => ({
      left: margine + (t.x - mx * lato) * 256,
      top: margine + (t.y - my * lato) * 256,
      width: 256, height: 256,
    }),
  };
}

/** Le tile di livello `z` che toccano il bbox [W, S, E, N] in gradi. */
export function tileInBbox([w, s, e, n], z) {
  const k = 2 ** z;
  const tx = lon => Math.min(k - 1, Math.max(0, Math.floor(((lon + 180) / 360) * k)));
  const ty = lat => {
    const r = (lat * Math.PI) / 180;
    const v = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * k);
    return Math.min(k - 1, Math.max(0, v));
  };
  const out = [];
  for (let x = tx(w); x <= tx(e); x++) {
    for (let y = ty(n); y <= ty(s); y++) out.push({z, x, y});
  }
  return out;
}

/** Se la tile tocca il riquadro [W, S, E, N] in gradi. */
export function toccaBbox({z, x, y}, [w, s, e, n]) {
  const k = 2 ** z;
  const lon = i => (i / k) * 360 - 180;
  const lat = j => (Math.atan(Math.sinh(Math.PI * (1 - (2 * j) / k))) * 180) / Math.PI;
  return lon(x) < e && lon(x + 1) > w && lat(y + 1) < n && lat(y) > s;
}
