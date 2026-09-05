/**
 * Serie di confronti per livello di zoom, sulla stessa area.
 *
 * Il riferimento raster e' servito da z6 a z16 (verificato: z17 -> 404), e le
 * differenze cambiano natura con la scala: alle scale piccole contano paesi,
 * strade principali e confini; a quelle grandi sentieri, curve e POI. Una
 * serie per zoom permette di validare un livello alla volta.
 *
 * Uso: node tools/zoom-series.mjs [zoom-min] [zoom-max] [area] [out-dir]
 */
import {chromium} from 'playwright';
import sharp from 'sharp';
import {mkdirSync} from 'node:fs';

const ZMIN = Number(process.argv[2] ?? 10);
const ZMAX = Number(process.argv[3] ?? 16);
const AREA = process.argv[4] ?? 'validazione';
const OUT = process.argv[5] ?? 'data/zoom';
const BASE = process.env.WM_BASE ?? 'http://localhost:8080';
const W = 1560;
const H = 700;

const label = async (text, w) =>
  Buffer.from(
    `<svg width="${w}" height="22" xmlns="http://www.w3.org/2000/svg">
       <rect width="${w}" height="22" fill="#23211d"/>
       <text x="8" y="15" font-family="system-ui,sans-serif" font-size="12" fill="#ece7dc">${text}</text>
     </svg>`,
  );

mkdirSync(OUT, {recursive: true});
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=default', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({viewport: {width: W, height: H}, deviceScaleFactor: 1});

for (let z = ZMIN; z <= ZMAX; z++) {
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await p.goto(`${BASE}/preview/?area=${AREA}&zoom=${z}`, {waitUntil: 'networkidle', timeout: 45000});
  await p.waitForTimeout(4500);
  const bl = await p.locator('#left').boundingBox();
  const br = await p.locator('#right').boundingBox();
  const left = await p.screenshot({clip: bl});
  const right = await p.screenshot({clip: br});
  const w2 = Math.round(Math.min(bl.width, br.width));
  const h2 = Math.round(Math.min(bl.height, br.height));
  const file = `${OUT}/z${String(z).padStart(2, '0')}.png`;
  await sharp({create: {width: w2 * 2 + 6, height: h2 + 22, channels: 4, background: '#23211d'}})
    .composite([
      {input: await label(`LOCALE (OpenLayers) — z${z}`, w2), left: 0, top: 0},
      {input: await label(`TGEN (riferimento) — z${z}`, w2), left: w2 + 6, top: 0},
      {input: await sharp(left).extract({left: 0, top: 0, width: w2, height: h2}).toBuffer(), left: 0, top: 22},
      {input: await sharp(right).extract({left: 0, top: 0, width: w2, height: h2}).toBuffer(), left: w2 + 6, top: 22},
    ])
    .png()
    .toFile(file);
  console.log(`  ${file}${errs.length ? '  ⚠ ' + errs[0] : ''}`);
  await p.close();
}
await browser.close();
