#!/usr/bin/env node
/**
 * Pixel di un colore (con tolleranza) nei PNG di TGen e locali delle tile di
 * un giro di revisione, per livello: misura grossolana di quanto testo di un
 * certo colore (nomi dei boschi, dei parchi...) scrivono i due lati.
 *
 * Uso: node tools/conta-colore.mjs <giro> <#rrggbb> [tolleranza] [dir-png-locali]
 */
import sharp from 'sharp';
import {existsSync, readFileSync} from 'node:fs';
const [giro, hex, tol = '24', dirLoc] = process.argv.slice(2);
const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const r = JSON.parse(readFileSync(`data/revisione/${giro}/risultati.json`, 'utf8'));
const conta = async f => {
  if (!existsSync(f)) return null;
  const d = await sharp(f).removeAlpha().resize(256, 256).raw().toBuffer();
  let n = 0;
  for (let i = 0; i < d.length; i += 3) if (Math.abs(d[i] - c[0]) + Math.abs(d[i + 1] - c[1]) + Math.abs(d[i + 2] - c[2]) <= Number(tol)) n++;
  return n;
};
const per = {};
for (const t of r.risultati) {
  const a = await conta(`data/ref-cache/${t.tile.replaceAll('/', '-')}.png`), b = await conta(`${dirLoc ?? `data/revisione/${giro}/png`}/${t.tile}.png`);
  if (a === null || b === null) continue;
  (per[t.z] ??= [0, 0, 0]); per[t.z][0] += a; per[t.z][1] += b; per[t.z][2]++;
}
for (const [z, [a, b, n]] of Object.entries(per)) console.log(`z${z}: ${n} tile, TGen ${a} px, locale ${b} px${a ? ` (rapporto ${(b / a).toFixed(2)})` : ''}`);
