/**
 * Verifica che oltre z16 lo stile continui a funzionare estendendo l'ultimo
 * livello derivato da TGen.
 *
 * Il riferimento raster finisce a z16, quindi da z17 in su non c'e' nulla con
 * cui confrontarsi: la regola e' tenere i parametri di z16. Il rischio non e'
 * un colore diverso, e' che qualcosa SPARISCA — un `maxzoom` di troppo, una
 * fascia d'ombra non trovata, un'espressione che degrada.
 *
 * Uso: node tools/oltre-z16.mjs [z1 z2 ...]
 */
import {chromium} from 'playwright';

const ZOOMS = process.argv.slice(2).map(Number);
const LIVELLI = ZOOMS.length ? ZOOMS : [16, 17, 18, 19];
const BASE = process.env.WM_BASE ?? 'http://localhost:8080';
const PUNTO = process.env.WM_PUNTO ?? '10.30832,44.21120';

const b = await chromium.launch({args: ['--use-gl=angle', '--enable-unsafe-swiftshader']});
const ctx = await b.newContext({viewport: {width: 400, height: 400}});
let base = null;
let esito = 0;
for (const z of LIVELLI) {
  const p = await ctx.newPage();
  await p.goto(`${BASE}/preview/?single=left&zoom=${z}&c=${PUNTO}`, {waitUntil: 'networkidle', timeout: 45000});
  await p.waitForTimeout(4000);
  const st = await p.evaluate(() => {
    const vis = (window.__wm?.left?.getLayers()?.getArray() ?? [])
      .filter(l => l.getVisible())
      .flatMap(l => l.get('mapbox-layers') ?? []);
    const ombra = [...document.querySelectorAll('#left canvas')]
      .filter(c => /wm-blend/.test(c.className))
      .map(c => getComputedStyle(c).mixBlendMode);
    return {
      err: document.getElementById('err')?.textContent?.trim().slice(0, 120) ?? '',
      layer: [...new Set(vis)].sort(),
      ombra,
    };
  });
  await p.close();
  if (z === LIVELLI[0]) base = st.layer;
  const persi = base.filter(x => !st.layer.includes(x));
  const ok = !st.err && persi.length === 0 && st.ombra.includes('multiply');
  if (!ok) esito = 1;
  console.log(`  z${z}: ${st.layer.length} layer, ombra [${st.ombra.join(', ') || 'ASSENTE'}]` +
    (persi.length ? `  ⚠ persi: ${persi.join(', ')}` : '') +
    (st.err ? `  ⚠ ${st.err}` : ''));
}
await b.close();
console.log(esito ? '\n  FALLITO' : `\n  ok: da z${LIVELLI[0]} in su nulla sparisce e l'ombra resta composta`);
process.exit(esito);
