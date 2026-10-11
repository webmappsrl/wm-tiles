#!/usr/bin/env node
/**
 * Elenco delle tile PNG da rifare fra due versioni degli archivi.
 *
 * Confronta tile per tile gli archivi omonimi delle due cartelle e, per ogni
 * archivio, porta le tile vettoriali cambiate alle tile PNG che ne dipendono:
 * le vicine (le etichette sconfinano) e, al maxzoom dell'archivio, i livelli
 * in overzoom fino a `--zmax`. L'elenco esce su stdout, una tile per riga,
 * pronto per `render-png.mjs --tiles`; il riepilogo va su stderr.
 *
 * Non vede cio' che non sta negli archivi versionati: un cambio di STILE, di
 * sprite o del DEM (`data/archives/dem`) cambia tutti i PNG e va
 * rigenerato per intero, con `render-png.mjs --bbox`.
 *
 * `--bbox W,S,E,N` tiene solo le tile che toccano un riquadro: serve alle
 * prove su una parte di cella, e a consegnare un'area alla volta.
 *
 * Uso: node pipeline/diff-versioni.mjs <dir-vecchia> <dir-nuova> [--zmin 0] [--zmax 16] [--bbox W,S,E,N] > tile.txt
 */
import {existsSync, readFileSync} from 'node:fs';
import {diffVersioni} from '../src/archive/diff.js';
import {chiave, tileDaRendere, toccaBbox} from '../src/raster/tiles.js';
import {ARCHIVES} from '../src/server.js';
import {livelliArchivi} from '../src/raster/visibilita.js';

const argv = process.argv.slice(2);
const opz = (nome, def) => {
  const i = argv.indexOf(`--${nome}`);
  return i >= 0 ? argv.splice(i, 2)[1] : def;
};
const zmin = Number(opz('zmin', 0));
const zmax = Number(opz('zmax', 16));
const bboxArg = opz('bbox', '');
const bbox = bboxArg ? bboxArg.split(',').map(Number) : null;
if (bbox && (bbox.length !== 4 || bbox.some(v => !Number.isFinite(v)))) {
  console.error(`--bbox vuole W,S,E,N, non "${bboxArg}"`);
  process.exit(2);
}
const [vecchia, nuova] = argv;
if (!vecchia || !nuova) {
  console.error('uso: diff-versioni.mjs <dir-vecchia> <dir-nuova> [--zmin 0] [--zmax 16]');
  process.exit(2);
}
for (const d of [vecchia, nuova]) {
  if (!existsSync(d)) {
    console.error(`cartella inesistente: ${d}`);
    process.exit(2);
  }
}

const diff = await diffVersioni(vecchia, nuova, ARCHIVES);
if (!Object.keys(diff).length) {
  console.error(`nessun archivio di ${ARCHIVES.join(', ')} in ${nuova}`);
  process.exit(1);
}

const tutte = new Map();
// Una tile cambiata conta solo ai livelli in cui lo stile disegna l'archivio
// (src/raster/visibilita.js): oltre, il PNG non ne dipende.
const leggi = rel => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const livelli = livelliArchivi(leggi('../style/webmapp.json'), leggi('../style/zoom-profile.json'));

for (const [nome, d] of Object.entries(diff)) {
  const vis = livelli(nome);
  if (!vis) {
    console.error(`  ${nome.padEnd(10)} non disegnato dallo stile: ignorato`);
    continue;
  }
  const png = tileDaRendere(d.cambiate, {
    archMaxZoom: d.maxZoom, zmin: Math.max(zmin, vis.zmin), zmax: Math.min(zmax, vis.zmax),
  });
  for (const t of png) tutte.set(chiave(t), t);
  const nota = d.nuovoArchivio ? ' (archivio nuovo: tutte)' : '';
  console.error(`  ${nome.padEnd(10)} ${String(d.cambiate.length).padStart(7)} cambiate su ${d.totale}` +
    ` -> ${png.length} PNG${nota}`);
}

const ordinate = [...tutte.values()]
  .filter(t => !bbox || toccaBbox(t, bbox))
  .sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y);
if (bbox) console.error(`  nel riquadro ${bbox.join(',')}`);
const perZ = {};
for (const t of ordinate) perZ[t.z] = (perZ[t.z] ?? 0) + 1;
console.error(`  totale PNG da rifare: ${ordinate.length}  ` +
  Object.entries(perZ).map(([z, n]) => `z${z}:${n}`).join(' '));
process.stdout.write(ordinate.map(chiave).join('\n') + (ordinate.length ? '\n' : ''));
