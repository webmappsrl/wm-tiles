/**
 * Confronto puntuale di UNA tile XYZ: locale e riferimento affiancati, alla
 * risoluzione nativa e ingranditi, piu' l'elenco di cosa contiene la tile
 * vettoriale.
 *
 * La griglia della preview serve a nominare una differenza (`14/8660/5941`);
 * questo strumento e' il passo dopo: la mette sotto la lente. Il locale viene
 * reso centrando la vista esattamente sulla tile e portando il viewport a
 * 256 px, cosi' i due lati coprono la stessa area e sono confrontabili pixel
 * per pixel — non "piu' o meno la stessa vista".
 *
 * Uso: node tools/tile-diff.mjs <z/x/y> [scala] [out-dir]
 */
import {chromium} from 'playwright';
import sharp from 'sharp';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';

const spec = process.argv[2];
if (!/^\d+\/\d+\/\d+$/.test(spec ?? '')) {
  console.error('uso: node tools/tile-diff.mjs <z/x/y> [scala] [out-dir]');
  process.exit(2);
}
const [z, x, y] = spec.split('/').map(Number);
const SCALE = Number(process.argv[3] ?? 3);
const OUT = process.argv[4] ?? 'data/tiles';
const BASE = process.env.WM_BASE ?? 'http://localhost:8080';
const LEGACY = process.env.WM_LEGACY ?? 'https://api.webmapp.it/tiles';

// Le tile raster di riferimento esistono fino a z16: da z17 in su il server
// risponde 404 e un client qualsiasi mostra la z16 sovraingrandita. Confrontarsi
// con quell'ingrandimento significa inseguire un artefatto — i toponimi
// sembrano piu' grandi e le icone enormi solo perche' sono sgranate — e
// porterebbe a peggiorare lo stile vettoriale per somigliare a una sfocatura.
const REF_ZMAX = Number(process.env.WM_REF_ZMAX ?? 16);
if (z > REF_ZMAX) {
  console.error(`  z${z}: il riferimento raster arriva a z${REF_ZMAX}. Oltre non c'e' con cosa`);
  console.error(`  confrontarsi: il server risponde 404 e cio' che si vedrebbe e' la tile z${REF_ZMAX}`);
  console.error(`  ingrandita. La validazione per livello si ferma a z${REF_ZMAX}.`);
  process.exit(2);
}



mkdirSync(OUT, {recursive: true});

/** Centro della tile in gradi, dalla convenzione XYZ. */
const n = 2 ** z;
const lon = ((x + 0.5) / n) * 360 - 180;
const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI;

/**
 * Copertura: il prototipo e' generato su un bbox, e una tile fuori da quello
 * mostra fondo vuoto e DEM assente. Le differenze misurate sarebbero enormi
 * ma prive di significato, quindi il caso va dichiarato, non dedotto dopo.
 */
const tileBox = {
  w: (x / n) * 360 - 180,
  e: ((x + 1) / n) * 360 - 180,
  n: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI,
  s: (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI,
};
let coverage = '';
try {
  const v = await (await fetch(`${BASE}/version`)).json();
  // Con piu' celle il riquadro complessivo comprende anche il vuoto fra
  // l'una e l'altra: si controlla cella per cella. Una tile a cavallo del
  // bordo di una cella, misurata come se fosse coperta, risultava piu'
  // chiara di 14 punti per l'assenza di dati, non per lo stile.
  const celle = v.provenance?.celle ?? [];
  const m = celle.length ? null : /bbox\s*([\d.-]+),([\d.-]+),([\d.-]+),([\d.-]+)/.exec(v.provenance?.scope ?? '');
  if (celle.length) {
    const dentro = c => tileBox.w >= c.bbox[0] && tileBox.e <= c.bbox[2] && tileBox.s >= c.bbox[1] && tileBox.n <= c.bbox[3];
    const tocca = c => tileBox.e > c.bbox[0] && tileBox.w < c.bbox[2] && tileBox.n > c.bbox[1] && tileBox.s < c.bbox[3];
    const piena = celle.find(dentro), parz = celle.find(tocca);
    coverage = piena ? `dentro la cella ${piena.nome}`
      : parz ? `PARZIALE — la tile esce dalla cella ${parz.nome} (${parz.bbox.join(',')})`
      : `FUORI dalle celle generate (${celle.map(c => c.nome).join(', ')}): le differenze non sono misurabili`;
  } else if (m) {
    const [W, S, E, N] = m.slice(1).map(Number);
    const inside = tileBox.w >= W && tileBox.e <= E && tileBox.s >= S && tileBox.n <= N;
    const overlaps = tileBox.e > W && tileBox.w < E && tileBox.n > S && tileBox.s < N;
    coverage = inside ? 'dentro l\'area generata'
      : overlaps ? `PARZIALE — l'area generata e' ${W},${S},${E},${N}, la tile ${tileBox.w.toFixed(2)},${tileBox.s.toFixed(2)},${tileBox.e.toFixed(2)},${tileBox.n.toFixed(2)}`
      : `FUORI dall'area generata (${W},${S},${E},${N}): le differenze non sono misurabili`;
  }
} catch {}

// NIENTE `--use-angle=default`: l'ombreggiatura e' calcolata su GPU e con
// quel flag il layer WebGL non viene disegnato, senza errori. La misura
// risultava piu' chiara di 15 punti e sembrava un difetto di stile.
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader'],
});
// viewport di 256 px: la vista copre esattamente la tile
const ctx = await browser.newContext({viewport: {width: 256, height: 256}, deviceScaleFactor: 1});
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
p.on('console', m => m.type() === 'error' && errs.push(m.text()));

// La vista nasce gia' centrata sulla tile (?c=): spostarla dopo il
// caricamento corre con la costruzione differita dei layer.
await p.goto(`${BASE}/preview/?single=left&zoom=${z}&c=${lon},${lat}`,
  {waitUntil: 'networkidle', timeout: 45000});
// Su un viewport di 256 px il titolo del pannello e i controlli coprono una
// frazione grande e scura dell'immagine: falsano luminosita' e contrasto.
await p.addStyleTag({content: '.pane h2, #err, .ol-control, #bar { display: none !important; }'});
// Un'attesa a tempo fisso NON basta: il DEM arriva come tile PNG e l'ombra e'
// calcolata dopo, quindi lo screenshot puo' cogliere la mappa senza rilievo e
// la misura risulta piu' chiara di 18 punti. Con un'attesa fissa le stesse
// condizioni davano -2,9 oppure +15,5 a caso: nessuna taratura era possibile.
// Si aspetta `rendercomplete`, che scatta quando ogni sorgente ha finito.
// `rendercomplete` da solo NON basta: scatta anche su un render intermedio,
// prima che il DEM sia arrivato, e la misura oscilla di 18 punti. Serve
// insieme a un'attesa piena: con questa combinazione quattro giri di seguito
// danno lo stesso valore.
await p.evaluate(() => new Promise(res => {
  let done = false;
  const finish = () => { if (!done) { done = true; res(); } };
  window.__wm.left.once('rendercomplete', finish);
  window.__wm.left.render();
  setTimeout(finish, 20000);
}));
await p.waitForTimeout(4500);
/**
 * Tre scatti, e si tiene il piu' scuro.
 *
 * La costruzione differita dei layer di ol-mapbox-style corre con lo scatto:
 * circa un giro su quattro l'ombreggiatura non e' ancora disegnata e
 * l'immagine risulta piu' chiara di 15 punti, senza errori e con la sorgente
 * che si dichiara `ready` — quindi il difetto non e' rilevabile dallo stato.
 * L'ombra puo' solo scurire, mai schiarire: il piu' scuro fra piu' scatti e'
 * quello completo. Senza questo la stessa tile misurava -2,9 oppure +15,5 a
 * caso, e nessuna taratura era possibile.
 */
// Il riquadro degli errori viene nascosto per non falsare i colori, ma va
// LETTO: un errore in applyStyle lascia la mappa senza un layer intero e le
// misure diventano prive di significato senza che nulla lo segnali. E'
// successo: `grigioPendenza is not defined` ha tolto l'ombreggiatura per
// diversi giri di taratura.
const erroreStile = await p.evaluate(() =>
  document.getElementById('err')?.textContent?.trim().slice(0, 200) ?? '');
if (erroreStile) console.log(`  ⚠ ERRORE NELLO STILE: ${erroreStile}`);

// Il modo di composizione dell'ombreggiatura va VERIFICATO, non dato per
// buono: la classe puo' esserci e la regola CSS pure, e il blend restare
// `normal` perche' ol.css ha un selettore piu' specifico. E' successo, e per
// giorni l'ombra si e' composta normalmente mentre le tarature compensavano.
const blend = await p.evaluate(() => {
  const el = [...document.querySelectorAll('[class*="wm-blend-"]')];
  if (!el.length) return 'nessun layer di ombreggiatura';
  const sbagliati = el.map(e => {
    const atteso = /wm-blend-([a-z-]+)/.exec(e.className)[1];
    const reso = getComputedStyle(e).mixBlendMode;
    return reso === atteso ? '' : `atteso ${atteso}, reso ${reso}`;
  }).filter(Boolean);
  // La classe stessa deve essere quella che il motore vuole per il livello:
  // se il cambio non e' arrivato al canvas, classe e calcolato coincidono
  // comunque e il controllo sopra non lo vede.
  const voluta = window.__wm?.shade?.layer?.get('wm-blend');
  const hs = document.querySelector('.wm-hillshade');
  if (voluta && hs && !hs.classList.contains(`wm-blend-${voluta}`)) {
    sbagliati.push(`voluta ${voluta}, classe ${hs.className}`);
  }
  return sbagliati.join('; ');
});
if (blend) console.log(`  ⚠ COMPOSIZIONE DELL'OMBRA: ${blend}`);

const shots = [];
for (let k = 0; k < 3; k++) {
  if (k) {
    await p.reload({waitUntil: 'networkidle', timeout: 45000});
    await p.addStyleTag({content: '.pane h2, #err, .ol-control, #bar { display: none !important; }'});
    await p.waitForTimeout(4500);
  }
  const buf = await p.screenshot({clip: {x: 0, y: 0, width: 256, height: 256}});
  const st = await sharp(buf).removeAlpha().stats();
  const lum = 0.299 * st.channels[0].mean + 0.587 * st.channels[1].mean + 0.114 * st.channels[2].mean;
  shots.push({buf, lum});
  if (k && Math.abs(shots[k].lum - shots[k - 1].lum) < 0.3) break; // stabile: basta
}
shots.sort((a, b) => a.lum - b.lum);
const spread = shots[shots.length - 1].lum - shots[0].lum;
const localBuf = shots[0].buf;
await p.close();
await browser.close();

/**
 * Le tile del riferimento si tengono in cache su disco.
 *
 * `api.webmapp.it` e' un server di PRODUZIONE: una taratura che prova dieci
 * valori su tre tile sono trenta richieste, e ripetute hanno fatto cadere la
 * connessione (ECONNRESET). Le tile inoltre non cambiano — il rendering
 * dell'Italia e' fermo e l'aggiornamento OSM e' spento — quindi la cache
 * rende anche le misure ripetibili invece di dipendere dalla rete.
 * Per forzare il riscarico: rm -rf data/ref-cache
 */
const cacheDir = process.env.WM_REF_CACHE ?? 'data/ref-cache';
const cacheFile = `${cacheDir}/${z}-${x}-${y}.png`;
let refBuf;
if (existsSync(cacheFile)) {
  refBuf = readFileSync(cacheFile);
} else {
  /**
   * Il server del riferimento risponde in 5-12 secondi per tile, oltre il
   * timeout di connessione predefinito di fetch: serve un'attesa esplicita
   * generosa e qualche ritentativo distanziato. Le richieste ravvicinate lo
   * rallentano ulteriormente, quindi la cache non e' solo una comodita'.
   */
  let ultimo;
  for (let tentativo = 1; tentativo <= 3; tentativo++) {
    try {
      const res = await fetch(`${LEGACY}/${z}/${x}/${y}.png`,
        {signal: AbortSignal.timeout(45000)});
      if (!res.ok) { console.error(`  riferimento ${z}/${x}/${y}: HTTP ${res.status}`); process.exit(1); }
      refBuf = Buffer.from(await res.arrayBuffer());
      break;
    } catch (e) {
      ultimo = e;
      if (tentativo < 3) {
        console.log(`  riferimento lento (${e.cause?.code ?? e.name}), ritento fra ${tentativo * 3}s`);
        await new Promise(r => setTimeout(r, tentativo * 3000));
      }
    }
  }
  if (!refBuf) { console.error(`  riferimento ${z}/${x}/${y} non raggiungibile: ${ultimo?.message}`); process.exit(1); }
  mkdirSync(cacheDir, {recursive: true});
  writeFileSync(cacheFile, refBuf);
}

const S = 256 * SCALE;
const up = b => sharp(b).resize(S, S, {kernel: 'nearest'}).toBuffer();
const band = async (text, w) =>
  Buffer.from(
    `<svg width="${w}" height="20" xmlns="http://www.w3.org/2000/svg">
       <rect width="${w}" height="20" fill="#23211d"/>
       <text x="6" y="14" font-family="ui-monospace,monospace" font-size="11" fill="#ece7dc">${text}</text>
     </svg>`,
  );

const file = `${OUT}/${z}-${x}-${y}.png`;
await sharp({create: {width: S * 2 + 6, height: S + 20, channels: 3, background: '#23211d'}})
  .composite([
    {input: await band(`LOCALE  ${z}/${x}/${y}`, S), left: 0, top: 0},
    {input: await band(`TGEN  ${z}/${x}/${y}`, S), left: S + 6, top: 0},
    {input: await up(localBuf), left: 0, top: 20},
    {input: await up(refBuf), left: S + 6, top: 20},
  ])
  .png()
  .toFile(file);

/** Differenza media e per canale sulla tile, senza ritagli da indovinare. */
const st = async b => {
  const s = await sharp(b).removeAlpha().stats();
  const [r, g, bl] = s.channels.map(c => c.mean);
  const sd = s.channels.map(c => c.stdev);
  return {r, g, b: bl, lum: 0.299 * r + 0.587 * g + 0.114 * bl,
          sd: 0.299 * sd[0] + 0.587 * sd[1] + 0.114 * sd[2]};
};
const A = await st(localBuf);
const B = await st(refBuf);
const d = (a, b) => (a - b >= 0 ? '+' : '') + (a - b).toFixed(1);

console.log(`  ${file}   centro ${lon.toFixed(4)}, ${lat.toFixed(4)}`);
if (coverage) console.log(`  copertura: ${coverage}`);
console.log(`  locale rgb(${A.r.toFixed(0)},${A.g.toFixed(0)},${A.b.toFixed(0)}) lum ${A.lum.toFixed(1)} sd ${A.sd.toFixed(1)}  |  ` +
            `tgen rgb(${B.r.toFixed(0)},${B.g.toFixed(0)},${B.b.toFixed(0)}) lum ${B.lum.toFixed(1)} sd ${B.sd.toFixed(1)}`);
console.log(`  Δlum ${d(A.lum, B.lum)}  Δr ${d(A.r, B.r)} Δg ${d(A.g, B.g)} Δb ${d(A.b, B.b)}  Δcontrasto ${d(A.sd, B.sd)}`);
if (spread > 1) console.log(`  (${shots.length} scatti, scarto ${spread.toFixed(1)}: tenuto il piu' scuro)`);
if (errs.length) console.log('  ⚠ ' + errs.slice(0, 2).join(' | '));
