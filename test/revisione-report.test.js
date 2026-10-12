import {describe, expect, it} from 'vitest';
import sharp from 'sharp';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {dossier, pagina} from '../src/revisione/report.js';

const tinta = v => Buffer.alloc(256 * 256 * 3, v);

describe('dossier', () => {
  it('una riga per esempio, tre colonne da 512', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'rev-')), 'd.png');
    const d = {id: 'z14:residuo:#303030', tipo: 'residuo', misure: {diffusione: 0.4, nTile: 10}};
    await dossier({d, out, immagini: [
      {tile: '14/1/1', tgen: tinta(40), locale: tinta(240), bbox: [10, 10, 50, 20]},
      {tile: '14/1/2', tgen: tinta(40), locale: tinta(240)},
    ]});
    const m = await sharp(out).metadata();
    expect(m.width).toBe(3 * 512);
    expect(m.height).toBe(40 + 2 * 512);
  });
});

describe('pagina', () => {
  it('elenca le difformita\' con il loro stato e i livelli scartati', () => {
    const html = pagina({
      giro: 'a', tabella: {13: {bosco: {dE: 12, presenza: 0, nTile: 4, esito: 'stile'}}},
      difformita: [{id: 'z13:bosco:stile', tipo: 'stile', misure: {dE: 12, diffusione: 1, nTile: 4}, esempi: []}],
      stati: {'z13:bosco:stile': 'aperta'}, scarti: {8: {copertura: 12}},
    });
    expect(html).toContain('z13:bosco:stile');
    expect(html).toContain('aperta');
    expect(html).toContain('copertura');
    expect(html).toContain('href="dossier/z13_bosco_stile.png"');
  });
  it('le righe dei layer symbol mostrano il rapporto, non il dE', () => {
    const html = pagina({giro: 'a', tabella: {14: {cime: {rapporto: 3, nTile: 4, esito: 'simboli'}}}, difformita: [], stati: {}, scarti: {}});
    expect(html).toContain('×3.0');
  });
});
