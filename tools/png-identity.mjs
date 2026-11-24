#!/usr/bin/env node
/**
 * Gate di identita' dei PNG: rete di protezione per ogni modifica a
 * src/raster/ombra.js (o a stile-nativo.js). I PNG di api.webmapp.it/tiles devono
 * restare identici ai livelli interi; senza un riferimento salvato PRIMA della
 * modifica, una differenza non avrebbe niente con cui confrontarsi.
 *
 * Rende le tile con il percorso nativo vero (pipeline/render-png.mjs, maplibre-native)
 * e confronta i PIXEL, non i byte del file: lo sha256 e' dei pixel grezzi.
 * Serve il server acceso.
 *
 * Perche' una soglia (misurata il 23 novembre 2026): la stessa tile, resa piu' volte,
 * non e' sempre identica al pixel. Su 13/4334/2986 ricorrono quattro varianti
 * intermittenti, che differiscono in 1 pixel su 65.536 per al massimo 1 livello. Non
 * e' la compressione parallela di libvips (VIPS_CONCURRENCY=1 non le toglie); viene dal
 * render del "sopra" (curve ed etichette) di maplibre-native. Il CLAUDE.md dice "byte
 * per byte": la misura lo smentisce. Si accetta quindi il rumore misurato con un margine,
 * e nient'altro: una modifica sbagliata all'ombra sposta migliaia di pixel di parecchi
 * livelli.
 *
 * Il riferimento sta in due posti: il JSON (hash dei pixel e dimensioni di ogni tile) e
 * le immagini di riferimento in `png-ref/`, accanto al file (servono a MISURARE la differenza
 * quando l'hash non coincide).
 *
 * Uso:
 *   node tools/png-identity.mjs --save <file.json> <z/x/y>...   scrive hash e immagini
 *   node tools/png-identity.mjs --check <file.json>             esce 1 alla prima differenza
 * Opzione: --base http://localhost:8080
 */
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_BASE = process.env.WM_BASE ?? 'http://localhost:8080';

// Soglia del rumore: fino a 8 pixel diversi, ognuno di al massimo 1 livello.
// Misura: 1 pixel su 65.536 e delta massimo 1 (tile z13, quattro varianti); 8 e' un margine.
export const NOISE_MAX_PIXELS = 8;
export const NOISE_MAX_DELTA = 1;

const sha256 = buf => createHash('sha256').update(buf).digest('hex');

/** Rende UNA tile (un processo, come render-png.mjs da riga di comando) e ne restituisce il PNG. */
function renderPng(tile, base) {
  const dir = mkdtempSync(join(tmpdir(), 'png-identity-'));
  try {
    const list = join(dir, 'tile.txt');
    writeFileSync(list, `${tile}\n`);
    const out = join(dir, 'png');
    const r = spawnSync(process.execPath, [
      join(ROOT, 'pipeline/render-png.mjs'), '--tiles', list, '--out', out, '--base', base,
    ], {encoding: 'utf8', cwd: ROOT, maxBuffer: 64 * 1024 * 1024});
    if (r.status !== 0) {
      throw new Error(`render-png.mjs fallito su ${tile} (codice ${r.status}): ${(r.stderr || r.stdout).trim().slice(-500)}`);
    }
    return readFileSync(join(out, `${tile}.png`)); // manca => ENOENT, rumoroso
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}

const decode = async png => {
  const {data, info} = await sharp(png).raw().toBuffer({resolveWithObject: true});
  return {data, width: info.width, height: info.height, channels: info.channels};
};

/** Rende le tile e restituisce Map `z/x/y` -> sha256 dei PIXEL grezzi. */
export async function hashTiles(tiles, base = DEFAULT_BASE) {
  const hashes = new Map();
  for (const t of tiles) hashes.set(t, sha256((await decode(renderPng(t, base))).data));
  return hashes;
}

/** Quanti pixel differiscono (almeno un canale) e di quanto al massimo; null se le dimensioni non coincidono. */
export function diffPixels(a, b) {
  if (a.width !== b.width || a.height !== b.height || a.channels !== b.channels) return null;
  let pixels = 0, maxDelta = 0;
  for (let p = 0; p < a.width * a.height; p++) {
    let differs = false;
    for (let c = 0; c < a.channels; c++) {
      const d = Math.abs(a.data[p * a.channels + c] - b.data[p * a.channels + c]);
      if (d) { differs = true; if (d > maxDelta) maxDelta = d; }
    }
    if (differs) pixels++;
  }
  return {pixels, maxDelta};
}

/**
 * Confronta una resa con il riferimento di una tile. Restituisce {ok, message}.
 * ref: {hash, width, height}; refImage: oggetto di decode() del PNG di riferimento.
 */
export async function compareTile(tile, ref, refImage, png) {
  const now = await decode(png);
  if (now.width !== ref.width || now.height !== ref.height) {
    return {ok: false, message: `${tile}: dimensioni diverse, ${now.width}x${now.height} contro il riferimento ${ref.width}x${ref.height}`};
  }
  if (sha256(now.data) === ref.hash) return {ok: true, message: `${tile}: identica`};
  const d = diffPixels(refImage, now);
  if (!d) return {ok: false, message: `${tile}: canali diversi dal riferimento`};
  const ok = d.pixels <= NOISE_MAX_PIXELS && d.maxDelta <= NOISE_MAX_DELTA;
  return {
    ok,
    message: `${tile}: ${d.pixels} pixel diversi, delta massimo ${d.maxDelta} ` +
      (ok ? `(entro il rumore: ${NOISE_MAX_PIXELS} pixel, delta ${NOISE_MAX_DELTA})` : `(oltre il rumore: ${NOISE_MAX_PIXELS} pixel, delta ${NOISE_MAX_DELTA})`),
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = n => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const base = opt('base') ?? DEFAULT_BASE;
  const version = async () => {
    const v = await fetch(`${base}/version`).then(r => r.json()).catch(() => null);
    if (!v?.current) throw new Error(`il server ${base} non risponde o non ha una versione corrente`);
    return v.current;
  };
  // le immagini di riferimento stanno in `png-ref/`, accanto al file JSON
  const refDir = file => join(dirname(resolve(file)), 'png-ref');
  const refPath = (file, t) => join(refDir(file), `${t.replaceAll('/', '_')}.png`);
  if (opt('save')) {
    const file = opt('save');
    const tiles = argv.filter((a, i) => /^\d+\/\d+\/\d+$/.test(a) && argv[i - 1] !== '--save');
    if (!tiles.length) throw new Error('--save vuole almeno una tile z/x/y');
    const ver = await version();
    mkdirSync(refDir(file), {recursive: true});
    const out = {};
    for (const t of tiles) {
      const png = renderPng(t, base);
      const img = await decode(png);
      writeFileSync(refPath(file, t), png);
      out[t] = {hash: sha256(img.data), width: img.width, height: img.height};
    }
    writeFileSync(file, JSON.stringify({version: ver, tiles: out}, null, 2) + '\n');
    console.log(`${tiles.length} tile salvate in ${file} (versione dati ${ver})`);
  } else if (opt('check')) {
    const file = opt('check');
    const ref = JSON.parse(readFileSync(file, 'utf8'));
    const ver = await version();
    if (ref.version !== ver) console.error(`attenzione: versione dati ${ver}, il riferimento e' di ${ref.version}`);
    for (const [t, r] of Object.entries(ref.tiles)) {
      if (!existsSync(refPath(file, t))) throw new Error(`manca l'immagine di riferimento ${refPath(file, t)}`);
      const res = await compareTile(t, r, await decode(readFileSync(refPath(file, t))), renderPng(t, base));
      console.log(`  ${res.message}`);
      if (!res.ok) { console.error(`DIFFERENZA: ${res.message}`); process.exit(1); }
    }
    console.log(`identiche (entro il rumore): ${Object.keys(ref.tiles).length} tile`);
  } else {
    console.error('uso: png-identity.mjs --save <file> <z/x/y>... | --check <file>  [--base url]');
    process.exit(2);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e.message); process.exit(1); });
}
