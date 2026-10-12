#!/usr/bin/env node
/**
 * Scrive il verdetto dell'AI su una difformita' trovata da revisione.mjs.
 * Le misure si prendono dal giro indicato, cosi' il verdetto resta legato a
 * cio' che si e' visto.
 *
 * Uso: node tools/revisione-verdetto.mjs <giro> <id> <verdetto> "<motivo>"
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {VERDETTI, leggi, registra} from '../src/revisione/registro.js';

const [giro, id, verdetto, motivo] = process.argv.slice(2);
if (!motivo) {
  console.error(`uso: revisione-verdetto.mjs <giro> <id> <${VERDETTI.join('|')}> "<motivo>"`);
  process.exit(2);
}
const REG = 'docs/revisione/verdetti.json';
const ris = JSON.parse(readFileSync(`data/revisione/${giro}/risultati.json`, 'utf8'));
const d = ris.difformita.find(q => q.id === id);
if (!d) { console.error(`${id}: non e' fra le difformita' del giro ${giro}`); process.exit(1); }
writeFileSync(REG, JSON.stringify(registra(leggi(REG), {id, verdetto, motivo, giro, misure: d.misure}), null, 2) + '\n');
console.log(`${id}: ${verdetto}`);
