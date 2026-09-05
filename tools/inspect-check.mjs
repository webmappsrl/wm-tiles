/**
 * Verifica dell'ispezione interattiva della preview: che l'evidenza compaia
 * al passaggio del mouse e che il clic produca un rapporto con le voci utili.
 *
 * Uso: node tools/inspect-check.mjs [area] [zoom]
 */
import {chromium} from 'playwright';

const AREA = process.argv[2] ?? 'validazione';
const Z = process.argv[3] ?? '13';
const BASE = process.env.WM_BASE ?? 'http://localhost:8080';

const b = await chromium.launch({args: ['--use-gl=angle', '--enable-unsafe-swiftshader']});
const ctx = await b.newContext({viewport: {width: 1560, height: 700},
                                permissions: ['clipboard-read', 'clipboard-write']});
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => m.type() === 'error' && errs.push(m.text()));

await p.goto(`${BASE}/preview/?area=${AREA}&zoom=${Z}`, {waitUntil: 'networkidle', timeout: 45000});
await p.waitForTimeout(5000);

await p.click('#inspect');
await p.waitForTimeout(500);

// il mouse su un punto della mappa vettoriale, poi il clic
const box = await p.locator('#left').boundingBox();
const cx = Math.round(box.x + box.width * 0.45), cy = Math.round(box.y + box.height * 0.5);
await p.mouse.move(cx, cy);
await p.waitForTimeout(900);
const evidenziati = await p.evaluate(() =>
  window.__wm.left.getLayers().getArray()
    .filter(l => l.get('wm-evidenza'))
    .reduce((n, l) => n + l.getSource().getFeatures().length, 0));

await p.mouse.click(cx, cy);
await p.waitForTimeout(900);
const testo = await p.evaluate(() => document.querySelector('#inspectbox pre').textContent);
const visibile = await p.evaluate(() => document.getElementById('inspectbox').style.display);

await p.click('#inspectcopy');
await p.waitForTimeout(400);
const negliAppunti = await p.evaluate(() => navigator.clipboard.readText().catch(() => ''));

console.log(`  evidenza al passaggio: ${evidenziati} geometrie`);
console.log(`  riquadro dopo il clic: ${visibile || 'nascosto'}`);
console.log('  rapporto:');
for (const r of testo.split('\n').slice(0, 9)) console.log('    ' + r);
console.log(`  copia negli appunti: ${negliAppunti && negliAppunti === testo ? 'ok' : (negliAppunti ? 'parziale' : 'non verificabile')}`);
if (errs.length) console.log('  ⚠ errori: ' + errs.slice(0, 2).join(' | '));
await p.screenshot({path: 'data/tiles/ispezione.png'});
await b.close();
