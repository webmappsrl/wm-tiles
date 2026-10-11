#!/usr/bin/env node
/**
 * Rende le tile PNG con OpenLayers in un Chromium headless, cioe' con lo stesso
 * motore con cui le app disegneranno le tile vettoriali.
 *
 * NON e' piu' il renderer dei PNG: dall'11 ottobre 2026 lo e'
 * `render-png.mjs`, con maplibre-native (vedi notes.md). Senza GPU questo e'
 * circa 60 volte piu' lento e dipende dal WebGL software di Chrome. Resta per
 * i confronti: mostra cio' che vedra' un'app col vettoriale, e
 * `tools/ombra-native-vs-ol.mjs` lo usa per verificare che le due ombre
 * coincidano.
 *
 * Si disegna a metatile (blocchi di `--lato` x `--lato` tile con un margine
 * attorno) e si ritaglia: una tile disegnata da sola taglierebbe le
 * etichette sui bordi, e la vicina le metterebbe altrove.
 *
 * Le tile scritte sono quelle della versione CORRENTE del server: il flusso
 * e' pubblicare la nuova versione, confrontarla con la precedente
 * (`diff-versioni.mjs`) e rendere l'elenco.
 *
 * Uso:
 *   node pipeline/render-png-ol.mjs --tiles tile.txt [--out data/png]
 *   node pipeline/render-png-ol.mjs --bbox W,S,E,N --zoom 8-16 [--out data/png]
 * Opzioni: --base http://localhost:8080  --lato 4  --margine 128
 *          --query '&only=a,b'  (parametri in piu' per la preview)
 */
import {chromium} from 'playwright';
import sharp from 'sharp';
import {mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {parseZxy, raggruppa, tileInBbox, vistaMetatile} from '../src/raster/tiles.js';

const argv = process.argv.slice(2);
const opz = (nome, def) => {
  const i = argv.indexOf(`--${nome}`);
  return i >= 0 ? argv[i + 1] : def;
};
const OUT = opz('out', 'data/png');
const BASE = opz('base', process.env.WM_BASE ?? 'http://localhost:8080');
const LATO = Number(opz('lato', 4));
const MARGINE = Number(opz('margine', 128));

let tiles;
if (opz('tiles')) {
  tiles = readFileSync(opz('tiles'), 'utf8').split('\n').filter(r => r.trim()).map(parseZxy);
} else if (opz('bbox')) {
  const bbox = opz('bbox').split(',').map(Number);
  const [za, zb] = (opz('zoom', '8-16')).split('-').map(Number);
  if (bbox.length !== 4 || bbox.some(v => !Number.isFinite(v))) throw new Error('--bbox vuole W,S,E,N');
  tiles = [];
  for (let z = za; z <= (zb ?? za); z++) tiles.push(...tileInBbox(bbox, z));
} else {
  console.error('uso: render-png-ol.mjs --tiles <file> | --bbox W,S,E,N --zoom a-b  [--out dir]');
  process.exit(2);
}

// Il server deve rispondere PRIMA di aprire il browser: altrimenti la
// preview carica una pagina d'errore e si renderebbero tile vuote.
const ver = await fetch(`${BASE}/version`).then(r => r.json()).catch(() => null);
if (!ver?.current) {
  console.error(`il server ${BASE} non risponde o non ha una versione corrente`);
  process.exit(1);
}

// Sotto il livello minimo del DEM l'ombreggiatura non c'e', ma il layer
// chiede comunque le tile di quel livello per tutta la vista: a z0 sono
// decine di migliaia di richieste, e un metatile impiegava due minuti prima
// di andare in timeout. Li' si disegna senza (`?shade=off`).
const stile = await fetch(`${BASE}/style.json`).then(r => r.json());
const DEM_MIN = stile.sources?.terrain?.minzoom ?? 0;

const blocchi = raggruppa(tiles, LATO);
console.log(`  ${tiles.length} tile in ${blocchi.length} metatile, versione ${ver.current} -> ${OUT}`);

// Stessi argomenti di tile-diff.mjs: con `--use-angle=default` il layer
// WebGL dell'ombreggiatura non viene disegnato, senza errori.
const browser = await chromium.launch({args: ['--use-gl=angle', '--enable-unsafe-swiftshader']});
const NASCONDI = '.pane h2, #err, .ol-control, #bar { display: none !important; }';

/** Aspetta che la mappa abbia finito: `rendercomplete` da solo non basta (vedi tile-diff.mjs). */
async function attendi(p) {
  await p.evaluate(() => new Promise(res => {
    let fatto = false;
    const fine = () => { if (!fatto) { fatto = true; res(); } };
    window.__wm.left.once('rendercomplete', fine);
    window.__wm.left.render();
    setTimeout(fine, 20000);
  }));
  await p.waitForTimeout(4500);
}

const luminosita = async buf => {
  const st = await sharp(buf).removeAlpha().stats();
  return 0.299 * st.channels[0].mean + 0.587 * st.channels[1].mean + 0.114 * st.channels[2].mean;
};

let scritte = 0;
const t0 = Date.now();
try {
  for (const [i, m] of blocchi.entries()) {
    const v = vistaMetatile(m, MARGINE);
    const ctx = await browser.newContext({viewport: {width: v.pixel, height: v.pixel}, deviceScaleFactor: 1});
    const p = await ctx.newPage();
    const url = `${BASE}/preview/?single=left&zoom=${m.z}&c=${v.lon},${v.lat}` +
      (m.z < DEM_MIN ? '&shade=off' : '') + opz('query', '');
    await p.goto(url, {waitUntil: 'networkidle', timeout: 60000});
    await p.addStyleTag({content: NASCONDI});
    await attendi(p);

    // Un errore nello stile toglie un layer intero senza altri segnali, e un
    // blend non applicato compone l'ombra in modo normale: in entrambi i
    // casi i PNG sarebbero sbagliati, quindi ci si ferma.
    const errore = await p.evaluate(() => document.getElementById('err')?.textContent?.trim() ?? '');
    if (errore) throw new Error(`errore nello stile a ${m.z}/${m.mx}/${m.my}: ${errore.slice(0, 300)}`);
    const blend = await p.evaluate(() => {
      const el = [...document.querySelectorAll('[class*="wm-blend-"]')];
      if (!el.length) return '';
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
    if (blend) throw new Error(`composizione dell'ombra sbagliata a z${m.z}: ${blend}`);

    // Tre scatti al massimo, si tiene il piu' scuro: circa un giro su quattro
    // l'ombreggiatura non e' ancora disegnata, e l'ombra puo' solo scurire.
    const scatti = [];
    for (let k = 0; k < 3; k++) {
      if (k) {
        await p.reload({waitUntil: 'networkidle', timeout: 60000});
        await p.addStyleTag({content: NASCONDI});
        await attendi(p);
      }
      const buf = await p.screenshot({clip: {x: 0, y: 0, width: v.pixel, height: v.pixel}});
      scatti.push({buf, lum: await luminosita(buf)});
      if (k && Math.abs(scatti[k].lum - scatti[k - 1].lum) < 0.3) break;
    }
    scatti.sort((a, b) => a.lum - b.lum);
    const meta = scatti[0].buf;
    await ctx.close();

    for (const t of m.tiles) {
      const png = await sharp(meta).extract(v.ritaglio(t)).png().toBuffer();
      const dest = join(OUT, String(t.z), String(t.x), `${t.y}.png`);
      mkdirSync(dirname(dest), {recursive: true});
      // scrittura atomica: chi serve la cartella non vede mai un PNG a meta'
      writeFileSync(`${dest}.tmp`, png);
      renameSync(`${dest}.tmp`, dest);
      scritte++;
    }
    const s = (Date.now() - t0) / 1000;
    console.log(`  [${i + 1}/${blocchi.length}] z${m.z} ${m.mx},${m.my}: ${m.tiles.length} tile` +
      ` (${scatti.length} scatti) — ${scritte} scritte in ${s.toFixed(0)} s`);
  }
} finally {
  await browser.close();
}
console.log(`  fatto: ${scritte} PNG in ${OUT}`);
