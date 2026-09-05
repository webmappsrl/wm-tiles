/**
 * Riempie la cache locale delle tile di riferimento, una per volta.
 *
 * `api.webmapp.it` e' un server di produzione che risponde in 5-12 secondi
 * per tile e rallenta sotto richieste ravvicinate: scaricare in raffica
 * durante una taratura lo ha portato a non rispondere. Qui si scarica in
 * sequenza con una pausa, una volta sola — quelle tile non cambiano, perche'
 * il rendering dell'Italia e' fermo e l'aggiornamento OSM e' spento.
 *
 * Uso: node tools/fill-ref-cache.mjs [lon,lat] [zmin] [zmax] [pausa-ms]
 */
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';

const [lon, lat] = (process.argv[2] ?? '10.72,44.21').split(',').map(Number);
const ZMIN = Number(process.argv[3] ?? 10);
const ZMAX = Number(process.argv[4] ?? 16);
const PAUSA = Number(process.argv[5] ?? 1500);
const DIR = process.env.WM_REF_CACHE ?? 'data/ref-cache';
const LEGACY = process.env.WM_LEGACY ?? 'https://api.webmapp.it/tiles';

mkdirSync(DIR, {recursive: true});
const tileOf = z => {
  const n = 2 ** z;
  return [z,
    Math.floor(((lon + 180) / 360) * n),
    Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n)];
};

let scaricate = 0, giaPresenti = 0, fallite = 0;
for (let z = ZMIN; z <= ZMAX; z++) {
  // la tile del punto e le otto intorno: bastano per i confronti e per
  // spostarsi un poco senza tornare in rete
  const [, cx, cy] = tileOf(z);
  for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) {
    const x = cx + dx, y = cy + dy;
    const file = `${DIR}/${z}-${x}-${y}.png`;
    if (existsSync(file)) { giaPresenti++; continue; }
    let ok = false;
    for (let t = 1; t <= 3 && !ok; t++) {
      try {
        const res = await fetch(`${LEGACY}/${z}/${x}/${y}.png`, {signal: AbortSignal.timeout(45000)});
        if (!res.ok) { console.log(`  ${z}/${x}/${y}: HTTP ${res.status}`); ok = true; break; }
        writeFileSync(file, Buffer.from(await res.arrayBuffer()));
        scaricate++; ok = true;
        process.stdout.write(`\r  scaricate ${scaricate}, in cache ${giaPresenti}, fallite ${fallite}   `);
      } catch (e) {
        if (t === 3) { fallite++; console.log(`\n  ${z}/${x}/${y}: ${e.cause?.code ?? e.name}`); }
        else await new Promise(r => setTimeout(r, t * 4000));
      }
    }
    await new Promise(r => setTimeout(r, PAUSA));
  }
}
console.log(`\n  ${DIR}: ${scaricate} scaricate, ${giaPresenti} gia' presenti, ${fallite} fallite`);
