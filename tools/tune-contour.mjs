/**
 * Taratura della marcatura delle curve di livello.
 *
 * Il riferimento le disegna con `line-width: 0.6` (1,2 per le principali) e
 * `comp-op: multiply`, ma Mapnik rende una linea sotto il pixel piu' densa di
 * quanto faccia un canvas: con gli stessi numeri le nostre curve risultano
 * sbiadite. Si tara quindi sul risultato — quanti pixel di linea e quanto
 * scuri — invece che sui valori nominali.
 *
 * Uso: node tools/tune-contour.mjs <fattore;fattore;...> <z/x/y>
 */
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';

const fattori = (process.argv[2] ?? '1;1.5;2').split(';').map(Number);
const tile = process.argv[3] ?? '13/4331/2970';
const BASE_LAYERS = 'style/base-layers.json';
const originale = readFileSync(BASE_LAYERS, 'utf8');

/** Moltiplica tutti i valori numerici dentro l'espressione di line-width. */
const scala = (expr, k) =>
  Array.isArray(expr) ? expr.map(v => scala(v, k))
    : typeof expr === 'number' ? Math.round(v => 0) : expr;

try {
  for (const k of fattori) {
    const b = JSON.parse(originale);
    const l = b.layers.find(x => x.id === 'contour');
    const w = JSON.parse(JSON.stringify(l.paint['line-width']));
    // gli stop di `interpolate` sono [zoom, valore, zoom, valore, ...]: si
    // scalano i valori, che qui sono espressioni `case` con due larghezze
    const scalaCase = c => Array.isArray(c)
      ? c.map(v => (typeof v === 'number' && v < 10 ? Number((v * k).toFixed(2)) : scalaCase(v)))
      : c;
    for (let i = 4; i < w.length; i += 2) w[i] = scalaCase(w[i]);
    l.paint['line-width'] = w;
    writeFileSync(BASE_LAYERS, JSON.stringify(b, null, 2));
    execFileSync('node', ['pipeline/build-style.mjs'], {encoding: 'utf8'});

    const out = execFileSync('node', ['tools/dark-profile.mjs', tile], {encoding: 'utf8'});
    const px = /pixel di linea[^:]*:\s*locale (\d+)\s+tgen (\d+)/.exec(out);
    const p5 = /^\s*5%\s+(\d+)\s+(\d+)/m.exec(out);
    console.log(`  larghezza x${k}:  pixel di linea ${px?.[1] ?? '?'} (riferimento ${px?.[2] ?? '?'})` +
      `   5° percentile ${p5?.[1] ?? '?'} vs ${p5?.[2] ?? '?'}`);
  }
} finally {
  writeFileSync(BASE_LAYERS, originale);
  execFileSync('node', ['pipeline/build-style.mjs'], {encoding: 'utf8'});
  console.log('  layer di base ripristinati');
}
