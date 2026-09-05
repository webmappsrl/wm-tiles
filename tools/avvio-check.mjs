/**
 * L'avvio della preview non deve "lampeggiare".
 *
 * Il layer dell'ombreggiatura veniva riposizionato togliendolo e rimettendolo
 * nella collezione: un layer WebGL rimosso perde il contesto e per qualche
 * frame non disegna, quindi la mappa si schiariva di colpo. Succedeva dopo il
 * caricamento (a 800 e 2000 ms), cioe' proprio sotto gli occhi.
 *
 * Si campiona la luminosita' durante l'avvio: dopo che l'ombra e' presente,
 * non deve piu' risalire in modo brusco.
 */
import {chromium} from 'playwright';
import sharp from 'sharp';

const BASE = process.env.WM_BASE ?? 'http://localhost:8080';
const SOGLIA = Number(process.env.WM_SOGLIA ?? 6);   // punti di luminosita'
const b = await chromium.launch({args: ['--use-gl=angle', '--enable-unsafe-swiftshader']});
const p = await (await b.newContext({viewport: {width: 256, height: 256}, deviceScaleFactor: 1})).newPage();
await p.goto(`${BASE}/preview/?single=left&zoom=14&c=10.338,44.253`,
  {waitUntil: 'domcontentloaded', timeout: 45000});
await p.addStyleTag({content: '.pane h2,#err,.ol-control,#bar{display:none!important}'});

const serie = [];
for (let t = 0; t <= 6000; t += 400) {
  await p.waitForTimeout(400);
  const s = await sharp(await p.screenshot({clip: {x: 0, y: 0, width: 256, height: 256}}))
    .removeAlpha().greyscale().stats();
  serie.push({t: t + 400, lum: s.channels[0].mean});
}
await b.close();

// si ignora la fase iniziale, in cui la mappa si sta ancora componendo
const stabile = serie.slice(3);
const base = Math.min(...stabile.map(x => x.lum));
const lampi = stabile.filter(x => x.lum - base > SOGLIA);
for (const x of serie) {
  const flag = lampi.includes(x) ? '  ⚠ LAMPO' : '';
  console.log(`  ${String(x.t).padStart(4)}ms  lum ${x.lum.toFixed(1)}${flag}`);
}
console.log(lampi.length
  ? `\n  FALLITO: ${lampi.length} risalite oltre ${SOGLIA} punti dopo il caricamento`
  : `\n  ok: nessuna risalita oltre ${SOGLIA} punti`);
process.exit(lampi.length ? 1 : 0);
