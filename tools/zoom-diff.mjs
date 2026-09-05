/**
 * Confronto per livello di zoom sullo stesso punto, una tile per livello.
 *
 * Serve come linea di base: i parametri del riferimento cambiano per fascia
 * di zoom (l'ombra e' 0,2 a z7-10, 0,18 a z11-13, 0,3 a z14+; l'uso suolo
 * passa da Corine ai dati regionali a z14; le strade cambiano modello a z12),
 * quindi una correzione tarata su un livello puo' peggiorarne un altro. Ogni
 * modifica va letta su tutta la scala, non su un livello solo.
 *
 * Usa tile-diff per ciascun livello, quindi eredita la misura stabile e il
 * controllo di copertura.
 *
 * Uso: node tools/zoom-diff.mjs [lon,lat] [zmin] [zmax]
 */
import {execFileSync} from 'node:child_process';

const [lon, lat] = (process.argv[2] ?? '10.72,44.21').split(',').map(Number);
const ZMIN = Number(process.argv[3] ?? 10);
const ZMAX = Number(process.argv[4] ?? 16);

const tileOf = z => {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(
    ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n,
  );
  return `${z}/${x}/${y}`;
};

console.log(`  punto ${lon},${lat}\n`);
console.log(`  ${'zoom'.padEnd(6)}${'tile'.padEnd(18)}${'Δlum'.padStart(7)}${'Δr'.padStart(7)}${'Δg'.padStart(7)}${'Δb'.padStart(7)}${'Δcontrasto'.padStart(12)}`);
const rows = [];
for (let z = ZMIN; z <= ZMAX; z++) {
  const t = tileOf(z);
  let out;
  try {
    out = execFileSync('node', ['tools/tile-diff.mjs', t, '1'], {encoding: 'utf8'});
  } catch (e) {
    console.log(`  z${String(z).padEnd(5)}${t.padEnd(18)}   ${(e.stdout ?? '').trim().split('\n').pop() || 'errore'}`);
    continue;
  }
  const m = /Δlum ([+-][\d.]+)\s+Δr ([+-][\d.]+) Δg ([+-][\d.]+) Δb ([+-][\d.]+)\s+Δcontrasto ([+-][\d.]+)/.exec(out);
  const fuori = /FUORI|PARZIALE/.test(out);
  if (!m) { console.log(`  z${String(z).padEnd(5)}${t.padEnd(18)}   non misurabile`); continue; }
  const [lum, r, g, b, sd] = m.slice(1).map(Number);
  rows.push({z, lum, sd});
  const f = v => (v >= 0 ? '+' : '') + v.toFixed(1);
  console.log(`  z${String(z).padEnd(5)}${t.padEnd(18)}${f(lum).padStart(7)}${f(r).padStart(7)}${f(g).padStart(7)}${f(b).padStart(7)}${f(sd).padStart(12)}` +
    (fuori ? '   ⚠ copertura parziale' : ''));
}
const worst = [...rows].sort((a, b) => Math.abs(b.lum) - Math.abs(a.lum))[0];
if (worst) console.log(`\n  peggiore: z${worst.z} (Δlum ${worst.lum >= 0 ? '+' : ''}${worst.lum.toFixed(1)})`);
