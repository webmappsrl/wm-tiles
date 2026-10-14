#!/usr/bin/env node
/**
 * Conta i cartellini stradali in due serie di PNG (TGen e locale), sulle tile
 * di un giro di revisione: regioni connesse del colore di fondo dei cartellini
 * (239,228,206 in TGen) piu' grandi di un cartellino minimo. Serve a tarare la
 * densita' dei cartellini dei livelli bassi, che nessuna misura per classe vede.
 *
 * Uso: node tools/conta-cartellini.mjs <giro> <z> [dir-png-locali]
 */
import sharp from 'sharp';
import {existsSync, readFileSync} from 'node:fs';

const [giro, zs, dirLoc] = process.argv.slice(2);
const r = JSON.parse(readFileSync(`data/revisione/${giro}/risultati.json`, 'utf8'));
const tiles = r.risultati.filter(t => t.z === Number(zs)).map(t => t.tile);
const FONDO = [239, 228, 206];
async function conta(f) {
  if (!existsSync(f)) return null;
  const {data, info} = await sharp(f).removeAlpha().resize(256, 256).raw().toBuffer({resolveWithObject: true});
  const N = info.width * info.height, m = new Uint8Array(N);
  for (let i = 0; i < N; i++) m[i] = Math.abs(data[3 * i] - FONDO[0]) + Math.abs(data[3 * i + 1] - FONDO[1]) + Math.abs(data[3 * i + 2] - FONDO[2]) <= 9 ? 1 : 0;
  let n = 0; const visto = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (!m[i] || visto[i]) continue;
    let k = 0; const pila = [i]; visto[i] = 1;
    while (pila.length) { const j = pila.pop(); k++; const x = j % 256;
      for (const v of [x > 0 ? j - 1 : -1, x < 255 ? j + 1 : -1, j - 256, j + 256]) if (v >= 0 && v < N && m[v] && !visto[v]) { visto[v] = 1; pila.push(v); } }
    if (k >= 40) n++;
  }
  return n;
}
let a = 0, b = 0, nt = 0;
for (const t of tiles) {
  const x = await conta(`data/ref-cache/${t.replaceAll('/', '-')}.png`);
  const y = await conta(`${dirLoc ?? `data/revisione/${giro}/png`}/${t}.png`);
  if (x === null || y === null) continue;
  a += x; b += y; nt++;
}
console.log(`z${zs}: ${nt} tile, cartellini TGen ${a}, locale ${b} (rapporto ${(b / a).toFixed(2)})`);
