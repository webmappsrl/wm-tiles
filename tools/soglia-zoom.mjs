// A quale zoom frazionario ciascun pannello cambia livello: colore del mare
// al centro (z12 #acd4ea, z13 #dce7f7), livello delle tile di TGen e di quelle
// vettoriali richieste. I due pannelli devono cambiare insieme, a N - 0,585.
//
// Uso: node tools/soglia-zoom.mjs <z0,z1,passo,lon,lat>   (centro sul mare)
import {chromium} from 'playwright';
const BASE = process.env.WM_BASE ?? 'http://localhost:8080';
const [z0, z1, passo, lon, lat] = (process.argv[2] ?? '12,13,0.1,10.20,43.68').split(',').map(Number);
const b = await chromium.launch();
for (let z = z0; z <= z1 + 1e-9; z += passo) {
  const p = await b.newPage({viewport: {width: 1200, height: 600}});
  const tgenZ = new Set(), vetZ = new Set();
  p.on('request', r => { const m = r.url().match(/webmapp\.it\/tiles\/(\d+)\//); if (m) tgenZ.add(+m[1]);
    const v = r.url().match(/\/t\/[^/]+\/[^/]+\/osm\/(\d+)\//); if (v) vetZ.add(+v[1]); });
  await p.goto(`${BASE}/preview/?zoom=${z.toFixed(2)}&c=${lon},${lat}`);
  await p.waitForTimeout(7000);
  const box = async id => p.locator('#' + id).boundingBox();
  const L = await box('left'), R = await box('right');
  const img = await p.screenshot();
  const sharp = (await import('sharp')).default;
  const {data, info} = await sharp(img).removeAlpha().raw().toBuffer({resolveWithObject: true});
  const px = (bx) => { const x = Math.round(bx.x + bx.width / 2), y = Math.round(bx.y + bx.height / 2); const i = (y * info.width + x) * 3; return [data[i], data[i + 1], data[i + 2]]; };
  const tipo = c => (c[2] > 240 && c[0] > 200 ? 'z13+' : c[0] < 190 ? 'z12-' : '?');
  const l = px(L), r = px(R);
  console.log(`zoom ${z.toFixed(2)}  locale ${l} ${tipo(l)}  |  tgen ${r} ${tipo(r)}  tile TGen z=${[...tgenZ].sort().join(',')}  tile vettoriali z=${[...vetZ].sort().join(',')}`);
  await p.close();
}
await b.close();
