/**
 * Cio' che l'AI legge dopo un giro: una pagina con la tabella livello x layer
 * e le difformita', e per ogni difformita' un dossier di immagini. Il dossier
 * mette affiancati TGen, locale e la differenza amplificata, con la zona del
 * residuo cerchiata: il giudizio "stile o contenuto" si da' guardando, e
 * deve poter essere ricontrollato da chi legge il verdetto.
 */
import sharp from 'sharp';

const LATO = 512, TESTA = 40;

/** `z14:residuo:#303030` -> `z14_residuo__303030.png`: niente `#` ne' `:` nei nomi. */
export const fileDossier = id => id.replace(/[^a-z0-9.-]/gi, '_') + '.png';
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const fmt = m => Object.entries(m).map(([k, v]) => `${k} ${typeof v === 'number' ? +v.toFixed(2) : v}`).join(' · ');

const png = (raw, w = 256, h = 256) => sharp(raw, {raw: {width: w, height: h, channels: 3}})
  .resize(LATO, LATO, {kernel: 'nearest'}).png().toBuffer();

export async function dossier({d, immagini, out}) {
  const strati = [{
    input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${3 * LATO}" height="${TESTA}">`
      + `<rect width="100%" height="100%" fill="#fff"/><text x="8" y="26" font-family="sans-serif" font-size="18">`
      + `${esc(d.id)} — ${esc(fmt(d.misure))} — TGen | locale | differenza</text></svg>`),
    top: 0, left: 0,
  }];
  for (const [r, im] of immagini.entries()) {
    const diff = Buffer.alloc(im.tgen.length);
    for (let i = 0; i < diff.length; i++) diff[i] = 255 - Math.min(255, 3 * Math.abs(im.tgen[i] - im.locale[i]));
    const top = TESTA + r * LATO;
    for (const [c, raw] of [im.tgen, im.locale, diff].entries()) strati.push({input: await png(raw), top, left: c * LATO});
    const [x0, y0, x1, y1] = im.bbox ?? [0, 0, 0, 0];
    const riquadro = im.bbox
      ? `<rect x="${x0 * 2 - 6}" y="${y0 * 2 - 6}" width="${(x1 - x0) * 2 + 12}" height="${(y1 - y0) * 2 + 12}" fill="none" stroke="red" stroke-width="3"/>` : '';
    const sopra = `<svg xmlns="http://www.w3.org/2000/svg" width="${LATO}" height="${LATO}">${riquadro}`
      + `<text x="6" y="${LATO - 8}" font-family="monospace" font-size="16" fill="red">${esc(im.tile)}</text></svg>`;
    for (let c = 0; c < 3; c++) strati.push({input: Buffer.from(sopra), top, left: c * LATO});
  }
  await sharp({create: {width: 3 * LATO, height: TESTA + immagini.length * LATO, channels: 3, background: '#fff'}})
    .composite(strati).png().toFile(out);
}

const COLORI = {conforme: '#d8f0d8', sparso: '#f6f0c8', stile: '#f6c8c8', presenza: '#f0d0f0', simboli: '#c8d8f6'};

export function pagina({giro, tabella, difformita, stati, scarti}) {
  const layer = [...new Set(Object.values(tabella).flatMap(Object.keys))].sort();
  const livelli = Object.keys(tabella).map(Number).sort((a, b) => a - b);
  const celle = id => livelli.map(z => {
    const c = tabella[z][id];
    // i layer symbol hanno il rapporto d'inchiostro locale/TGen, gli altri il dE
    const v = c?.dE != null ? c.dE.toFixed(1) : c ? `×${c.rapporto.toFixed(1)}` : '';
    return c ? `<td style="background:${COLORI[c.esito]}" title="${c.nTile} tile">${v}</td>` : '<td></td>';
  }).join('');
  const righe = difformita.map(d => `<tr><td>${esc(stati[d.id])}</td><td><a href="dossier/${fileDossier(d.id)}">${esc(d.id)}</a></td>`
    + `<td>${esc(fmt(d.misure))}</td><td>${d.esempi.map(e => esc(e.tile)).join(' ')}</td></tr>`).join('\n');
  const sc = Object.entries(scarti).map(([z, m]) => `<li>z${z}: ${esc(fmt(m))}</li>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>Revisione ${esc(giro)}</title>
<style>body{font:14px sans-serif;margin:16px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:2px 6px}</style>
<h1>Revisione ${esc(giro)}</h1>
<h2>Difformità</h2><table><tr><th>stato</th><th>id</th><th>misure</th><th>esempi</th></tr>${righe}</table>
<h2>Scarti</h2><ul>${sc}</ul>
<h2>ΔE mediano per livello e layer</h2><table><tr><th>layer</th>${livelli.map(z => `<th>z${z}</th>`).join('')}</tr>
${layer.map(id => `<tr><td>${esc(id)}</td>${celle(id)}</tr>`).join('\n')}</table>`;
}
