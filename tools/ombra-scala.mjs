/**
 * Controllo dell'ombreggiatura su UNA coordinata, per tutta la scala.
 *
 * Tenere fisso il punto e muovere solo lo zoom e' l'unico modo di distinguere
 * un difetto del calcolo da una differenza del terreno: se una striscia
 * compare a z14 e non a z13 sullo stesso versante, la causa e' nel rendering.
 *
 * Riporta per ogni livello la percentuale di righe e colonne anomale — la
 * firma delle strisce — sull'ombra isolata, e salva il provino affiancato.
 *
 * Uso: node tools/ombra-scala.mjs [lon,lat] [z1 z2 ...]
 */
import {chromium} from 'playwright';
import sharp from 'sharp';

const PUNTO = process.argv[2] ?? '10.36255,44.28380';   // 14/8663/5939, Monte Belfiore
const LIVELLI = process.argv.slice(3).map(Number);
const ZOOMS = LIVELLI.length ? LIVELLI : [10, 11, 12, 13, 14, 15, 16, 17];
const BASE = process.env.WM_BASE ?? 'http://localhost:8080';
const OUT = process.env.WM_OUT ?? 'data/ombra-scala.png';
const SOGLIA = Number(process.env.WM_SOGLIA ?? 5);

const anomale = (data, w, h, perColonne) => {
  const n = perColonne ? w : h;
  const d = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    let s = 0;
    const m = perColonne ? h : w;
    for (let j = 0; j < m; j++) {
      const a = perColonne ? j * w + i : i * w + j;
      const b = perColonne ? j * w + i + 1 : (i + 1) * w + j;
      s += Math.abs(data[a] - data[b]);
    }
    d[i] = s / m;
  }
  const ord = [...d].sort((a, b) => a - b);
  const mediana = ord[ord.length >> 1] || 1e-6;
  return (100 * d.filter(v => v > mediana * 2.2).length) / d.length;
};

const b = await chromium.launch({args: ['--use-gl=angle', '--enable-unsafe-swiftshader']});
const ctx = await b.newContext({viewport: {width: 256, height: 256}, deviceScaleFactor: 1});
const provini = [];
let peggio = 0;
console.log(`  punto ${PUNTO}\n`);
console.log('  zoom   colonne%  righe%   esito');
for (const z of ZOOMS) {
  const p = await ctx.newPage();
  await p.goto(`${BASE}/preview/?single=left&zoom=${z}&c=${PUNTO}&only=__sola-ombra__`,
    {waitUntil: 'networkidle', timeout: 45000});
  await p.addStyleTag({content: '.pane h2,#err,.ol-control,#bar{display:none!important}'});
  await p.waitForTimeout(3800);
  const buf = await p.screenshot({clip: {x: 0, y: 0, width: 256, height: 256}});
  await p.close();
  const {data, info} = await sharp(buf).removeAlpha().greyscale().raw()
    .toBuffer({resolveWithObject: true});
  const col = anomale(data, info.width, info.height, true);
  const rig = anomale(data, info.width, info.height, false);
  peggio = Math.max(peggio, col, rig);
  console.log(`  z${String(z).padEnd(4)} ${col.toFixed(1).padStart(7)} ${rig.toFixed(1).padStart(8)}   ${Math.max(col, rig) <= SOGLIA ? 'ok' : 'STRISCE'}`);
  provini.push(await sharp(buf).normalise().resize(200, 200, {kernel: 'nearest'}).toBuffer());
}
await b.close();

const W = 200;
await sharp({create: {width: W * provini.length + 4 * (provini.length - 1), height: W, channels: 4, background: '#222'}})
  .composite(provini.map((x, k) => ({input: x, left: k * (W + 4), top: 0})))
  .png().toFile(OUT);
console.log(`\n  provini (contrasto esaltato): ${OUT}`);
console.log(peggio <= SOGLIA ? '  ok su tutta la scala' : `  peggiore ${peggio.toFixed(1)}%`);
process.exit(peggio <= SOGLIA ? 0 : 1);
