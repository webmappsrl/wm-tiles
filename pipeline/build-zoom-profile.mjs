/**
 * Genera style/zoom-profile.json dalla struttura del riferimento.
 *
 * La visibilita' per livello e l'ordine di disegno vengono dal riferimento
 * stesso: `project.mml` da' l'ordine e le soglie di ogni sorgente, i `.mss`
 * le condizioni `[zoom >= N]`, e la visibilita' effettiva e' l'intersezione
 * delle due. Trascriverli a mano e' lento e sbaglia: leggendo il solo `.mss`
 * avevo dato le curve di livello a z10-12, mentre nel `.mml`
 * `contourlines_lr` e' minzoom 12 maxzoom 12 e a z10-z11 il riferimento non
 * disegna curve.
 *
 * I layer senza corrispondente nel riferimento (`tgen: null` nel mapping)
 * conservano la visibilita' che abbiamo scelto: sono asset presenti su TGen
 * ma non attivi in produzione, piu' i POI le cui regole stanno in blocchi
 * senza id.
 *
 * Uso: node pipeline/build-zoom-profile.mjs [--scrivi]
 */
import {readFileSync, writeFileSync} from 'node:fs';

const SCRIVI = process.argv.includes('--scrivi');
const cc = JSON.parse(readFileSync('data/tgen-cartocss.json', 'utf8'));
const mapping = JSON.parse(readFileSync('style/tgen-mapping.json', 'utf8')).layers;
const prof = JSON.parse(readFileSync('style/zoom-profile.json', 'utf8'));
const [Z0, Z1] = prof.zoomRange;

/** Zoom in cui un selettore del riferimento e' davvero disegnato. */
const zoomOf = sel => {
  const t = cc.layer[sel];
  if (!t) return new Set();
  const out = new Set();
  for (const z of Object.keys(t.zoom).map(Number)) {
    if (t.minzoom !== null && z < t.minzoom) continue;
    if (t.maxzoom !== null && z > t.maxzoom) continue;
    out.add(z);
  }
  return out;
};

const nostro = z => new Set(prof.levels[String(z)].visible);
const righe = [];
const nuovaVis = new Map(); // layer -> Set(zoom)

for (const [id, m] of Object.entries(mapping)) {
  const attuale = new Set();
  for (let z = Z0; z <= Z1; z++) if (nostro(z).has(id)) attuale.add(z);

  if (m.tgen === null) { nuovaVis.set(id, attuale); righe.push({id, fonte: 'nostro', attuale, nuova: attuale}); continue; }
  const sels = Array.isArray(m.tgen) ? m.tgen : [m.tgen];
  const tg = new Set();
  for (const s of sels) for (const z of zoomOf(s)) if (z >= Z0 && z <= Z1) tg.add(z);
  if (!tg.size) { nuovaVis.set(id, attuale); righe.push({id, fonte: 'nostro (selettore senza regole)', attuale, nuova: attuale}); continue; }
  nuovaVis.set(id, tg);
  righe.push({id, fonte: 'tgen', attuale, nuova: tg});
}

/** Ordine di disegno dal riferimento, per i layer che vi corrispondono. */
const ordineTgen = id => {
  const m = mapping[id];
  if (!m || m.tgen === null) return null;
  const sels = Array.isArray(m.tgen) ? m.tgen : [m.tgen];
  const ords = sels.map(s => cc.layer[s]?.ordine).filter(o => o !== null && o !== undefined);
  return ords.length ? Math.min(...ords) : null;
};

const zs = z => Array.from({length: Z1 - Z0 + 1}, (_, k) => Z0 + k);
const barra = set => zs().map(z => (set.has(z) ? '●' : '·')).join('');

console.log(`  ${'layer'.padEnd(24)}${('z' + Z0 + '..z' + Z1).padEnd(13)}${'nuovo'.padEnd(13)}fonte / differenza`);
let cambi = 0;
for (const r of righe) {
  const d = zs().filter(z => r.attuale.has(z) !== r.nuova.has(z));
  cambi += d.length;
  console.log(`  ${r.id.padEnd(24)}${barra(r.attuale).padEnd(13)}${barra(r.nuova).padEnd(13)}` +
    `${r.fonte}${d.length ? '  ' + d.map(z => (r.nuova.has(z) ? '+z' : '-z') + z).join(' ') : ''}`);
}
console.log(`\n  ${cambi} scostamenti di visibilita' dentro z${Z0}-z${Z1}`);

if (!SCRIVI) { console.log('  (nulla scritto: rilancia con --scrivi)'); process.exit(0); }

for (let z = Z0; z <= Z1; z++) {
  const lv = prof.levels[String(z)];
  lv.visible = prof.order.filter(id => (nuovaVis.get(id) ?? new Set()).has(z));
}
// l'ordine segue il riferimento dove esiste, e conserva la posizione
// relativa attuale per i layer che non gli corrispondono
const pos = new Map(prof.order.map((id, i) => [id, i]));
prof.order = [...prof.order].sort((a, b) => {
  const oa = ordineTgen(a), ob = ordineTgen(b);
  if (oa !== null && ob !== null && oa !== ob) return oa - ob;
  return pos.get(a) - pos.get(b);
});
prof.fonteVisibilita = Object.fromEntries(righe.map(r => [r.id, r.fonte]));
writeFileSync('style/zoom-profile.json', JSON.stringify(prof, null, 2));
console.log('  style/zoom-profile.json aggiornato');
