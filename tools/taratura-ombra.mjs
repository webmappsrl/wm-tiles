/**
 * Taratura rapida di un parametro dell'ombra: una tile caricata una volta,
 * il parametro cambiato nella pagina, una misura per valore.
 *
 * zoom-diff.mjs ricarica la pagina per ogni misura (tre scatti, attese piene)
 * e costa circa un minuto a tile: provare cinque valori su quattro punti e
 * quattro livelli richiedeva ore. Qui la pagina si carica una volta sola, si
 * aspetta che l'ombra sia disegnata (DEM arrivato, `rendercomplete` piu'
 * l'attesa piena, come tile-diff), e poi si cambia solo il parametro: il DEM
 * e' gia' in memoria e ogni valore costa pochi secondi.
 *
 * Il riferimento viene dalla cache di tile-diff (data/ref-cache).
 *
 * Uso: node tools/taratura-ombra.mjs <opacity|gamma|vert|slope|el> <v1,v2,...> <z/x/y> [z/x/y ...]
 * (`el` e' l'elevazione del sole in gradi)
 */
import {chromium} from 'playwright';
import sharp from 'sharp';
import {existsSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';

const [param, valori, ...tiles] = process.argv.slice(2);
const PARAMETRI = ['opacity', 'gamma', 'vert', 'slope', 'el'];
if (!PARAMETRI.includes(param) || !valori || !tiles.length) {
  console.error('uso: taratura-ombra.mjs <opacity|gamma|vert|slope|el> <v1,v2,...> <z/x/y> [...]');
  process.exit(2);
}
const vs = valori.split(',').map(Number);
const fissi = (process.env.WM_FISSI ?? '').split(',').filter(Boolean).map(c => { const [n, v] = c.split('='); return [n, Number(v)]; });
if (fissi.some(([n, v]) => !PARAMETRI.includes(n) || !Number.isFinite(v))) {
  console.error('WM_FISSI vuole nome=valore,... fra opacity, gamma, vert, slope, el');
  process.exit(2);
}
if (fissi.length) console.log(`  fissi: ${fissi.map(([n, v]) => `${n}=${v}`).join(' ')}`);
const BASE = process.env.WM_BASE ?? 'http://localhost:8080';

const misura = async buf => {
  const st = await sharp(buf).removeAlpha().stats();
  const [r, g, b] = st.channels;
  return {lum: 0.299 * r.mean + 0.587 * g.mean + 0.114 * b.mean, sd: (r.stdev + g.stdev + b.stdev) / 3};
};

async function riferimento(t) {
  const [z, x, y] = t.split('/');
  const f = `data/ref-cache/${z}-${x}-${y}.png`;
  if (!existsSync(f)) {
    mkdirSync('data/ref-cache', {recursive: true});
    const r = await fetch(`https://api.webmapp.it/tiles/${t}.png`, {signal: AbortSignal.timeout(60000)});
    writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  }
  return misura(readFileSync(f));
}

const browser = await chromium.launch({args: ['--use-gl=angle', '--enable-unsafe-swiftshader']});
const righe = {};
for (const t of tiles) {
  const [z, x, y] = t.split('/').map(Number);
  const n = 2 ** z;
  const lon = ((x + 0.5) / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI;
  const p = await (await browser.newContext({viewport: {width: 256, height: 256}})).newPage();
  await p.goto(`${BASE}/preview/?single=left&zoom=${z}&c=${lon},${lat}`, {waitUntil: 'networkidle', timeout: 60000});
  await p.addStyleTag({content: '.pane h2, #err, .ol-control, #bar { display: none !important; }'});
  const disegna = () => p.evaluate(() => new Promise(res => {
    let fatto = false;
    const fine = () => { if (!fatto) { fatto = true; res(); } };
    window.__wm.left.once('rendercomplete', fine);
    window.__wm.left.render();
    setTimeout(fine, 20000);
  }));
  await disegna();
  await p.waitForTimeout(4500);
  const ref = await riferimento(t);
  const attuale = await p.evaluate(nome => {
    const l = window.__wm.shade?.layer;
    return nome === 'opacity' ? l?.getOpacity() : l?.get(`wm-${nome}`);
  }, param);
  // WM_FISSI="vert=1.4,gamma=0.6": parametri tenuti fermi mentre si prova l'altro,
  // per cercare due leve insieme (piu' esagerazione e un gamma diverso)
  for (const [nome, valore] of fissi) {
    await p.evaluate(([n, v]) => {
      const l = window.__wm.shade.layer;
      if (n === 'opacity') { l.setOpacity(v); return; }
      l.set(`wm-${n}`, v);
      const el = ((l.get('wm-el') ?? 45) * Math.PI) / 180;
      const vars = {vert: l.get('wm-vert'), gamma: l.get('wm-gamma'), slope: l.get('wm-slope'), passoDem: l.get('wm-passo'), sinEl: Math.sin(el), cosEl: Math.cos(el)};
      l.updateStyleVariables(vars);
      window.__wm.shade.pendenzaLayer?.updateStyleVariables?.(vars);
    }, [nome, valore]);
  }
  for (const v of vs) {
    await p.evaluate(([nome, valore]) => {
      const l = window.__wm.shade.layer;
      if (nome === 'opacity') { l.setOpacity(valore); return; }
      l.set(`wm-${nome}`, valore);
      const el = ((l.get('wm-el') ?? 45) * Math.PI) / 180;
      const vars = {vert: l.get('wm-vert'), gamma: l.get('wm-gamma'), slope: l.get('wm-slope'), passoDem: l.get('wm-passo'), sinEl: Math.sin(el), cosEl: Math.cos(el)};
      l.updateStyleVariables(vars);
      // Anche il layer della pendenza legge `vert` e il passo: aggiornare solo
      // quello della luce sottostimava lo scurimento dell'esagerazione.
      window.__wm.shade.pendenzaLayer?.updateStyleVariables?.(vars);
    }, [param, v]);
    await disegna();
    await p.waitForTimeout(800);
    const loc = await misura(await p.screenshot({clip: {x: 0, y: 0, width: 256, height: 256}}));
    (righe[v] ??= []).push({t, dl: loc.lum - ref.lum, ds: loc.sd - ref.sd});
  }
  console.log(`  ${t}: ${param} attuale ${attuale}`);
  await p.close();
}
await browser.close();

const f = v => (v >= 0 ? '+' : '') + v.toFixed(1);
console.log(`\n  ${param.padEnd(8)}${tiles.map(t => t.padStart(18)).join('')}${'media Δlum'.padStart(12)}${'media Δsd'.padStart(11)}`);
for (const v of vs) {
  const r = righe[v];
  const ml = r.reduce((s, x) => s + x.dl, 0) / r.length;
  const ms = r.reduce((s, x) => s + x.ds, 0) / r.length;
  console.log(`  ${String(v).padEnd(8)}${r.map(x => `${f(x.dl)} / ${f(x.ds)}`.padStart(18)).join('')}${f(ml).padStart(12)}${f(ms).padStart(11)}`);
}
