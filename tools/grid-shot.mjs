/**
 * Screenshot con la griglia XYZ accesa, piu' un controllo che la griglia
 * esista davvero nei layer di entrambi i pannelli.
 *
 * Verifica anche il caso `?grid=<z>`: a livello forzato le tile disegnate
 * devono essere quelle di quel livello, non della vista.
 *
 * Uso: node tools/grid-shot.mjs [area] [out-dir]
 */
import {chromium} from 'playwright';
import {mkdirSync} from 'node:fs';

const AREA = process.argv[2] ?? 'prado';
const OUT = process.argv[3] ?? 'data/grid';
const BASE = process.env.WM_BASE ?? 'http://localhost:8080';

mkdirSync(OUT, {recursive: true});

const b = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=default', '--enable-unsafe-swiftshader'],
});
const ctx = await b.newContext({viewport: {width: 1560, height: 660}, deviceScaleFactor: 1});

const CASES = [
  ['griglia-z13', `?area=${AREA}&zoom=13&grid=on`, 13],
  ['griglia-z14', `?area=${AREA}&zoom=14&grid=on`, 14],
  ['griglia-z16', `?area=${AREA}&zoom=16&grid=on`, 16],
  ['griglia-fissa-z14', `?area=${AREA}&zoom=16&grid=14`, 14],
  ['griglia-spenta', `?area=${AREA}&zoom=14`, null],
];

let bad = 0;
for (const [name, qs, expectZ] of CASES) {
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await p.goto(`${BASE}/preview/${qs}`, {waitUntil: 'networkidle', timeout: 45000});
  await p.waitForTimeout(4000);

  const st = await p.evaluate(() => {
    const layers = m => m.getLayers().getArray().filter(l => l.get('wm-grid'));
    const dump = m => layers(m).map(l => ({
      visible: l.getVisible(),
      n: l.getSource().getFeatures().length,
      sample: l.getSource().getFeatures().slice(0, 2).map(f => f.get('label')),
    }));
    return {
      checked: document.getElementById('grid').checked,
      badge: document.getElementById('gridz').textContent,
      left: dump(window.__wm.left),
      right: dump(window.__wm.right),
    };
  });

  await p.screenshot({path: `${OUT}/${name}.png`});
  const zOf = s => s[0]?.sample[0]?.split('/')[0];
  const problems = [];
  if (expectZ === null) {
    if (st.left[0]?.visible || st.right[0]?.visible) problems.push('griglia visibile a interruttore spento');
  } else {
    if (st.left.length !== 1 || st.right.length !== 1) problems.push('la griglia non e' + "'" + ' su entrambi i pannelli');
    if (!st.left[0]?.n || !st.right[0]?.n) problems.push('nessuna tile disegnata');
    if (Number(zOf(st.left)) !== expectZ) problems.push(`livello ${zOf(st.left)}, atteso ${expectZ}`);
  }
  if (errs.length) problems.push(errs.slice(0, 2).join(' | '));
  bad += problems.length ? 1 : 0;
  console.log(`  ${problems.length ? '✗' : '✓'} ${name}  ${st.badge || '(spenta)'}  ` +
    `L=${st.left[0]?.n ?? 0} R=${st.right[0]?.n ?? 0} ${st.left[0]?.sample.join(' ') ?? ''}` +
    (problems.length ? `\n      ${problems.join('\n      ')}` : ''));
  await p.close();
}

await b.close();
process.exit(bad ? 1 : 0);
