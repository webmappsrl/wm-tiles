/**
 * Confronto visivo automatico fra il prototipo locale e il riferimento raster.
 *
 * Apre la preview in un browser headless e ne salva uno screenshot per ogni
 * area/zoom: i due pannelli condividono la vista, quindi le scale coincidono
 * per costruzione. Serve un browser headless perche' un tab in background
 * non riceve requestAnimationFrame e la mappa non renderizza.
 *
 * Uso: node tools/compare.mjs [out-dir]
 */
import {chromium} from 'playwright';
import sharp from 'sharp';

/** Etichetta della colonna, come banda SVG sopra ciascun pannello. */
const label = async (text, w) =>
  Buffer.from(
    `<svg width="${w}" height="22" xmlns="http://www.w3.org/2000/svg">
       <rect width="${w}" height="22" fill="#23211d"/>
       <text x="8" y="15" font-family="system-ui,sans-serif" font-size="12" fill="#ece7dc">${text}</text>
     </svg>`,
  );
import {mkdirSync} from 'node:fs';

const OUT = process.argv[2] ?? 'data/compare';
const BASE = process.env.WM_BASE ?? 'http://localhost:8080';
const W = 1560;
const H = 660;

/** Aree e zoom su cui si valuta la somiglianza. Dentro il bbox dell'area demo. */
const SHOTS = [
  {id: 'pradarena-z13', area: 'appennino', zoom: 13},
  {id: 'pradarena-z14', area: 'appennino', zoom: 14},
  {id: 'pradarena-z15', area: 'appennino', zoom: 15},
  {id: 'crinale-z12', area: 'crinale', zoom: 12},
  {id: 'valle-z14', area: 'valle', zoom: 14},
  {id: 'insediamento-z15', area: 'insediamento', zoom: 15},
];


mkdirSync(OUT, {recursive: true});

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=default', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({viewport: {width: W, height: H}, deviceScaleFactor: 1});


const problems = [];
for (const s of SHOTS) {
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await p.goto(`${BASE}/preview/?area=${s.area}&zoom=${s.zoom}`,
    {waitUntil: 'networkidle', timeout: 45000});
  await p.waitForTimeout(4500);
  const shown = await p.evaluate(() => {
    const e = document.getElementById('err');
    return e && e.style.display !== 'none' ? e.textContent : null;
  });
  if (shown) errs.push(shown);
  // Ritaglio i due pannelli dai loro riquadri e li affianco: includere la
  // barra dei controlli nello screenshot inquina le misure (la sua altezza
  // cambia col numero di interruttori).
  const bl = await p.locator('#left').boundingBox();
  const br = await p.locator('#right').boundingBox();
  const left = await p.screenshot({clip: bl});
  const right = await p.screenshot({clip: br});
  const H2 = Math.round(Math.min(bl.height, br.height));
  const W2 = Math.round(Math.min(bl.width, br.width));
  await sharp({create: {width: W2 * 2 + 6, height: H2 + 22, channels: 4, background: '#23211d'}})
    .composite([
      {input: await label(`LOCALE (OpenLayers) — ${s.id}`, W2), left: 0, top: 0},
      {input: await label(`TGEN (riferimento) — ${s.id}`, W2), left: W2 + 6, top: 0},
      {input: await sharp(left).extract({left: 0, top: 0, width: W2, height: H2}).toBuffer(), left: 0, top: 22},
      {input: await sharp(right).extract({left: 0, top: 0, width: W2, height: H2}).toBuffer(), left: W2 + 6, top: 22},
    ])
    .png()
    .toFile(`${OUT}/${s.id}.png`);
  await p.close();
  if (errs.length) problems.push(`${s.id}: ${errs.slice(0, 3).join(' | ')}`);
  console.log(`  ${OUT}/${s.id}.png`);
}

await browser.close();
if (problems.length) {
  console.log('\nproblemi rilevati:');
  for (const p of problems) console.log('  ' + p);
}
