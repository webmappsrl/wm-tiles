/**
 * Misura oggettiva della somiglianza: confronta il colore medio e l'istogramma
 * di luminosita' fra la meta' sinistra (locale) e destra (TGen) di uno
 * screenshot di confronto. Serve a decidere le correzioni con un numero invece
 * che a occhio.
 *
 * Il terzo argomento restringe la misura a una finestra dentro ciascun
 * pannello, in coordinate del pannello: `left,top,width,height`. Serve quando
 * la vista esce dal bbox dei dati locali — agli zoom piccoli il viewport e'
 * piu' largo dell'area generata — perche' altrimenti il fondo vuoto entra
 * nella media e i numeri non dicono nulla sulla somiglianza.
 *
 * Uso: node tools/measure.mjs [dir] [left,top,width,height]
 */
import sharp from 'sharp';
import {readdirSync} from 'node:fs';

const dir = process.argv[2] ?? 'data/compare-ol';
const files = readdirSync(dir).filter(f => f.endsWith('.png'));
const win = process.argv[3]?.split(',').map(Number);

for (const f of files) {
  const img = sharp(`${dir}/${f}`);
  const {width, height} = await img.metadata();
  const half = Math.floor(width / 2);
  const top = 24; // salta la banda dell'etichetta (22 px)

  const stat = async (left) => {
    // stats() legge l'input e ignora le operazioni in pipeline: il ritaglio
    // va materializzato in un buffer prima di misurarlo.
    const box = win
      ? {left: left + win[0], top: top + win[1], width: win[2], height: win[3]}
      : {left, top, width: half - 8, height: height - top - 8};
    const buf = await sharp(`${dir}/${f}`).extract(box).toBuffer();
    const s = await sharp(buf).stats();
    const [r, g, b] = s.channels.slice(0, 3).map(c => c.mean);
    // La deviazione standard misura il CONTRASTO: e' la metrica dell'effetto
    // di rilievo. Allineare solo la media appiattisce l'ombreggiatura.
    const sd = s.channels.slice(0, 3).map(c => c.stdev);
    return {
      r, g, b,
      lum: 0.299 * r + 0.587 * g + 0.114 * b,
      sd: 0.299 * sd[0] + 0.587 * sd[1] + 0.114 * sd[2],
    };
  };

  const L = await stat(0);
  const R = await stat(half + 4);
  const d = (a, b) => (a - b >= 0 ? '+' : '') + (a - b).toFixed(1);
  console.log(
    `${(f.replace('.png', '') + (win ? ' ⃞' : '')).padEnd(18)} ` +
      `locale rgb(${L.r.toFixed(0)},${L.g.toFixed(0)},${L.b.toFixed(0)}) lum ${L.lum.toFixed(1)}  |  ` +
      `tgen rgb(${R.r.toFixed(0)},${R.g.toFixed(0)},${R.b.toFixed(0)}) lum ${R.lum.toFixed(1)}  |  ` +
      `Δlum ${d(L.lum, R.lum)}  Δr ${d(L.r, R.r)} Δg ${d(L.g, R.g)} Δb ${d(L.b, R.b)}\n` +
      `${''.padEnd(19)}contrasto (dev.std): locale ${L.sd.toFixed(1)}  tgen ${R.sd.toFixed(1)}  Δ ${d(L.sd, R.sd)}`,
  );
}
