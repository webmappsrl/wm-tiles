/**
 * Contributo di ogni layer alla deviazione standard (il contrasto).
 *
 * Spegne un layer per volta e rimisura: se spegnendolo la sd si avvicina a
 * quella del riferimento, quel layer e' disegnato piu' marcato del dovuto.
 * Serve perche' la sd complessiva dice CHE siamo piu' contrastati, non DOVE.
 *
 * Uso: node tools/layer-contrib.mjs <z/x/y>
 */
import {chromium} from 'playwright';
import sharp from 'sharp';
import {readFileSync} from 'node:fs';

const [z, x, y] = (process.argv[2] ?? '10/541/371').split('/').map(Number);
const BASE = process.env.WM_BASE ?? 'http://localhost:8080';
const n = 2 ** z;
const lon = (x + 0.5) / n * 360 - 180;
const lat = 180 / Math.PI * Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 0.5) / n)));

const ref = await sharp(readFileSync(`data/ref-cache/${z}-${x}-${y}.png`))
  .removeAlpha().greyscale().stats();
const REF = ref.channels[0];

// i layer dello stile visibili a questo zoom: solo quelli hanno senso
const style = JSON.parse(readFileSync('style/webmapp.json', 'utf8'));
const ids = style.layers
  .filter(l => (l.minzoom ?? 0) <= z && (l.maxzoom ?? 24) >= z && l.type !== 'raster')
  .map(l => l.id);

const b = await chromium.launch({args: ['--use-gl=angle', '--enable-unsafe-swiftshader']});
const ctx = await b.newContext({viewport: {width: 256, height: 256}, deviceScaleFactor: 1});

const misura = async off => {
  const p = await ctx.newPage();
  const q = off ? `&off=${off}` : '';
  await p.goto(`${BASE}/preview/?single=left&zoom=${z}&c=${lon},${lat}${q}`,
    {waitUntil: 'networkidle', timeout: 45000});
  await p.addStyleTag({content: '.pane h2,#err,.ol-control,#bar{display:none!important}'});
  await p.waitForTimeout(3500);
  const s = await sharp(await p.screenshot({clip: {x: 0, y: 0, width: 256, height: 256}}))
    .removeAlpha().greyscale().stats();
  await p.close();
  return s.channels[0];
};

const base = await misura('');
console.log(`  riferimento   lum ${REF.mean.toFixed(1)}  sd ${REF.stdev.toFixed(1)}`);
console.log(`  locale        lum ${base.mean.toFixed(1)}  sd ${base.stdev.toFixed(1)}  (Δsd ${(base.stdev - REF.stdev).toFixed(1)})\n`);

const righe = [];
for (const id of ids) {
  const s = await misura(id);
  const d = s.stdev - base.stdev;
  if (Math.abs(d) >= 0.15) righe.push({id, d, lum: s.mean - base.mean});
}
righe.sort((a, b) => a.d - b.d);
console.log('  spegnendo…    Δsd    Δlum   (Δsd negativo = quel layer aggiunge contrasto)');
for (const r of righe) {
  console.log(`  ${(r.id + '                    ').slice(0, 22)} ${r.d.toFixed(2).padStart(6)} ${r.lum.toFixed(2).padStart(7)}`);
}
await b.close();
