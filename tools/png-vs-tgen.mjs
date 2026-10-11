#!/usr/bin/env node
/**
 * Tile PNG rese (render-png.mjs, render-png-ol.mjs) a confronto con quelle di
 * TGen: per tile e per livello, scarto di luminosita' media e di deviazione
 * standard (il contrasto), le due metriche del progetto. Con `--foglio` scrive
 * un foglio di provini: per ogni tile TGen e poi le cartelle date, affiancate.
 *
 * Le metriche guardano tutto il contenuto: valgono come indicatore, e lo
 * scarto fra due renderer sugli stessi dati e' la misura piu' pulita.
 *
 *   node tools/png-vs-tgen.mjs tile.txt nativo=data/png [ol=data/png-ol] [--foglio provini.png]
 */
import sharp from 'sharp';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const argv = process.argv.slice(2);
const iF = argv.indexOf('--foglio');
const foglio = iF >= 0 ? argv[iF + 1] : null;
const pos = iF >= 0 ? argv.filter((a, i) => i !== iF && i !== iF + 1) : argv;
const [lista, ...colonne] = pos;
if (!lista || !colonne.length) {
  console.error('uso: png-vs-tgen.mjs tile.txt nome=cartella [nome=cartella ...] [--foglio out.png]');
  process.exit(2);
}
const dirs = colonne.map(c => { const [nome, dir] = c.includes('=') ? c.split('=') : [c, c]; return {nome, dir}; });
const CACHE = 'data/ref-cache';
const LEGACY = process.env.WM_LEGACY ?? 'https://api.webmapp.it/tiles';
mkdirSync(CACHE, {recursive: true});

async function tgen(t) {
  const f = join(CACHE, `${t.replaceAll('/', '-')}.png`);
  if (!existsSync(f)) {
    const r = await fetch(`${LEGACY}/${t}.png`);
    if (!r.ok) return null;
    writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  }
  return f;
}
const grezzo = f => sharp(f).removeAlpha().resize(256, 256).raw().toBuffer();
function stat(b) {
  let s = 0, s2 = 0;
  const n = b.length / 3;
  for (let i = 0; i < b.length; i += 3) { const l = 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2]; s += l; s2 += l * l; }
  const m = s / n;
  return {lum: m, std: Math.sqrt(Math.max(0, s2 / n - m * m))};
}

const tiles = readFileSync(lista, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
const righe = [], celle = [];
for (const t of tiles) {
  const fT = await tgen(t);
  const fs = dirs.map(d => join(d.dir, `${t}.png`));
  if (!fT || fs.some(f => !existsSync(f))) { console.log(`${t}: manca ${!fT ? 'TGen' : 'un PNG locale'}, saltata`); continue; }
  const sT = stat(await grezzo(fT));
  const misure = [];
  for (const f of fs) { const s = stat(await grezzo(f)); misure.push({dl: s.lum - sT.lum, ds: s.std - sT.std}); }
  righe.push({t, z: Number(t.split('/')[0]), misure});
  celle.push([fT, ...fs]);
}
const f1 = x => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`.padStart(6);
console.log(`tile                ${dirs.map(d => `${d.nome}: dLum   dStd`.padStart(22)).join(' |')}`);
for (const r of righe) console.log(r.t.padEnd(18), r.misure.map(m => `${f1(m.dl)} ${f1(m.ds)}`.padStart(22)).join(' |'));
console.log(`\nper livello, media degli scarti in valore assoluto`);
const zs = [...new Set(righe.map(r => r.z))].sort((a, b) => a - b);
const media = (rr, k, j) => rr.reduce((s, r) => s + Math.abs(r.misure[j][k]), 0) / rr.length;
for (const z of [...zs, 'tutte']) {
  const rr = z === 'tutte' ? righe : righe.filter(r => r.z === z);
  console.log(`${String(z).padEnd(6)} n=${String(rr.length).padStart(3)}`,
    dirs.map((d, j) => `${d.nome} |dLum| ${media(rr, 'dl', j).toFixed(1)} |dStd| ${media(rr, 'ds', j).toFixed(1)}`).join('   '));
}

if (foglio) {
  const L = 256, G = 6, H = 22, K = dirs.length + 1;
  const testo = s => Buffer.from(`<svg width="${L}" height="${H}"><text x="2" y="16" font-family="Helvetica" font-size="14" fill="#222">${s}</text></svg>`);
  const comp = [];
  for (const [k, c] of celle.entries()) {
    const y0 = k * (L + H + 12);
    for (const [j, f] of c.entries()) {
      comp.push({input: testo(`${j === 0 ? righe[k].t + '  ' : ''}${j === 0 ? 'TGen' : dirs[j - 1].nome}`), left: j * (L + G), top: y0});
      comp.push({input: await sharp(f).removeAlpha().resize(L, L).png().toBuffer(), left: j * (L + G), top: y0 + H});
    }
  }
  await sharp({create: {width: K * (L + G), height: celle.length * (L + H + 12), channels: 3, background: '#ffffff'}})
    .composite(comp).png().toFile(foglio);
  console.log(`\nfoglio: ${foglio}`);
}
