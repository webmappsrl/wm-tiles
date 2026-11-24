import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {adattaStile} from '../src/raster/stile-nativo.js';

const stileOl = JSON.parse(readFileSync(new URL('../style/webmapp.json', import.meta.url), 'utf8'));
const conTesto = stileOl.layers.find(l => typeof l.layout?.['text-size'] === 'number');

describe('typeScale', () => {
  it('senza typeScale lo stile e\' identico a prima', () => {
    expect(adattaStile(stileOl, {typeScale: 1})).toEqual(adattaStile(stileOl));
  });
  it('typeScale moltiplica text-size ma non le soglie di zoom', () => {
    const base = adattaStile(stileOl);
    const s = adattaStile(stileOl, {typeScale: 1.5});
    const l = s.layers.find(x => x.id === conTesto.id);
    expect(l.layout['text-size']).toBe(conTesto.layout['text-size'] * 2 * 1.5);
    for (const [i, x] of s.layers.entries()) {
      expect(x.minzoom).toBe(base.layers[i].minzoom);
      expect(x.maxzoom).toBe(base.layers[i].maxzoom);
    }
  });
  it('non tocca le espressioni di zoom: le soglie restano, le uscite scalano', () => {
    const base = adattaStile(stileOl), s = adattaStile(stileOl, {typeScale: 2});
    const l = stileOl.layers.find(x => Array.isArray(x.paint?.['line-width']) && x.paint['line-width'][0] === 'interpolate' && typeof x.paint['line-width'][4] === 'number');
    const a = base.layers.find(x => x.id === l.id).paint['line-width'];
    const b = s.layers.find(x => x.id === l.id).paint['line-width'];
    expect(b.filter((_, i) => i < 4 || i % 2 === 1)).toEqual(a.filter((_, i) => i < 4 || i % 2 === 1));
    expect(b[4]).toBe(a[4] * 2);
  });
});
