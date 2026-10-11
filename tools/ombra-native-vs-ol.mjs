#!/usr/bin/env node
/**
 * L'ombreggiatura dei PNG (CPU, src/raster/ombra.js) deve restare quella delle
 * app (WebGL, src/preview/public/hillshade.js): sono due implementazioni delle
 * stesse formule, e una modifica a una sola delle due non da' errori.
 *
 * Rende le sole superfici, con l'ombra sopra, con i due renderer
 * (pipeline/render-png.mjs e pipeline/render-png-ol.mjs) su tile di rilievo a
 * piu' livelli, e confronta pixel per pixel. Esce 1 se lo scarto medio supera
 * 2 livelli di grigio o la luminosita' media si sposta di piu' di 1: misurate
 * l'11 ottobre 2026, le due ombre differivano di meno di 1,1 e 0,4.
 *
 * Serve il server acceso.
 *   node tools/ombra-native-vs-ol.mjs [z/x/y ...]
 */
import {execFileSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';

// Monte Pisano da z12 a z16, piu' due livelli in Sicilia
const tiles = process.argv.slice(2).length ? process.argv.slice(2)
  : ['12/2167/1493', '13/4334/2986', '14/8669/5973', '15/17339/11946', '16/34679/23893', '13/4424/3175', '15/17699/12702'];
const SUPERFICI = 'background,landcover-osm,landcover-fill,clc-fill';

const dir = mkdtempSync(join(tmpdir(), 'ombra-'));
try {
  const lista = join(dir, 'tile.txt');
  writeFileSync(lista, tiles.join('\n') + '\n');
  execFileSync('node', ['pipeline/render-png.mjs', '--tiles', lista, '--out', join(dir, 'nativo'), '--only', SUPERFICI], {stdio: 'ignore'});
  execFileSync('node', ['pipeline/render-png-ol.mjs', '--tiles', lista, '--out', join(dir, 'ol'), '--query', `&only=${SUPERFICI}`], {stdio: 'ignore'});

  const lum = b => { let s = 0; for (let i = 0; i < b.length; i += 3) s += 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2]; return s / (b.length / 3); };
  let peggiore = 0;
  for (const t of tiles) {
    const [a, b] = await Promise.all(['nativo', 'ol'].map(d => sharp(join(dir, d, `${t}.png`)).removeAlpha().raw().toBuffer()));
    let d = 0;
    for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
    d /= a.length;
    const dl = lum(a) - lum(b);
    const ko = d > 2 || Math.abs(dl) > 1;
    peggiore = Math.max(peggiore, ko ? 1 : 0);
    console.log(`${t.padEnd(16)} scarto medio ${d.toFixed(2)}  luminosita' ${dl >= 0 ? '+' : ''}${dl.toFixed(2)}${ko ? '  <-- DIVERGE' : ''}`);
  }
  if (peggiore) {
    console.error('le due ombreggiature divergono: allinea src/raster/ombra.js e src/preview/public/hillshade.js');
    process.exit(1);
  }
  console.log('ok: l\'ombra dei PNG coincide con quella delle app');
} finally {
  rmSync(dir, {recursive: true, force: true});
}
