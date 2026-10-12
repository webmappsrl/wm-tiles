/**
 * Quali tile guarda la revisione.
 *
 * Fino a z8 l'Italia ha poche centinaia di tile e si prendono tutte; sopra
 * diventano migliaia e si campiona, ripartendo il campione fra le celle di un
 * grado (le stesse di `grid_1x1` di TGen), cosi' nessuna zona resta fuori. Il
 * seed fisso rende il campione ripetibile: due giri si confrontano tile per
 * tile.
 */

const lon = (x, k) => (x / k) * 360 - 180;
const lat = (y, k) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / k))) * 180) / Math.PI;

export function limiti({z, x, y}) {
  const k = 2 ** z;
  return [lon(x, k), lat(y + 1, k), lon(x + 1, k), lat(y, k)];
}

export function cellaDi(t) {
  const [w, s, e, n] = limiti(t);
  return `${Math.floor((w + e) / 2)},${Math.floor((s + n) / 2)}`;
}

/** mulberry32: piccolo, deterministico, sufficiente per un campione. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mescola(arr, r) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function campiona(universo, {perLivello, seed, tutteFino = 8}) {
  const r = rng(seed);
  const perZ = new Map();
  for (const t of universo) {
    if (!perZ.has(t.z)) perZ.set(t.z, []);
    perZ.get(t.z).push(t);
  }
  const out = [];
  for (const [z, tiles] of [...perZ].sort((a, b) => a[0] - b[0])) {
    if (z <= tutteFino) { out.push(...tiles); continue; }
    // ordine stabile prima di mescolare: l'universo puo' arrivare in ordini diversi
    const ordinate = [...tiles].sort((a, b) => a.x - b.x || a.y - b.y);
    const celle = new Map();
    for (const t of ordinate) {
      const c = cellaDi(t);
      if (!celle.has(c)) celle.set(c, []);
      celle.get(c).push(t);
    }
    const code = mescola([...celle.keys()].sort(), r).map(c => mescola(celle.get(c), r));
    // a giro sulle celle, una tile per cella, finche' non si arriva a perLivello
    const presi = [];
    while (presi.length < perLivello && code.some(c => c.length)) {
      for (const c of code) {
        if (c.length && presi.length < perLivello) presi.push(c.shift());
      }
    }
    out.push(...presi);
  }
  // per livello, nell'ordine di estrazione: un prefisso resta stratificato
  return out;
}

/**
 * La tile e' coperta se l'UNIONE dei riquadri la contiene: una z8 e' larga
 * 1,4 gradi e non entra in nessuna cella di un grado, ma in due contigue si'.
 * Si controlla una griglia di punti della tile, bordi compresi.
 */
export function coperta(t, riquadri) {
  if (!riquadri) return true;
  const [w, s, e, n] = limiti(t);
  const P = 8;
  for (let i = 0; i <= P; i++) {
    for (let j = 0; j <= P; j++) {
      const lon = w + ((e - w) * i) / P, lat = s + ((n - s) * j) / P;
      if (!riquadri.some(([rw, rs, re, rn]) => lon >= rw && lon <= re && lat >= rs && lat <= rn)) return false;
    }
  }
  return true;
}

/** I PNG di TGen fino a z12 sono del 2018, da z13 del 2025: due stili. */
export const fascia = z => (z <= 12 ? '2018' : '2025');

/**
 * Le tile dei blocchi `lato` x `lato` che contengono quelle date, senza
 * doppioni: si rende il blocco intero, come render-png in produzione. Una tile
 * resa da sola perde le etichette lungo le linee (quote, nomi dei fossi),
 * perche' il renderer le piazza a intervalli dall'inizio della linea nella
 * vista: la revisione segnalava mancanti etichette che nei PNG consegnati ci
 * sono (12 ottobre 2026).
 */
export function blocchi(tiles, lato) {
  const visti = new Map();
  for (const {z, x, y} of tiles) {
    const l = Math.min(lato, 2 ** z);
    const x0 = Math.floor(x / l) * l, y0 = Math.floor(y / l) * l;
    for (let i = 0; i < l; i++) for (let j = 0; j < l; j++) visti.set(`${z}/${x0 + i}/${y0 + j}`, {z, x: x0 + i, y: y0 + j});
  }
  return [...visti.values()];
}
