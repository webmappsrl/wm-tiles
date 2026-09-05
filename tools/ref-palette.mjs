/**
 * Colori dominanti del riferimento, per livello di zoom, sullo stesso punto.
 *
 * Serve a stabilire se il riferimento cambia colore con lo zoom invece di
 * dedurlo: la tabella `#clc` di webmapp.mss e' unica per z7-13, ma il colore
 * che arriva a schermo passa per l'ombreggiatura (opacita' diversa per
 * fascia), la gamma dei poligoni e la fonte di uso suolo, che a z14 cambia.
 *
 * Uso: node tools/ref-palette.mjs [lon,lat] [zmin] [zmax]
 */
import sharp from 'sharp';
import {chromium} from 'playwright';

const [lon, lat] = (process.argv[2] ?? '10.72,44.21').split(',').map(Number);
const ZMIN = Number(process.argv[3] ?? 10);
const ZMAX = Number(process.argv[4] ?? 16);
const LEGACY = process.env.WM_LEGACY ?? 'https://api.webmapp.it/tiles';

const BASE = process.env.WM_BASE ?? 'http://localhost:8080';
const hex = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');

/** Verde dominante e sua saturazione (g-b), su un buffer PNG. */
const greenOf = async buf => {
  const {data, info} = await sharp(buf).removeAlpha().raw().toBuffer({resolveWithObject: true});
  const m = new Map();
  for (let i = 0; i < data.length; i += info.channels) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    if (g > r && g > b && g - b > 8) m.set(`${r},${g},${b}`, (m.get(`${r},${g},${b}`) ?? 0) + 1);
  }
  const top = [...m].sort((a, b) => b[1] - a[1])[0];
  if (!top) return null;
  const [r, g, b] = top[0].split(',').map(Number);
  return {hex: hex(r, g, b), r, g, b, sat: g - b,
          quota: [...m.values()].reduce((a, v) => a + v, 0) / (info.width * info.height)};
};

const browser = await chromium.launch({args: ['--use-gl=angle', '--enable-unsafe-swiftshader']});
const ctx = await browser.newContext({viewport: {width: 256, height: 256}, deviceScaleFactor: 1});

/** Lo stesso scatto del locale usato da tile-diff: piu' scuro fra tre. */
const localShot = async (z, clon, clat) => {
  const p = await ctx.newPage();
  await p.goto(`${BASE}/preview/?single=left&zoom=${z}&c=${clon},${clat}`,
    {waitUntil: 'networkidle', timeout: 45000});
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
  await p.close();
  return best;
};

for (let z = ZMIN; z <= ZMAX; z++) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(
    ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n,
  );
  const res = await fetch(`${LEGACY}/${z}/${x}/${y}.png`);
  if (!res.ok) { console.log(`  z${z}: HTTP ${res.status}`); continue; }
  const png = await res.arrayBuffer();
  const R = await greenOf(Buffer.from(png));
  const n2 = 2 ** z;
  const clon = ((x + 0.5) / n2) * 360 - 180;
  const clat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n2))) * 180) / Math.PI;
  const L = await greenOf(await localShot(z, clon, clat));
  const d = (a, b) => (a - b >= 0 ? '+' : '') + (a - b).toFixed(0);
  console.log(`  z${String(z).padEnd(3)} ${(z + '/' + x + '/' + y).padEnd(17)}` +
    `locale ${L ? `${L.hex} sat ${String(L.sat).padStart(2)} area ${(L.quota*100).toFixed(0)}%` : '(nessun verde)'}   ` +
    `tgen ${R ? `${R.hex} sat ${String(R.sat).padStart(2)} area ${(R.quota*100).toFixed(0)}%` : '(nessuno)'}   ` +
    (L && R ? `Δsat ${d(L.sat, R.sat)}  Δlum ${d(0.299*L.r+0.587*L.g+0.114*L.b, 0.299*R.r+0.587*R.g+0.114*R.b)}` : ''));
}

await browser.close();
