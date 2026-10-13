#!/usr/bin/env node
/**
 * Gli SVG delle icone dei punti di interesse, dai simboli di TGen, nella
 * cartella dello sprite: uno per ogni icona e colore che le regole di
 * style/amenity-regole.json usano entro z16.
 *
 * Il colore e' quello di `marker-fill` della regola: Mapnik lo applica al
 * posto dei colori del disegno, quindi qui si sostituiscono tutti i fill
 * (tranne `none`) e lo si mette sul tag <svg> per i path che non ne hanno.
 * Il nome e' `tg-<icona>-<colore>`, lo stesso che build-amenity.py scrive nel
 * dato; build-sprite.mjs non ricolora le icone `tg-`.
 *
 * Uso: node pipeline/svg-amenity.mjs [data/tgen-style] [style/sprite/svg]
 */
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const SORG = process.argv[2] ?? 'data/tgen-style';
const DEST = process.argv[3] ?? 'style/sprite/svg';
const regole = JSON.parse(readFileSync('style/amenity-regole.json', 'utf8'));

const fatte = new Map();
for (const r of Object.values(regole).flat()) {
  if (r.da > 16) continue;
  fatte.set(`tg-${r.icona}-${r.colore.replace('#', '')}`, r);
}
// Le fermate degli autobus: TGen mette un quadratino blu a z16 e l'autobus
// solo da z17. Il quadratino sembra un refuso e l'utente ha scelto l'autobus
// gia' da z16 (13 ottobre 2026): il simbolo serve anche se la sua regola parte
// da z17. Lo usa il layer bus-stop-icon.
for (const r of regole.punti) {
  if (r.icona === 'bus_stop.12') fatte.set(`tg-${r.icona}-${r.colore.replace('#', '')}`, r);
}
// le frecce dei sensi unici (build-frecce.py), una per colore di classe
for (const c of new Set(Object.values(JSON.parse(readFileSync('style/frecce-colori.json', 'utf8')).colori))) {
  fatte.set(`tg-oneway-${c.replace('#', '')}`, {percorso: 'symbols/oneway.svg', colore: c});
}
let n = 0;
for (const [nome, r] of fatte) {
  const f = join(SORG, r.percorso);
  if (!existsSync(f)) { console.error(`!! manca ${f}`); process.exitCode = 1; continue; }
  const c = r.colore;
  const svg = readFileSync(f, 'utf8')
    .replace(/fill:\s*(?!none)[#\w]+/g, `fill:${c}`)
    .replace(/fill="(?!none)[^"]*"/g, `fill="${c}"`)
    .replace(/<svg\b/, `<svg fill="${c}"`);
  writeFileSync(join(DEST, `${nome}.svg`), svg);
  n++;
}
console.log(`${n} icone in ${DEST}`);
