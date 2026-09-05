/**
 * Taratura dell'ombreggiatura ai bassi zoom, per misura invece che a occhio.
 *
 * Il riferimento compone l'ombra in `multiply` con opacita' che cambia per
 * fascia di zoom (0,2 a z7-10; 0,18 a z11-13; 0,3 a z14+), cosa che
 * OpenLayers non riproduce: l'unica leva e' `hillshade-exaggeration` piu'
 * l'alpha dei colori. Questo strumento prova una serie di valori e riporta
 * per ciascuno la differenza di luminosita' e di contrasto, cosi' la scelta
 * ricade su un numero.
 *
 * Uso: node tools/tune-hillshade.mjs <zoom> <valore,valore,...> [tile,tile]
 */
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';

const Z = Number(process.argv[2] ?? 10);
const VALUES = (process.argv[3] ?? '0.5,0.4,0.3,0.2').split(',').map(Number);
const TILES = (process.argv[4] ?? '10/541/371,10/542/371').split(',');
const STYLE = 'style/webmapp.json';

const original = readFileSync(STYLE, 'utf8');
const results = [];
try {
  for (const v of VALUES) {
    const s = JSON.parse(original);
    const h = s.layers.find(l => l.id === 'hillshade-calc');
    // sostituisce lo stop dello zoom in esame, lasciando gli altri
    const stops = h.paint['hillshade-exaggeration'];
    const i = stops.indexOf(Z);
    if (i > 0) stops[i + 1] = v;
    else throw new Error(`nessuno stop a z${Z}: ${JSON.stringify(stops)}`);
    writeFileSync(STYLE, JSON.stringify(s, null, 2));

    const row = {v, tiles: []};
    for (const t of TILES) {
      const out = execFileSync('node', ['tools/tile-diff.mjs', t, '1'], {encoding: 'utf8'});
      const m = /Δlum ([+-][\d.]+).*Δcontrasto ([+-][\d.]+)/.exec(out);
      row.tiles.push(m ? {t, lum: Number(m[1]), sd: Number(m[2])} : {t, lum: NaN, sd: NaN});
    }
    const lum = row.tiles.reduce((a, x) => a + x.lum, 0) / row.tiles.length;
    const sd = row.tiles.reduce((a, x) => a + x.sd, 0) / row.tiles.length;
    results.push({v, lum, sd, score: Math.abs(lum) + Math.abs(sd)});
    console.log(`  exaggeration ${v.toFixed(2)}:  Δlum medio ${lum >= 0 ? '+' : ''}${lum.toFixed(1)}   ` +
      `Δcontrasto medio ${sd >= 0 ? '+' : ''}${sd.toFixed(1)}   ` +
      row.tiles.map(x => `${x.t} ${x.lum >= 0 ? '+' : ''}${x.lum.toFixed(1)}`).join('  '));
  }
} finally {
  writeFileSync(STYLE, original); // lo stile torna come era: la scelta e' esplicita
}

const best = results.sort((a, b) => a.score - b.score)[0];
if (best) console.log(`\n  migliore a z${Z}: ${best.v}  (Δlum ${best.lum.toFixed(1)}, Δcontrasto ${best.sd.toFixed(1)})`);
console.log('  stile ripristinato: applica il valore scelto a mano');
