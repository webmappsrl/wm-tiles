import {chromium} from 'playwright';
const b = await chromium.launch({args:['--use-gl=angle','--enable-unsafe-swiftshader']});
const p = await (await b.newContext({viewport:{width:900,height:700}})).newPage();
const errs=[];
p.on('pageerror', e=>errs.push(e.message));
p.on('console', m=>m.type()==='error'&&errs.push(m.text()));
await p.goto('http://localhost:8080/preview/ol.html?area=appennino&zoom=14', {waitUntil:'networkidle', timeout:40000});
await p.waitForTimeout(4000);
const built = await p.evaluate(() => window.__built ?? null);
console.log('layer costruiti da ol-mapbox-style:');
for (const l of built ?? []) {
  console.log(`  ${String(l.kind).padEnd(18)} src=${String(l.source).padEnd(14)} vis=${l.visible}  mapbox-source=${l.mapboxSource ?? '-'}  layers=${(l.mapboxLayers||[]).slice(0,4).join(',')}${(l.mapboxLayers||[]).length>4?'…':''}`);
}
if (errs.length) console.log('\nerrori:\n  ' + errs.slice(0,6).join('\n  '));
await b.close();
