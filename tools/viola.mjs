/**
 * Quanti pixel di un certo colore ci sono nei due lati.
 *
 * Serve per elementi lineari che le medie non catturano: un confine
 * amministrativo occupa il 5% della tile nel riferimento, e se da noi ne
 * occupa l'1% la differenza si vede ma non compare in Δlum.
 *
 * Uso: node tools/viola.mjs <z/x/y>
 */
import {chromium} from 'playwright';
import sharp from 'sharp';
import {readFileSync} from 'node:fs';

const [z,x,y] = process.argv[2].split('/').map(Number);
const n = 2 ** z;
const lon = ((x + 0.5) / n) * 360 - 180;
const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI;

const b = await chromium.launch({args:['--use-gl=angle','--enable-unsafe-swiftshader']});
const p = await (await b.newContext({viewport:{width:256,height:256}})).newPage();
await p.goto(`http://localhost:8080/preview/?single=left&zoom=${z}&c=${lon},${lat}`,{waitUntil:'networkidle',timeout:45000});
await p.addStyleTag({content:'.pane h2,#err,.ol-control,#bar{display:none!important}'});
await p.waitForTimeout(5000);
const shot = await p.screenshot({clip:{x:0,y:0,width:256,height:256}});
await b.close();

const conta = async buf => {
  const {data, info} = await sharp(buf).removeAlpha().raw().toBuffer({resolveWithObject:true});
  let n2 = 0; const m = new Map();
  for (let i = 0; i < data.length; i += info.channels) {
    const [r,g,bl] = [data[i], data[i+1], data[i+2]];
    if (r - g > 20 && bl - g > 20) { n2++; m.set(`${r},${g},${bl}`, (m.get(`${r},${g},${bl}`) ?? 0) + 1); }
  }
  const top = [...m].sort((a,c)=>c[1]-a[1])[0];
  return {n: n2, tono: top ? top[0] : '-'};
};
const L = await conta(shot);
const R = await conta(readFileSync(`data/ref-cache/${z}-${x}-${y}.png`));
console.log(`  ${z}/${x}/${y} pixel viola:  locale ${L.n} (${L.tono})   riferimento ${R.n} (${R.tono})`);
