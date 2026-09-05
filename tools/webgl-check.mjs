/**
 * Verifica quanto la mappa dipende da WebGL, e cosa resta senza.
 *
 * Il connettore girera' in una WebView su mobile, dove WebGL puo' essere
 * assente o disabilitato (GPU in lista nera, risparmio energetico, dispositivi
 * vecchi). Prima di scegliere l'ombreggiatura calcolata sulla GPU va misurato
 * cosa vede l'utente quando WebGL non c'e': se il resto della mappa regge,
 * il rischio e' un degrado accettabile; se la mappa sparisce, no.
 *
 * Uso: node tools/webgl-check.mjs [z] [lon,lat]
 */
import {chromium} from 'playwright';
import sharp from 'sharp';

const Z = Number(process.argv[2] ?? 14);
const [lon, lat] = (process.argv[3] ?? '10.7227,44.2137').split(',').map(Number);
const BASE = process.env.WM_BASE ?? 'http://localhost:8080';

const casi = [
  ['con WebGL', ['--use-gl=angle', '--enable-unsafe-swiftshader']],
  ['senza WebGL', ['--disable-webgl', '--disable-webgl2']],
];

for (const [nome, args] of casi) {
  const b = await chromium.launch({args});
  const p = await (await b.newContext({viewport: {width: 256, height: 256}})).newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await p.goto(`${BASE}/preview/?single=left&zoom=${Z}&c=${lon},${lat}`,
    {waitUntil: 'networkidle', timeout: 45000});
  await p.addStyleTag({content: '.pane h2, #err, .ol-control, #bar { display: none !important; }'});
  await p.waitForTimeout(6000);

  const stato = await p.evaluate(() => {
    const c = document.createElement('canvas');
    const l = window.__wm.left.getLayers().getArray()
      .find(x => (x.get('mapbox-layers') ?? []).includes('hillshade-calc'));
    return {
      webgl: !!c.getContext('webgl'),
      hillshadeVisibile: l?.getVisible() ?? null,
      nLayer: window.__wm.left.getLayers().getLength(),
      canvas: [...document.querySelectorAll('#left canvas')].length,
    };
  });
  const buf = await p.screenshot({clip: {x: 0, y: 0, width: 256, height: 256}});
  const st = await sharp(buf).removeAlpha().stats();
  const lum = 0.299 * st.channels[0].mean + 0.587 * st.channels[1].mean + 0.114 * st.channels[2].mean;
  const sd = 0.299 * st.channels[0].stdev + 0.587 * st.channels[1].stdev + 0.114 * st.channels[2].stdev;
  // una mappa vuota ha deviazione standard vicina a zero
  console.log(`  ${nome.padEnd(14)} webgl=${String(stato.webgl).padEnd(5)} lum ${lum.toFixed(1).padStart(6)} ` +
    `contrasto ${sd.toFixed(1).padStart(5)}  ${stato.nLayer} layer, ${stato.canvas} canvas` +
    `  ${sd < 3 ? '<- MAPPA VUOTA' : ''}${errs.length ? '  errori: ' + errs.slice(0, 2).join(' | ') : ''}`);
  await sharp(buf).resize(512, 512, {kernel: 'nearest'}).png()
    .toFile(`data/tiles/webgl-${nome.replace(/\s+/g, '-')}.png`);
  await b.close();
}
