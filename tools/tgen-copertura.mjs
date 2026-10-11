/**
 * Layer del project.mml di TGen che disegnano qualcosa fino a z16 e che nello
 * stile locale non hanno corrispondenza.
 *
 * Una misura per elemento confronta solo cio' che esiste da entrambe le parti:
 * un layer di TGen senza alcun layer locale resta invisibile a ogni metrica.
 * Ferrovie, uscite autostradali, aeroporti, stazioni sono mancati per mesi.
 *
 * Un layer conta come coperto se un layer locale lo cita in `tgen` o in `copre`
 * (style/tgen-mapping.json). I layer senza regole attive fino a z16 non
 * compaiono; attenzione: parse-cartocss non legge i selettori di classe
 * (`.stations`, `.text`), quindi un layer con sole regole di classe risulta
 * "senza regole" anche quando disegna (vedi stations.mss).
 *
 * Esce con codice 1 se trova layer scoperti, cosi' puo' fare da controllo.
 *
 * Uso: node tools/tgen-copertura.mjs
 */
import {readFileSync} from 'node:fs';

const cc = JSON.parse(readFileSync('data/tgen-cartocss.json', 'utf8'));
const mapping = JSON.parse(readFileSync('style/tgen-mapping.json', 'utf8')).layers;
const coperti = new Set();
for (const v of Object.values(mapping)) for (const t of [].concat(v.tgen ?? [], v.copre ?? [])) coperti.add(t);

const scoperti = [];
for (const [i, o] of cc.ordineMml.entries()) {
  const t = cc.layer[o.id];
  const zs = t ? Object.keys(t.zoom).map(Number)
    .filter(z => (t.minzoom == null || z >= t.minzoom) && (t.maxzoom == null || z <= t.maxzoom) && z <= 16) : [];
  if (coperti.has(o.id) || !zs.length) continue;
  scoperti.push(`${String(i).padStart(3)}  ${o.id.padEnd(28)} z${zs[0]}-z${zs.at(-1)}`);
}
console.log(scoperti.length ? `${scoperti.length} layer di TGen senza corrispondenza locale:\n${scoperti.join('\n')}` : 'tutti i layer di TGen hanno una corrispondenza');
process.exit(scoperti.length ? 1 : 0);
