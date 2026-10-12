#!/usr/bin/env node
/**
 * Rigenera la pagina di un giro con i verdetti di oggi, senza rifare il giro:
 * i verdetti si scrivono dopo, guardando i dossier, e la pagina scritta dal
 * giro li mostrerebbe ancora tutti aperti.
 *
 * Uso: node tools/revisione-pagina.mjs <giro>   (poi: open data/revisione/<giro>/index.html)
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {leggi, stato} from '../src/revisione/registro.js';
import {pagina} from '../src/revisione/report.js';

const giro = process.argv[2];
if (!giro) { console.error('uso: revisione-pagina.mjs <giro>'); process.exit(2); }
const dir = `data/revisione/${giro}`;
const r = JSON.parse(readFileSync(`${dir}/risultati.json`, 'utf8'));
const registro = leggi('docs/revisione/verdetti.json');
const stati = Object.fromEntries(r.difformita.map(d => [d.id, stato(d, registro)]));
writeFileSync(`${dir}/index.html`, pagina({giro, tabella: r.tabella, difformita: r.difformita, stati, scarti: r.scarti, registro}));
console.log(`${dir}/index.html`);
