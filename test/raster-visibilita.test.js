import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {livelliArchivi} from '../src/raster/visibilita.js';

/**
 * Sullo stile vero: se il profilo cambia, questi test dicono se il confronto
 * fra versioni continua a limitare la propagazione dove serve.
 */
const stile = JSON.parse(readFileSync('style/webmapp.json', 'utf8'));
const profilo = JSON.parse(readFileSync('style/zoom-profile.json', 'utf8'));
const livelli = livelliArchivi(stile, profilo);

describe('livelliArchivi', () => {
  // le strade si fermano a z11, ma i cartellini delle secondarie stanno nello
  // stesso archivio e si vedono a z12 (tile z11 ingrandite): un cartellino
  // cambiato deve rifare anche i PNG di z12, e non oltre
  it('le strade dei livelli bassi si fermano a z12: oltre non si propagano', () => {
    expect(livelli('roadslz').zmax).toBe(12);
  });

  it('OpenStreetMap si disegna a ogni livello, anche oltre z16', () => {
    expect(livelli('osm')).toEqual({zmin: 0, zmax: Infinity});
  });

  it('l\'uso suolo regionale comincia a z14, Corine finisce a z13', () => {
    expect(livelli('landcover').zmin).toBe(14);
    expect(livelli('clc').zmax).toBe(13);
  });

  it('un archivio che lo stile non disegna non conta', () => {
    expect(livelli('non-esiste')).toBeNull();
  });
});
