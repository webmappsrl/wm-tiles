/**
 * Verifica che l'ombra cada dal lato giusto.
 *
 * Con luce da Nord-Ovest (azimut 315) un versante rivolto a NO e' PIU' CHIARO
 * di uno rivolto a SE. Se il segno di dz/dy si inverte le vette si leggono
 * come valli: nessun errore, nessuno scarto nelle medie, e la mappa e'
 * sbagliata. Si confrontano i due lati di un crinale noto.
 */
import {chromium} from 'playwright';
import sharp from 'sharp';

const BASE = process.env.WM_BASE ?? 'http://localhost:8080';
const b = await chromium.launch({args: ['--use-gl=angle', '--enable-unsafe-swiftshader']});
const ctx = await b.newContext({viewport: {width: 256, height: 256}, deviceScaleFactor: 1});

// Monte Cusna: la vetta sta al centro, i versanti tutt'attorno
const p = await ctx.newPage();
await p.goto(`${BASE}/preview/?single=left&zoom=14&c=10.4055,44.2946&only=__sola-ombra__`,
  {waitUntil: 'networkidle', timeout: 45000});
await p.addStyleTag({content: '.pane h2,#err,.ol-control,#bar{display:none!important}'});
await p.waitForTimeout(4000);
const {data, info} = await sharp(await p.screenshot({clip: {x: 0, y: 0, width: 256, height: 256}}))
  .removeAlpha().greyscale().raw().toBuffer({resolveWithObject: true});
await b.close();

const media = (x0, y0, x1, y1) => {
  let s = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += data[y * info.width + x]; n++; }
  return s / n;
};
const NO = media(20, 20, 110, 110);      // quadrante Nord-Ovest
const SE = media(146, 146, 236, 236);    // quadrante Sud-Est
console.log(`  quadrante Nord-Ovest: ${NO.toFixed(1)}`);
console.log(`  quadrante Sud-Est   : ${SE.toFixed(1)}`);
const ok = NO > SE;
console.log(ok
  ? `\n  ok: il lato verso il sole e' piu' chiaro (differenza ${(NO - SE).toFixed(1)})`
  : `\n  FALLITO: l'ombra e' INVERTITA — il lato verso il sole e' piu' scuro di ${(SE - NO).toFixed(1)}`);
process.exit(ok ? 0 : 1);
