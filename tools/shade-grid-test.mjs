/**
 * Test: l'ombreggiatura non deve mostrare un reticolo regolare.
 *
 * Il DEM Terrarium codifica le quote come numeri, quindi va campionato
 * `nearest`: interpolare i canali falsa il dato. Ma oltre il maxzoom del DEM
 * ogni texel copre piu' pixel dello schermo, e la pendenza calcolata su dati
 * a gradini vale zero dentro il blocco ed esplode sui bordi. Il risultato e'
 * una griglia di linee, visibile a occhio e invisibile alle medie: la
 * luminosita' e il contrasto complessivi non si spostano quasi.
 *
 * La misura e' la periodicita' delle differenze fra colonne (e righe)
 * adiacenti: su un rilievo vero cala dolcemente, su un reticolo mostra picchi
 * a distanza regolare. Si riporta il rapporto fra il picco periodico e la
 * mediana; sopra la soglia il reticolo c'e'.
 *
 * Uso: node tools/shade-grid-test.mjs [z1 z2 ...]
 */
import {chromium} from 'playwright';
import sharp from 'sharp';

const ZOOMS = process.argv.slice(2).map(Number);
const LIVELLI = ZOOMS.length ? ZOOMS : [13, 14, 15, 16, 17];
const BASE = process.env.WM_BASE ?? 'http://localhost:8080';
const PUNTO = process.env.WM_PUNTO ?? '10.6197,44.1063'; // Sillano-Pradarena
// percentuale di linee anomale: i bordi delle tile ne danno ~1%, un
// reticolo molto di piu'
const SOGLIA = Number(process.env.WM_SOGLIA ?? 5);

/**
 * Quante linee sono molto piu' marcate della mediana, in percentuale.
 *
 * Non basta guardare il picco: sul bordo di ogni tile del DEM il calcolo
 * della pendenza non ha i pixel della tile accanto e produce una
 * discontinuita', cioe' UNA linea marcata ogni 256 px. E' un difetto diverso
 * e molto meno grave di un reticolo, invisibile a contrasto reale, ma alza il
 * picco esattamente come farebbe una griglia fitta. Un reticolo vero fa
 * scattare MOLTE linee, i bordi delle tile una o due: si misura quindi la
 * frazione, non il massimo.
 */
function periodicita(data, w, h, perColonne) {
  const n = perColonne ? w : h;
  const diff = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    let s = 0;
    const m = perColonne ? h : w;
    for (let j = 0; j < m; j++) {
      const a = perColonne ? j * w + i : i * w + j;
      const b = perColonne ? j * w + i + 1 : (i + 1) * w + j;
      s += Math.abs(data[a] - data[b]);
    }
    diff[i] = s / m;
  }
  const ord = [...diff].sort((a, b) => a - b);
  const mediana = ord[ord.length >> 1] || 1e-6;
  let anomale = 0;
  for (const v of diff) if (v > mediana * 2.2) anomale++;
  return (100 * anomale) / diff.length;
}

const b = await chromium.launch({args: ['--use-gl=angle', '--enable-unsafe-swiftshader']});
const ctx = await b.newContext({viewport: {width: 256, height: 256}, deviceScaleFactor: 1});
let peggio = 0;
const esiti = [];
for (const z of LIVELLI) {
  const p = await ctx.newPage();
  // ?only=__sola-ombra__ non corrisponde a nessun layer di stile: resta solo
  // l'ombreggiatura, che il filtro non tocca
  await p.goto(`${BASE}/preview/?single=left&zoom=${z}&c=${PUNTO}&only=__sola-ombra__`,
    {waitUntil: 'networkidle', timeout: 45000});
  await p.addStyleTag({content: '.pane h2,#err,.ol-control,#bar{display:none!important}'});
  await p.waitForTimeout(3500);
  const {data, info} = await sharp(await p.screenshot({clip: {x: 0, y: 0, width: 256, height: 256}}))
    .removeAlpha().greyscale().raw().toBuffer({resolveWithObject: true});
  await p.close();
  const col = periodicita(data, info.width, info.height, true);
  const rig = periodicita(data, info.width, info.height, false);
  const v = Math.max(col, rig);
  peggio = Math.max(peggio, v);
  esiti.push({z, col, rig, v});
}
await b.close();

console.log('  zoom   colonne%  righe%   esito   (percentuale di linee anomale)');
for (const e of esiti) {
  const ok = e.v <= SOGLIA;
  console.log(`  z${e.z}    ${e.col.toFixed(2).padStart(6)}  ${e.rig.toFixed(2).padStart(6)}   ${ok ? 'ok' : 'RETICOLO'}`);
}
console.log(`\n  soglia ${SOGLIA}  peggiore ${peggio.toFixed(2)}`);
process.exit(peggio > SOGLIA ? 1 : 0);
