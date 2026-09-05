/**
 * Taratura della saturazione di una palette delle superfici.
 *
 * I colori del CartoCSS sono esatti, ma le tiles in produzione hanno verdi
 * piu' saturi di quanto quei colori possano produrre: dove disegniamo
 * #c0c8b0 il riferimento ha #b8d0a8, stessa luminosita' e saturazione
 * maggiore di 16. Le tiles dell'Italia sono state rese in dieci giorni con
 * l'aggiornamento OSM spento, quindi con una versione dello stile diversa da
 * quella oggi sul server. L'obiettivo dichiarato e' somigliare al PNG, non al
 * `.mss`: la saturazione si tara sul risultato.
 *
 * Agisce in HSL preservando la luminosita', cosi' la correzione non
 * interferisce con la taratura dell'ombreggiatura.
 *
 * Con `--blu` i valori sono invece uno scostamento sul canale blu: serve
 * quando saturazione e luminosita' sono in pari ma la tinta e' fredda, cosa
 * che le due leve precedenti non correggono. Un verde con troppo blu appare
 * piu' freddo del riferimento anche a parita' di tutto il resto.
 *
 * Uso: node tools/tune-palette.mjs <set> <v;v;...> <z/x/y,...> [--blu]
 */
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';

const [set, fattori, tiles] = process.argv.slice(2);
if (!set || !fattori || !tiles) {
  console.error('uso: node tools/tune-palette.mjs <set> <f1;f2;...> <z/x/y,...>');
  process.exit(2);
}
const MODO_BLU = process.argv.includes('--blu');
const F = fattori.split(';').map(Number);
const TILES = tiles.split(',');
const PROF = 'style/zoom-profile.json';
const originale = readFileSync(PROF, 'utf8');

const aHsl = ([r, g, b]) => {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
};
const daHsl = ([h, s, l]) => {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
};
const hex = v => '#' + v.map(x => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0')).join('');
/** Scostamento sul canale blu, a parita' di rosso e verde. */
const spostaBlu = (col, d) => {
  const m = /^#([0-9a-f]{6})$/i.exec(col);
  if (!m) return col;
  const rgb = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  rgb[2] += d;
  return hex(rgb);
};

const satura = (col, k) => {
  const m = /^#([0-9a-f]{6})$/i.exec(col);
  if (!m) return col;
  const rgb = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  const [h, s, l] = aHsl(rgb);
  return hex(daHsl([h, Math.min(1, s * k), l]));  // la luminosita' non cambia
};

const misura = t => {
  const out = execFileSync('node', ['tools/tile-diff.mjs', t, '1'], {encoding: 'utf8'});
  const m = /Δlum ([+-][\d.]+)\s+Δr ([+-][\d.]+) Δg ([+-][\d.]+) Δb ([+-][\d.]+)\s+Δcontrasto ([+-][\d.]+)/.exec(out);
  return m ? {lum: +m[1], r: +m[2], g: +m[3], b: +m[4], sd: +m[5]} : null;
};

const esiti = [];
try {
  for (const k of F) {
    const p = JSON.parse(originale);
    const pal = p.surfaceSets[set];
    if (!pal) throw new Error(`set '${set}' assente`);
    for (const [nome, val] of Object.entries(pal)) {
      if (nome === 'nota') continue;
      pal[nome] = MODO_BLU ? spostaBlu(val, k) : satura(val, k);
    }
    writeFileSync(PROF, JSON.stringify(p, null, 2));
    execFileSync('node', ['pipeline/build-style.mjs'], {encoding: 'utf8'});

    const r = TILES.map(misura).filter(Boolean);
    const med = ch => r.reduce((a, x) => a + x[ch], 0) / r.length;
    const e = {k, lum: med('lum'), dr: med('r'), dg: med('g'), db: med('b'), sd: med('sd')};
    // il divario di saturazione e' la differenza fra il canale verde e i due
    // laterali: e' quello che si sta correggendo
    e.divarioSat = MODO_BLU ? Math.abs(e.db) : Math.abs(e.dg - (e.dr + e.db) / 2);
    esiti.push(e);
    const f = v => (v >= 0 ? '+' : '') + v.toFixed(1);
    console.log(`  ${MODO_BLU ? 'blu ' + (k >= 0 ? '+' : '') + k : 'saturazione x' + k.toFixed(2)}:  Δlum ${f(e.lum).padStart(6)}  ` +
      `Δr ${f(e.dr).padStart(6)} Δg ${f(e.dg).padStart(6)} Δb ${f(e.db).padStart(6)}  ` +
      `divario sat ${e.divarioSat.toFixed(1)}`);
  }
} finally {
  writeFileSync(PROF, originale);
  execFileSync('node', ['pipeline/build-style.mjs'], {encoding: 'utf8'});
}
const best = esiti.sort((a, b) => a.divarioSat - b.divarioSat)[0];
if (best) console.log(`\n  migliore: x${best.k}  (divario di saturazione ${best.divarioSat.toFixed(1)}, Δlum ${best.lum.toFixed(1)})`);
console.log('  profilo ripristinato: applica il valore scelto a mano');
