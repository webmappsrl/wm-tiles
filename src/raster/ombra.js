/**
 * Ombreggiatura calcolata sulla CPU, per i PNG resi da maplibre-native.
 *
 * Nelle app l'ombreggiatura la calcola il dispositivo in WebGL
 * (`src/preview/public/hillshade.js`); maplibre-native non ha un layer che
 * faccia lo stesso — il suo `hillshade` usa un altro algoritmo e lo Style Spec
 * non conosce `multiply` — quindi per i PNG la si calcola qui, con le STESSE
 * formule e gli stessi parametri per livello (`metadata['wm:hillshade']`), e
 * la si compone come la compone il browser: sopra le superfici, sotto le curve
 * di livello e tutto il resto.
 *
 * Le due implementazioni devono restare allineate: `tools/ombra-native-vs-ol.mjs`
 * rende le sole superfici con i due renderer e fallisce se l'ombra diverge. La
 * taratura invece e' una sola, perche' i parametri stanno nello stile.
 *
 * Le formule, in breve (le ragioni sono in hillshade.js):
 * - gradiente di Horn su finestra 3x3, come gdaldem: dz/dx colonna sinistra
 *   meno destra, dz/dy riga sopra meno sotto, diviso 8 volte il passo del DEM;
 * - incidenza della luce con azimut geografico convertito in angolo
 *   matematico, `clamp` a [0, 1], elevata a `gamma`, scurita dalla pendenza;
 * - pendenza su finestra 7x7 (P = 3), composta in `overlay`;
 * - blur gaussiano di 0,5 px su entrambi, come `filter: blur(0.5px)`.
 */

/** Metri di proiezione per pixel a z0, tile da 256. */
export const PIXEL_Z0 = 156543.03392804097;

/** Quote di un PNG Terrarium (`R*256 + G + B/256 - 32768`) in virgola mobile. */
export function decodificaTerrarium(data, canali, n = 256 * 256) {
  const q = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += canali) q[i] = data[p] * 256 + data[p + 1] + data[p + 2] / 256 - 32768;
  return q;
}

/** Il set del livello; fuori dalle fasce il piu' vicino (come `fasciaDi` di hillshade.js). */
export const fasciaDi = (fasce, z) => fasce.find(x => z >= x.zmin && z <= x.zmax)
  ?? (fasce.length && z < fasce[0].zmin ? fasce[0] : fasce.at(-1));

/**
 * Grigi della luce e della pendenza (0-255) per una vista N x N.
 *
 * Oltre l'ultimo livello del DEM la vista e' piu' fine del dato: un punto del
 * DEM copre `s` x `s` pixel. Come in hillshade.js le quote si leggono
 * interpolate (vedi quoteVista) e la finestra del gradiente si misura in punti
 * del DEM, cioe' `s` pixel: dividere per il passo della vista farebbe crescere
 * il gradiente con l'ingrandimento fino a bande nere.
 *
 * @param {Float32Array} E   quote della vista con un bordo di `B` pixel per lato (lato W = N + 2B)
 * @param {number} passo     metri per punto del DEM al livello usato
 * @param {object} f         il set del livello: vert, gamma, slope, sunAzimuth, sunElevation
 * @param {number} s         pixel della vista per punto del DEM (1 fino all'ultimo livello del DEM)
 */
export function grigi(E, N, B, passo, f, s = 1) {
  if (B < 3 * s) throw new Error(`servono ${3 * s} pixel di bordo per la pendenza`);
  const W = N + 2 * B;
  const vert = f.vert ?? 1, gamma = f.gamma ?? 1, slope = f.slope ?? 0;
  const el = ((f.sunElevation ?? 45) * Math.PI) / 180;
  // azimut geografico (0 = Nord, orario) -> angolo matematico (0 = Est, antiorario)
  const az = ((90 - (f.sunAzimuth ?? 315)) * Math.PI) / 180;
  const sEl = Math.sin(el), cEl = Math.cos(el);
  const luce = new Float32Array(N * N);
  const pend = slope > 0 ? new Float32Array(N * N) : null;
  const e = (R, C) => E[R * W + C];
  // Horn: le DIFFERENZE fra la colonna sinistra e la destra, fra la riga sopra e la sotto
  const hornX = (R, C, P) => (e(R - P, C - P) - e(R - P, C + P)) + 2 * (e(R, C - P) - e(R, C + P)) + (e(R + P, C - P) - e(R + P, C + P));
  const hornY = (R, C, P) => (e(R - P, C - P) - e(R + P, C - P)) + 2 * (e(R - P, C) - e(R + P, C)) + (e(R - P, C + P) - e(R + P, C + P));
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const R = r + B, C = c + B;
      const dx = (vert * hornX(R, C, s)) / (8 * passo), dy = (vert * hornY(R, C, s)) / (8 * passo);
      const p = Math.atan(Math.hypot(dx, dy));
      const esposizione = Math.atan2(-dy, dx);
      const inc = Math.min(1, Math.max(0, sEl * Math.cos(p) + cEl * Math.sin(p) * Math.cos(az - esposizione)));
      luce[r * N + c] = Math.round(255 * Math.pow(inc, gamma) * (1 - slope * Math.sin(p)));
      if (pend) {
        const P = 3;
        const p3 = Math.atan(Math.hypot((vert * hornX(R, C, P * s)) / (8 * P * passo), (vert * hornY(R, C, P * s)) / (8 * P * passo)));
        // 0,35 e' la pendenza attorno a cui il contributo si annulla
        pend[r * N + c] = Math.round(255 * Math.min(1, Math.max(0, 0.5 + slope * (0.35 - Math.sin(p3)))));
      }
    }
  }
  return {luce: sfoca(luce, N), pend: pend && sfoca(pend, N)};
}

/**
 * Quote della vista N x N (con bordo B) dal mosaico del DEM a un livello piu'
 * basso, interpolate fra i punti come fa la GPU con la texture delle quote
 * (`interpolate: true` in hillshade.js): l'interpolazione e' lecita perche'
 * le quote sono gia' decodificate in virgola mobile.
 *
 * @param {Float32Array} D    quote del DEM, griglia larga `Wd`, con il punto (u0, v0) in alto a sinistra
 * @param {number} x0, y0     angolo della vista in pixel mondo al livello della vista
 * @param {number} s          pixel della vista per punto del DEM
 */
export function quoteVista(D, Wd, u0, v0, x0, y0, N, B, s) {
  const W = N + 2 * B, E = new Float32Array(W * W);
  const Hd = D.length / Wd;
  for (let r = 0; r < W; r++) {
    // centro del pixel della vista, in punti del DEM (centri dei punti a +0,5)
    const v = (y0 - B + r + 0.5) / s - 0.5 - v0;
    const vi = Math.min(Hd - 2, Math.max(0, Math.floor(v))), fv = v - vi;
    for (let c = 0; c < W; c++) {
      const u = (x0 - B + c + 0.5) / s - 0.5 - u0;
      const ui = Math.min(Wd - 2, Math.max(0, Math.floor(u))), fu = u - ui;
      const a = D[vi * Wd + ui], b = D[vi * Wd + ui + 1], c2 = D[(vi + 1) * Wd + ui], d = D[(vi + 1) * Wd + ui + 1];
      E[r * W + c] = (a * (1 - fu) + b * fu) * (1 - fv) + (c2 * (1 - fu) + d * fu) * fv;
    }
  }
  return E;
}

/** Blur gaussiano separabile con sigma 0,5 px, come `filter: blur(0.5px)`; valori 0-255. */
export function sfoca(a, N) {
  const w = [0, 1, 2].map(d => Math.exp(-(d * d) / (2 * 0.25)));
  const somma = w[0] + 2 * (w[1] + w[2]);
  const [k0, k1, k2] = w.map(x => x / somma);
  const t = new Float32Array(a.length), o = new Float32Array(a.length);
  const lim = i => Math.min(N - 1, Math.max(0, i));
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const at = d => a[r * N + lim(c + d)];
      t[r * N + c] = k0 * at(0) + k1 * (at(-1) + at(1)) + k2 * (at(-2) + at(2));
    }
  }
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const at = d => t[lim(r + d) * N + c];
      o[r * N + c] = Math.round(k0 * at(0) + k1 * (at(-1) + at(1)) + k2 * (at(-2) + at(2)));
    }
  }
  return o;
}

/**
 * Compone la vista come il browser compone i canvas della preview.
 *
 * @param {Buffer} sotto  RGBA delle superfici (opaco)
 * @param {Buffer} sopra  RGBA premoltiplicato di tutto il resto (curve, strade, etichette...)
 * @param {object|null} sh  i grigi di `grigi()`, o null sotto il livello minimo del DEM
 * @param {object|null} f   il set del livello: opacity e blend (`multiply` o `normal`)
 * @returns {Buffer} RGB N x N
 */
export function componi(sotto, sopra, sh, f, N) {
  const out = Buffer.alloc(N * N * 3);
  const alfa = f?.opacity ?? 0;
  const molt = (f?.blend ?? 'multiply') === 'multiply';
  for (let i = 0; i < N * N; i++) {
    const ta = sopra[i * 4 + 3] / 255;
    for (let ch = 0; ch < 3; ch++) {
      let c = sotto[i * 4 + ch];
      if (sh) {
        // layer d'ombra con opacita' alfa: alfa * B(fondo, ombra) + (1 - alfa) * fondo
        const s = sh.luce[i];
        c = Math.round(alfa * (molt ? (c * s) / 255 : s) + (1 - alfa) * c);
        if (sh.pend) {
          // overlay: sotto la meta' moltiplica, sopra schermo
          const cb = c / 255, cs = sh.pend[i] / 255;
          c = Math.round(255 * (cb <= 0.5 ? 2 * cb * cs : 1 - 2 * (1 - cb) * (1 - cs)));
        }
      }
      out[i * 3 + ch] = Math.round(sopra[i * 4 + ch] + c * (1 - ta));
    }
  }
  return out;
}
