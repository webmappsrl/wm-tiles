/**
 * Taratura di un set di ombreggiatura del profilo, per misura.
 *
 * Agisce su style/zoom-profile.json (non sullo stile, che e' generato) e
 * rigenera prima di ogni misura. Il riferimento compone l'ombra in `multiply`
 * con opacita' per fascia e, da z14, ci somma la pendenza in `overlay`:
 * OpenLayers non ha nessuna delle due cose, quindi le leve sono
 * `hillshade-exaggeration` e l'alpha dei colori, e i valori si trovano
 * provando.
 *
 * Riporta luminosita' e contrasto: vanno guardati insieme, perche' abbassare
 * l'ombra schiarisce ma appiattisce, e il riferimento e' piu' inciso di noi.
 *
 * Uso: node tools/tune-shade.mjs <set> <chiave> <valori> <tile,tile,...>
 *   node tools/tune-shade.mjs hs10m exaggeration 0.6,0.8,1.0 14/8679/5944,15/17359/11888
 */
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';

const [set, chiave, valori, tiles] = process.argv.slice(2);
if (!set || !chiave || !valori || !tiles) {
  console.error('uso: node tools/tune-shade.mjs <set> <chiave> <v1;v2;...> <z/x/y,...>');
  console.error('  i valori si separano con ; perche\' i colori contengono virgole');
  process.exit(2);
}
// separatore `;`: i valori possono essere colori rgba(...), che contengono
// virgole — spezzarli sulla virgola applicava frammenti non validi e
// l'ombreggiatura sparaiva del tutto, dando misure tutte uguali
const VAL = valori.split(';').map(v => v.trim()).filter(Boolean);
const TILES = tiles.split(',');
const PROF = 'style/zoom-profile.json';
const originale = readFileSync(PROF, 'utf8');

const misura = t => {
  const out = execFileSync('node', ['tools/tile-diff.mjs', t, '1'], {encoding: 'utf8'});
  const m = /Δlum ([+-][\d.]+).*?Δcontrasto ([+-][\d.]+)/s.exec(out);
  return m ? {lum: Number(m[1]), sd: Number(m[2])} : {lum: NaN, sd: NaN};
};

const esiti = [];
try {
  for (const v of VAL) {
    const p = JSON.parse(originale);
    if (!p.shadeSets[set]) throw new Error(`set '${set}' assente: ${Object.keys(p.shadeSets)}`);
    p.shadeSets[set][chiave] = /^[\d.]+$/.test(v) ? Number(v) : v;
    writeFileSync(PROF, JSON.stringify(p, null, 2));
    execFileSync('node', ['pipeline/build-style.mjs'], {encoding: 'utf8'});

    const r = TILES.map(misura);
    const lum = r.reduce((a, x) => a + x.lum, 0) / r.length;
    const sd = r.reduce((a, x) => a + x.sd, 0) / r.length;
    esiti.push({v, lum, sd, score: Math.abs(lum) + Math.abs(sd)});
    const f = x => (x >= 0 ? '+' : '') + x.toFixed(1);
    console.log(`  ${set}.${chiave} = ${String(v).padEnd(6)} Δlum ${f(lum).padStart(6)}  Δcontrasto ${f(sd).padStart(6)}   ` +
      TILES.map((t, i) => `${t} ${f(r[i].lum)}/${f(r[i].sd)}`).join('  '));
  }
} finally {
  writeFileSync(PROF, originale);
  execFileSync('node', ['pipeline/build-style.mjs'], {encoding: 'utf8'});
}

const best = esiti.filter(e => Number.isFinite(e.score)).sort((a, b) => a.score - b.score)[0];
if (best) console.log(`\n  migliore: ${best.v}  (Δlum ${best.lum.toFixed(1)}, Δcontrasto ${best.sd.toFixed(1)})`);
console.log('  profilo ripristinato: applica il valore scelto a mano');
