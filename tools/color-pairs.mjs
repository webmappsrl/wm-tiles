/**
 * Confronto posizionale dei colori: pixel per pixel, quali coppie
 * (locale -> riferimento) sono piu' frequenti.
 *
 * Le medie dicono "piu' scuro di 13 punti" ma non dicono su cosa. Questo dice
 * "dove disegniamo #becbae, il riferimento ha #d6decc": da li' si risale alla
 * classe o al layer responsabile, invece di procedere per ipotesi.
 *
 * I colori sono quantizzati per raggruppare l'antialiasing, e si escludono i
 * pixel dove i due lati coincidono.
 *
 * Uso: node tools/color-pairs.mjs <z/x/y> [passo-quantizzazione]
 */
import {chromium} from 'playwright';
import sharp from 'sharp';
import {existsSync, readFileSync} from 'node:fs';

const spec = process.argv[2];
const Q = Number(process.argv[3] ?? 8);
const [z, x, y] = spec.split('/').map(Number);
const BASE = process.env.WM_BASE ?? 'http://localhost:8080';
const cache = `${process.env.WM_REF_CACHE ?? 'data/ref-cache'}/${z}-${x}-${y}.png`;
if (!existsSync(cache)) {
  console.error(`  riferimento non in cache: ${cache}\n  scaricalo con tools/fill-ref-cache.mjs`);
  process.exit(1);
}

const n = 2 ** z;
const lon = ((x + 0.5) / n) * 360 - 180;
const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI;

const b = await chromium.launch({args: ['--use-gl=angle', '--enable-unsafe-swiftshader']});
const p = await (await b.newContext({viewport: {width: 256, height: 256}, deviceScaleFactor: 1})).newPage();
await p.goto(`${BASE}/preview/?single=left&zoom=${z}&c=${lon},${lat}`, {waitUntil: 'networkidle', timeout: 45000});
await p.addStyleTag({content: '.pane h2, #err, .ol-control, #bar { display: none !important; }'});
let best = null, bestLum = Infinity;
for (let k = 0; k < 3; k++) {
  if (k) { await p.reload({waitUntil: 'networkidle', timeout: 45000});
           await p.addStyleTag({content: '.pane h2, #err, .ol-control, #bar { display: none !important; }'}); }
  await p.waitForTimeout(4200);
  const buf = await p.screenshot({clip: {x: 0, y: 0, width: 256, height: 256}});
  const st = await sharp(buf).removeAlpha().stats();
  const lum = 0.299 * st.channels[0].mean + 0.587 * st.channels[1].mean + 0.114 * st.channels[2].mean;
  if (lum < bestLum) { bestLum = lum; best = buf; }
}
await b.close();

const raw = async buf => (await sharp(buf).removeAlpha().raw().toBuffer({resolveWithObject: true}));
const L = await raw(best);
const R = await raw(readFileSync(cache));

const q = v => Math.round(v / Q) * Q;
const hex = (r, g, bl) => '#' + [r, g, bl].map(v => Math.min(255, v).toString(16).padStart(2, '0')).join('');
const coppie = new Map();
for (let i = 0; i < L.data.length; i += L.info.channels) {
  const a = [q(L.data[i]), q(L.data[i + 1]), q(L.data[i + 2])];
  const c = [q(R.data[i]), q(R.data[i + 1]), q(R.data[i + 2])];
  if (a[0] === c[0] && a[1] === c[1] && a[2] === c[2]) continue;
  const k = `${hex(...a)}|${hex(...c)}`;
  coppie.set(k, (coppie.get(k) ?? 0) + 1);
}
const tot = 256 * 256;
const uguali = tot - [...coppie.values()].reduce((a, v) => a + v, 0);
console.log(`  ${spec}: ${((uguali / tot) * 100).toFixed(0)}% dei pixel coincide (quantizzato a ${Q})`);
console.log(`  ${'locale'.padEnd(10)} ${'riferimento'.padEnd(12)} px    Δlum   Δsat(g-b)`);
for (const [k, v] of [...coppie].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  const [a, c] = k.split('|');
  const px = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16));
  const [ar, ag, ab] = px(a), [cr, cg, cb] = px(c);
  const lum = v2 => 0.299 * v2[0] + 0.587 * v2[1] + 0.114 * v2[2];
  const d = (u, w) => (u - w >= 0 ? '+' : '') + (u - w).toFixed(0);
  console.log(`  ${a.padEnd(10)} ${c.padEnd(12)} ${String(v).padStart(5)}  ${d(lum([ar,ag,ab]), lum([cr,cg,cb])).padStart(6)}  ${d(ag-ab, cg-cb).padStart(6)}`);
}
