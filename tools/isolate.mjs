/** Misura la luminosita' media del solo pannello locale, per un sottoinsieme di layer. */
import {chromium} from 'playwright';
import sharp from 'sharp';
const CASES = process.argv.slice(2);
const b = await chromium.launch({args:['--use-gl=angle','--enable-unsafe-swiftshader']});
const ctx = await b.newContext({viewport:{width:780,height:620}});
for (const c of CASES) {
  const p = await ctx.newPage();
  await p.goto(`http://localhost:8080/preview/?area=appennino&zoom=14&single=left&${c}`,
    {waitUntil:'networkidle', timeout:40000});
  await p.waitForTimeout(4000);
  const buf = await p.screenshot();
  const st = await sharp(buf).stats();
  const [r,g,bl] = st.channels.slice(0,3).map(x=>x.mean);
  console.log(`  ${c.padEnd(52)} rgb(${r.toFixed(0)},${g.toFixed(0)},${bl.toFixed(0)}) lum ${(0.299*r+0.587*g+0.114*bl).toFixed(1)}`);
  await p.close();
}
await b.close();
console.log('  (riferimento TGEN a z14: rgb(190,197,181) lum 192.9)');
