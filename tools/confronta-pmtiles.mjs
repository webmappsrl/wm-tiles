#!/usr/bin/env node
/**
 * Due archivi PMTiles hanno le stesse tile? Confronta i byte di ogni tile,
 * livello per livello, su un riquadro. I file interi non si confrontano:
 * tippecanoe scrive nei metadati la propria riga di comando, con il percorso
 * della cartella temporanea, diverso a ogni esecuzione.
 *
 * Serve a verificare che una modifica alla pipeline che non deve cambiare il
 * risultato (per esempio estrazioni in parallelo invece che in sequenza) non
 * lo cambi davvero.
 *
 * Uso: node tools/confronta-pmtiles.mjs a.pmtiles b.pmtiles W,S,E,N [zmin-zmax]
 * Esce 1 se una tile differisce o esiste in un archivio solo.
 */
import {openSync, readSync} from 'node:fs';
import {PMTiles} from 'pmtiles';
import {tileInBbox} from '../src/raster/tiles.js';

const [a, b, bbox, zz] = process.argv.slice(2);
if (!bbox) { console.error('uso: confronta-pmtiles.mjs a.pmtiles b.pmtiles W,S,E,N [zmin-zmax]'); process.exit(2); }
class File {
  constructor(p) { this.p = p; this.fd = openSync(p, 'r'); }
  getKey() { return this.p; }
  async getBytes(o, l) { const buf = Buffer.alloc(l); readSync(this.fd, buf, 0, l, o); return {data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + l)}; }
}
const A = new PMTiles(new File(a)), B = new PMTiles(new File(b));
const [ha, hb] = [await A.getHeader(), await B.getHeader()];
const [z0, z1] = zz ? zz.split('-').map(Number) : [Math.min(ha.minZoom, hb.minZoom), Math.max(ha.maxZoom, hb.maxZoom)];
let uguali = 0, diverse = 0, soloUno = 0;
for (let z = z0; z <= z1; z++) {
  for (const t of tileInBbox(bbox.split(',').map(Number), z)) {
    const [ta, tb] = [await A.getZxy(z, t.x, t.y), await B.getZxy(z, t.x, t.y)];
    if (!ta && !tb) continue;
    if (!ta || !tb) { soloUno++; if (soloUno <= 5) console.log(`  solo in ${ta ? 'a' : 'b'}: ${z}/${t.x}/${t.y}`); continue; }
    if (Buffer.from(ta.data).equals(Buffer.from(tb.data))) uguali++;
    else { diverse++; if (diverse <= 5) console.log(`  diversa: ${z}/${t.x}/${t.y}`); }
  }
}
console.log(`z${z0}-z${z1}: ${uguali} tile uguali, ${diverse} diverse, ${soloUno} in un archivio solo`);
process.exit(diverse || soloUno ? 1 : 0);
