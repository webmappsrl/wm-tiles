/**
 * Distribuzione dei toni scuri, locale contro riferimento.
 *
 * Le medie non dicono nulla su curve di livello e linee sottili, che occupano
 * pochi pixel: quello che conta e' quanto scuri sono i pixel piu' scuri. I
 * percentili bassi della luminosita' misurano proprio quello, e permettono di
 * decidere larghezza e opacita' con un numero invece che a occhio.
 *
 * Uso: node tools/dark-profile.mjs <z/x/y>
 */
import {chromium} from 'playwright';
import sharp from 'sharp';
import {existsSync, readFileSync} from 'node:fs';

const [z, x, y] = process.argv[2].split('/').map(Number);
const BASE = process.env.WM_BASE ?? 'http://localhost:8080';
const cache = `${process.env.WM_REF_CACHE ?? 'data/ref-cache'}/${z}-${x}-${y}.png`;
if (!existsSync(cache)) { console.error(`  riferimento non in cache: ${cache}`); process.exit(1); }

const n = 2 ** z;
const lon = ((x + 0.5) / n) * 360 - 180;
const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI;

const b = await chromium.launch({args: ['--use-gl=angle', '--enable-unsafe-swiftshader']});
const p = await (await b.newContext({viewport: {width: 256, height: 256}})).newPage();
await p.goto(`${BASE}/preview/?single=left&zoom=${z}&c=${lon},${lat}`, {waitUntil: 'networkidle', timeout: 45000});
await p.addStyleTag({content: '.pane h2, #err, .ol-control, #bar { display: none !important; }'});
await p.waitForTimeout(5000);
const shot = await p.screenshot({clip: {x: 0, y: 0, width: 256, height: 256}});
await b.close();

const lums = async buf => {
  const {data, info} = await sharp(buf).removeAlpha().raw().toBuffer({resolveWithObject: true});
  const v = [];
  for (let i = 0; i < data.length; i += info.channels)
    v.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  return v.sort((a, c) => a - c);
};
const L = await lums(shot);
const R = await lums(readFileSync(cache));
const pc = (v, q) => v[Math.floor(v.length * q)];

console.log(`  ${z}/${x}/${y} — percentili di luminosita' (bassi = ombre e linee, alti = zone chiare)`);
console.log(`  ${'percentile'.padEnd(12)}${'locale'.padStart(8)}${'tgen'.padStart(8)}${'Δ'.padStart(8)}`);
for (const q of [0.01, 0.05, 0.25, 0.50, 0.75, 0.95, 0.99]) {
  const a = pc(L, q), c = pc(R, q);
  console.log(`  ${(q * 100 + '%').padEnd(12)}${a.toFixed(0).padStart(8)}${c.toFixed(0).padStart(8)}` +
    `${((a - c >= 0 ? '+' : '') + (a - c).toFixed(0)).padStart(8)}`);
}
// quanti pixel sono "linea": scuri rispetto alla mediana della tile
const soglia = v => pc(v, 0.5) - 22;
const conta = (v, s) => v.filter(x => x < s).length;
console.log(`  pixel di linea (sotto mediana-22):  locale ${conta(L, soglia(L))}   tgen ${conta(R, soglia(R))}`);
