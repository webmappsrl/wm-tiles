/**
 * Confronta la nostra ombreggiatura con quella di `gdaldem` sullo stesso DEM.
 *
 * E' il metro oggettivo: gdaldem applica la formula di Horn sul dato in float,
 * senza texture ne' interpolazioni, quindi il suo hillshade e' la risposta
 * giusta per definizione. La correlazione dice due cose in una:
 *  - il SEGNO. Negativa = ombra invertita, le vette si leggono come valli.
 *    Non lo rilevano ne' la luminosita' media ne' il contrasto.
 *  - la FORMA. Vicina a 1 = stesso rilievo; bassa = il nostro calcolo aggiunge
 *    artefatti (strisce, bande, saturazione).
 *
 * L'hillshade di riferimento va preparato prima con gdaldem sull'area indicata
 * (vedi il comando stampato in caso di file mancante).
 */
import {chromium} from 'playwright';
import sharp from 'sharp';
import {existsSync} from 'node:fs';

const RIF = process.env.WM_HS_RIF ?? 'data/_hs_z16.png';
const AREA = {w: 10.60, s: 44.09, e: 10.64, n: 44.12};
const ZOOM = Number(process.argv[2] ?? 16);
const SOGLIA = Number(process.env.WM_SOGLIA ?? 0.75);

if (!existsSync(RIF)) {
  console.error(`  manca ${RIF}. Generalo con:
  docker run --rm -v "$PWD/data":/work ghcr.io/osgeo/gdal:ubuntu-small-latest bash -c "
    gdalwarp -q -overwrite -t_srs EPSG:3857 -te_srs EPSG:4326 -te ${AREA.w} ${AREA.s} ${AREA.e} ${AREA.n} \\
      -tr 2.39 2.39 -r cubicspline /work/dem3857.tif /tmp/z.tif
    gdaldem hillshade -q -az 315 -alt 45 /tmp/z.tif /work/_hs_z16.png -of PNG"`);
  process.exit(2);
}

const cx = (AREA.w + AREA.e) / 2, cy = (AREA.s + AREA.n) / 2;
const b = await chromium.launch({args: ['--use-gl=angle', '--enable-unsafe-swiftshader']});
const p = await (await b.newContext({viewport: {width: 256, height: 256}, deviceScaleFactor: 1})).newPage();
await p.goto(`http://localhost:8080/preview/?single=left&zoom=${ZOOM}&c=${cx},${cy}&only=__sola-ombra__`,
  {waitUntil: 'networkidle', timeout: 45000});
await p.addStyleTag({content: '.pane h2,#err,.ol-control,#bar{display:none!important}'});
await p.waitForTimeout(4000);
// gdaldem non applica ne' esagerazione ne' gamma: per confrontare la sola
// GEOMETRIA del rilievo si azzerano qui, altrimenti la relazione non e'
// lineare e la correlazione scende senza che ci sia un difetto.
await p.evaluate(() => {
  for (const l of window.__wm.left.getLayers().getArray()) {
    if (l.get('wm-hillshade')) {
      l.setOpacity(1);
      l.updateStyleVariables({vert: 1, gamma: 1, slope: 0, passoDem: l.get('wm-passo') ?? 1});
    }
    if (l.get('wm-hillshade-slope')) l.setOpacity(0);
  }
});
await p.waitForTimeout(1500);
const nostro = await p.screenshot({clip: {x: 0, y: 0, width: 256, height: 256}});
await b.close();

// Il riferimento copre l'intera area, il nostro solo cio' che sta a schermo.
// Il ritaglio va calcolato, non stimato: il riferimento e' generato a 2,39
// m/px (risoluzione di z16), quindi i 256 px del viewport a z16 corrispondono
// a 256 px del riferimento, scalati col rapporto fra le risoluzioni.
const RIS_RIF = 2.3886571339111327;               // m/px del file di gdaldem
const risVista = 156543.033928 / 2 ** ZOOM;       // m/px della vista
const rif = await sharp(RIF).metadata();
const lato = Math.min(
  Math.round(256 * risVista / RIS_RIF),
  Math.min(rif.width, rif.height),
);
const a = await sharp(nostro).greyscale().resize(128, 128, {fit: 'fill'}).raw().toBuffer();
const c = await sharp(RIF)
  .extract({left: Math.round((rif.width - lato) / 2), top: Math.round((rif.height - lato) / 2), width: lato, height: lato})
  .greyscale().resize(128, 128, {fit: 'fill'}).raw().toBuffer();

const med = v => v.reduce((s, x) => s + x, 0) / v.length;
const ma = med(a), mc = med(c);
let num = 0, da = 0, dc = 0;
for (let i = 0; i < a.length; i++) {
  num += (a[i] - ma) * (c[i] - mc);
  da += (a[i] - ma) ** 2;
  dc += (c[i] - mc) ** 2;
}
const r = num / Math.sqrt(da * dc);
console.log(`  correlazione con gdaldem a z${ZOOM}: ${r.toFixed(3)}`);
if (r < 0) console.log('  ⚠ NEGATIVA: ombra invertita (vette lette come valli)');
else if (r < SOGLIA) console.log(`  ⚠ sotto ${SOGLIA}: la forma non corrisponde, il calcolo aggiunge artefatti`);
else console.log('  ok');
process.exit(r >= SOGLIA ? 0 : 1);
