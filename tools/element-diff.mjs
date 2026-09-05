/**
 * Confronto per ELEMENTO fra locale e riferimento, su piu' livelli di zoom.
 *
 * Le medie globali (Δ luminosita', Δ contrasto) risentono del contenuto, e il
 * contenuto diverge per costruzione: le tiles di riferimento sono ferme da
 * mesi mentre OSM e' andato avanti. Quello che si deve confrontare e' COME
 * sono disegnate le cose presenti in entrambi, non quante ce ne sono.
 *
 * Per ogni categoria si isola il tono dominante nei due lati e si riporta lo
 * scarto per canale. Il numero di pixel viene mostrato solo come contesto: uno
 * scarto di tono su pochi pixel e' comunque un difetto di stile, mentre una
 * differenza di quantita' a parita' di tono non lo e'.
 *
 * Uso: node tools/element-diff.mjs [lon,lat] [zmin] [zmax]
 */
import {chromium} from 'playwright';
import sharp from 'sharp';
import {existsSync, readFileSync} from 'node:fs';

const [lon, lat] = (process.argv[2] ?? '10.34,44.25').split(',').map(Number);
const ZMIN = Number(process.argv[3] ?? 10);
const ZMAX = Number(process.argv[4] ?? 16);
const BASE = process.env.WM_BASE ?? 'http://localhost:8080';
const CACHE = process.env.WM_REF_CACHE ?? 'data/ref-cache';

/** Categorie riconosciute dal colore, non dai dati: vale per entrambi i lati. */
const CATEGORIE = {
  'verde vegetazione': c => c[1] > c[0] && c[1] > c[2] && c[1] - c[2] > 15 && c[1] < 225,
  'curve di livello':  c => Math.abs(c[0] - c[1]) < 14 && c[0] > 125 && c[0] < 180,
  'strade chiare':     c => c[0] > 235 && c[1] > 235 && c[2] > 228,
  'strade gialle':     c => c[0] - c[2] > 45 && c[1] - c[2] > 25 && c[0] > 200,
  'sentieri rossi':    c => c[0] - c[1] > 40 && c[0] > 150,
  'confini viola':     c => c[0] - c[1] > 18 && c[2] - c[1] > 18,
  'acque azzurre':     c => c[2] - c[0] > 18 && c[2] > 190,
};

const dominante = async (buf, test) => {
  const {data, info} = await sharp(buf).removeAlpha().raw().toBuffer({resolveWithObject: true});
  const m = new Map();
  let tot = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const c = [data[i], data[i + 1], data[i + 2]];
    if (test(c)) { m.set(c.join(','), (m.get(c.join(',')) ?? 0) + 1); tot++; }
  }
  if (!tot) return null;
  const top = [...m].sort((a, b) => b[1] - a[1])[0];
  return {rgb: top[0].split(',').map(Number), px: tot};
};

const browser = await chromium.launch({args: ['--use-gl=angle', '--enable-unsafe-swiftshader']});
const ctx = await browser.newContext({viewport: {width: 256, height: 256}, deviceScaleFactor: 1});

console.log(`  punto ${lon},${lat} — scarto di TONO per elemento (il numero di pixel e' solo contesto)\n`);
const peggiori = [];
for (let z = ZMIN; z <= ZMAX; z++) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
  const ref = `${CACHE}/${z}-${x}-${y}.png`;
  if (!existsSync(ref)) { console.log(`  z${z}: riferimento non in cache (${z}/${x}/${y})`); continue; }

  const cx = ((x + 0.5) / n) * 360 - 180;
  const cy = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI;
  const p = await ctx.newPage();
  await p.goto(`${BASE}/preview/?single=left&zoom=${z}&c=${cx},${cy}`, {waitUntil: 'networkidle', timeout: 45000});
  await p.addStyleTag({content: '.pane h2, #err, .ol-control, #bar { display: none !important; }'});
  await p.waitForTimeout(4500);
  const shot = await p.screenshot({clip: {x: 0, y: 0, width: 256, height: 256}});
  await p.close();
  const refBuf = readFileSync(ref);

  console.log(`  z${z}  (${z}/${x}/${y})`);
  for (const [nome, test] of Object.entries(CATEGORIE)) {
    const L = await dominante(shot, test);
    const R = await dominante(refBuf, test);
    if (!L && !R) continue;
    if (!L || !R) {
      console.log(`    ${nome.padEnd(19)} ${!L ? 'assente nel locale' : 'assente nel riferimento'}` +
        `  (${L ? L.px : R.px} px sull'altro lato)`);
      continue;
    }
    const d = L.rgb.map((v, i) => v - R.rgb[i]);
    const scarto = Math.max(...d.map(Math.abs));
    peggiori.push({z, nome, scarto});
    const f = v => (v >= 0 ? '+' : '') + v;
    console.log(`    ${nome.padEnd(19)} locale rgb(${L.rgb.join(',')})  tgen rgb(${R.rgb.join(',')})` +
      `   Δ ${d.map(f).join(' ')}${scarto > 20 ? '   <- da sistemare' : ''}`);
  }
  console.log('');
}
await browser.close();
const top = peggiori.sort((a, b) => b.scarto - a.scarto).slice(0, 5);
if (top.length) {
  console.log('  scarti maggiori:');
  for (const t of top) console.log(`    z${t.z} ${t.nome}: ${t.scarto}`);
}
