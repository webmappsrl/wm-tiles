#!/usr/bin/env node
/**
 * Larghezza (advance) di ogni carattere dei tre tipi di carattere dello
 * stile, dai glifi SDF serviti (corpo 24), in style/glifi-larghezze.json.
 * build-testi.py la usa per andare a capo come Mapnik: OpenLayers spezza le
 * righe prima di superare la larghezza, Mapnik dopo, e le stesse regole
 * davano righe diverse ("dei / Miracoli" invece di "dei Miracoli").
 *
 * Uso: node pipeline/larghezze-glifi.mjs
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {PbfReader} from 'pbf';

const out = {corpo: 24, font: {}};
for (const [sigla, font] of [['R', 'Noto Sans Regular'], ['I', 'Noto Sans Italic'], ['B', 'Noto Sans Bold']]) {
  const tab = {};
  for (const intervallo of ['0-255', '256-511', '8192-8447']) {
    let buf;
    try { buf = readFileSync(`style/glyphs/${font}/${intervallo}.pbf`); } catch { continue; }
    const pbf = new PbfReader(buf);
    pbf.readFields((tag, _, p) => {
      if (tag !== 1) return;
      p.readMessage((t2, __, p2) => {
        if (t2 !== 3) return;
        const g = p2.readMessage((t3, gg, p3) => {
          if (t3 === 1) gg.id = p3.readVarint();
          else if (t3 === 7) gg.advance = p3.readVarint();
        }, {});
        if (g.id !== undefined && g.advance !== undefined) tab[g.id] = g.advance;
      }, {});
    }, {});
  }
  if (!Object.keys(tab).length) { console.error(`!! nessun glifo per ${font}`); process.exit(1); }
  out.font[sigla] = tab;
}
writeFileSync('style/glifi-larghezze.json', JSON.stringify(out));
console.log(Object.entries(out.font).map(([k, v]) => `${k}: ${Object.keys(v).length} caratteri, "a" ${v[97]}`).join(' | '));
