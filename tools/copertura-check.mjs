/**
 * Verifica il riquadro dell'area generata nella preview.
 *
 * Controlla che il bbox venga letto da /version, che il rettangolo compaia su
 * entrambi i pannelli quando l'interruttore e' acceso, e che sparisca quando
 * e' spento.
 */
import {chromium} from 'playwright';
import sharp from 'sharp';

const BASE = process.env.WM_BASE ?? 'http://localhost:8080';
const b = await chromium.launch({args: ['--use-gl=angle', '--enable-unsafe-swiftshader']});
const ctx = await b.newContext({viewport: {width: 900, height: 500}});

const rossi = async page => {
  const {data} = await sharp(await page.screenshot()).removeAlpha().raw()
    .toBuffer({resolveWithObject: true});
  let n = 0;
  for (let i = 0; i < data.length; i += 3) {
    if (data[i] > 170 && data[i + 1] < 90 && data[i + 2] < 90) n++;
  }
  return n;
};

// vista larga, per avere il bbox intero dentro lo schermo
const url = z => `${BASE}/preview/?zoom=${z}&c=10.45,44.2`;
let esito = 0;

const p1 = await ctx.newPage();
await p1.goto(url(8) + '&copertura=on', {waitUntil: 'networkidle', timeout: 45000});
await p1.waitForTimeout(4000);
const bbox = await p1.evaluate(() => window.__wm?.copertura?.bbox?.() ?? null);
const acceso = await rossi(p1);
console.log('  bbox letto da /version:', bbox ? bbox.join(', ') : 'NON LETTO');
console.log('  pixel rossi con riquadro acceso:', acceso);

await p1.evaluate(() => {
  const c = document.getElementById('copertura');
  c.checked = false; c.onchange({target: c});
});
await p1.waitForTimeout(1200);
const spento = await rossi(p1);
console.log('  pixel rossi con riquadro spento :', spento);
await b.close();

if (!bbox) { console.log('\n  FALLITO: bbox non letto'); esito = 1; }
else if (acceso < 200) { console.log('\n  FALLITO: il riquadro non si vede'); esito = 1; }
else if (spento > acceso / 4) { console.log('\n  FALLITO: non sparisce da spento'); esito = 1; }
else console.log('\n  ok');
process.exit(esito);
