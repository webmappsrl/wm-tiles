/**
 * Valida lo style.json contro la MapLibre Style Spec.
 * Un errore di validazione fa rifiutare l'INTERO stile dal renderer: la mappa
 * resta bianca senza spiegazioni nella pagina. Va quindi verificato prima di
 * servirlo, non dopo averlo guardato.
 *
 * Uso: node pipeline/validate-style.mjs [file | url]
 */
import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import {readFileSync} from 'node:fs';

const target = process.argv[2] ?? 'http://localhost:8080/style.json';

const style = target.startsWith('http')
  ? await (await fetch(target)).json()
  : JSON.parse(readFileSync(target, 'utf8'));

// Lo stile su disco non ha ancora le sources (le inietta il server): per la
// validazione le si dichiarano vuote, cosi' i riferimenti risolvono.
if (!style.sources || Object.keys(style.sources).length === 0) {
  // Il tipo della sorgente si deduce dal tipo dei layer che la usano:
  // un layer `raster` richiede una sorgente raster, gli altri una vector.
  const kind = new Map();
  for (const l of style.layers) {
    if (!l.source) continue;
    // il layer `hillshade` calcola l'ombra da una sorgente di quote
    if (l.type === 'hillshade') kind.set(l.source, 'raster-dem');
    else if (l.type === 'raster' || l.type === 'raster-dem') kind.set(l.source, l.type);
    else if (!kind.has(l.source)) kind.set(l.source, 'vector');
  }
  style.sources = Object.fromEntries(
    [...kind].map(([name, type]) => [
      name,
      type === 'raster-dem'
        ? {type: 'raster-dem', tiles: ['http://example.invalid/{z}/{x}/{y}.png']}
        : type === 'raster'
          ? {type: 'raster', tiles: ['http://example.invalid/{z}/{x}/{y}.png'], tileSize: 256}
          : {type: 'vector', tiles: ['http://example.invalid/{z}/{x}/{y}.pbf']},
    ]),
  );
}
if (!style.glyphs) style.glyphs = 'http://example.invalid/{fontstack}/{range}.pbf';

const errors = validateStyleMin(style);
if (errors.length === 0) {
  console.log(`OK: ${target} — ${style.layers.length} layer, nessun errore`);
  process.exit(0);
}
console.error(`FALLITA la validazione di ${target}: ${errors.length} errori\n`);
for (const e of errors) console.error(`  ${e.message}`);
process.exit(1);
