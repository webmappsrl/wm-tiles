import {describe, expect, it} from 'vitest';
import {
  chiave, parseZxy, vicini, discendenti, tileDaRendere, raggruppa, vistaMetatile, tileInBbox, toccaBbox,
} from '../src/raster/tiles.js';

/**
 * Queste funzioni decidono QUALI PNG si rifanno dopo un aggiornamento. Un
 * errore qui non da' nessun segnale: la tile non rifatta resta quella vecchia
 * e la mappa mostra dati superati senza che nulla lo dica. Per questo i test
 * verificano soprattutto che non manchi niente.
 */

describe('parseZxy / chiave', () => {
  it('fanno andata e ritorno', () => {
    expect(chiave(parseZxy('14/8660/5941'))).toBe('14/8660/5941');
  });
  it('rifiutano un formato sbagliato', () => {
    expect(() => parseZxy('14/8660')).toThrow();
    expect(() => parseZxy('3/8/0')).toThrow(); // x fuori dalla griglia di z3
  });
});

describe('vicini', () => {
  it('sono nove, compresa la tile stessa', () => {
    expect(vicini({z: 10, x: 541, y: 371}).length).toBe(9);
  });
  it('non escono dalla griglia', () => {
    const v = vicini({z: 2, x: 0, y: 0});
    expect(v.every(t => t.x >= 0 && t.y >= 0 && t.x < 4 && t.y < 4)).toBe(true);
    expect(v.length).toBe(4);
  });
});

describe('discendenti', () => {
  it('quattro per livello: 4 + 16 fino a due livelli sotto', () => {
    const d = discendenti({z: 14, x: 8660, y: 5941}, 16);
    expect(d.length).toBe(20);
    expect(d.filter(t => t.z === 16).map(chiave)).toContain('16/34640/23764');
  });
  it('nessuno se si e\' gia\' al livello massimo', () => {
    expect(discendenti({z: 16, x: 1, y: 1}, 16)).toEqual([]);
  });
});

describe('tileDaRendere', () => {
  it('una tile cambiata al maxzoom dell\'archivio rifa anche i livelli in overzoom', () => {
    const out = tileDaRendere([{z: 14, x: 8660, y: 5941}], {archMaxZoom: 14, zmin: 0, zmax: 16}).map(chiave);
    expect(out).toContain('14/8660/5941');
    expect(out).toContain('15/17320/11882');
    expect(out).toContain('16/34643/23767');
  });

  it('include le vicine: un\'etichetta puo\' sconfinare nella tile accanto', () => {
    const out = tileDaRendere([{z: 12, x: 2165, y: 1485}], {archMaxZoom: 14, zmin: 0, zmax: 16}).map(chiave);
    expect(out).toContain('12/2164/1484');
    expect(out).toContain('12/2166/1486');
  });

  it('sotto il maxzoom non scende: i livelli sopra hanno tile proprie, gia\' confrontate', () => {
    const out = tileDaRendere([{z: 12, x: 2165, y: 1485}], {archMaxZoom: 14, zmin: 0, zmax: 16});
    expect(out.every(t => t.z === 12)).toBe(true);
  });

  it('rispetta la fascia di zoom richiesta', () => {
    const out = tileDaRendere([{z: 14, x: 8660, y: 5941}], {archMaxZoom: 14, zmin: 15, zmax: 15});
    expect(out.every(t => t.z === 15)).toBe(true);
    expect(out.length).toBe(9 * 4);
  });

  it('non duplica', () => {
    const out = tileDaRendere(
      [{z: 14, x: 8660, y: 5941}, {z: 14, x: 8661, y: 5941}], {archMaxZoom: 14, zmin: 14, zmax: 14});
    expect(out.length).toBe(12); // due 3x3 sovrapposti per sei tile
  });
});

describe('raggruppa', () => {
  it('mette insieme le tile dello stesso blocco', () => {
    const g = raggruppa([{z: 14, x: 8660, y: 5940}, {z: 14, x: 8663, y: 5943}, {z: 14, x: 8664, y: 5940}], 4);
    expect(g.length).toBe(2);
    expect(g.find(m => m.mx === 2165).tiles.length).toBe(2);
  });
  it('ai livelli bassi il blocco non supera la griglia', () => {
    const [m] = raggruppa([{z: 1, x: 1, y: 0}], 4);
    expect(m.lato).toBe(2);
  });
});

describe('vistaMetatile', () => {
  it('il centro del blocco e\' l\'angolo comune delle quattro tile centrali', () => {
    const v = vistaMetatile({z: 1, mx: 0, my: 0, lato: 2}, 128);
    expect(v.lon).toBeCloseTo(0, 9);
    expect(v.lat).toBeCloseTo(0, 9);
    expect(v.pixel).toBe(2 * 256 + 2 * 128);
  });
  it('ritaglia ogni tile alla sua posizione nel blocco', () => {
    const m = {z: 14, mx: 2165, my: 1485, lato: 4};
    const v = vistaMetatile(m, 128);
    expect(v.ritaglio({x: 8660, y: 5940})).toEqual({left: 128, top: 128, width: 256, height: 256});
    expect(v.ritaglio({x: 8663, y: 5943})).toEqual({left: 128 + 768, top: 128 + 768, width: 256, height: 256});
  });
});

describe('tileInBbox', () => {
  it('contiene la tile del centro dell\'area', () => {
    const t = tileInBbox([10.0, 43.62, 10.9, 44.5], 10).map(chiave);
    expect(t).toContain('10/541/371');
  });
  it('a z0 c\'e\' una tile sola', () => {
    expect(tileInBbox([10, 43, 11, 44], 0)).toEqual([{z: 0, x: 0, y: 0}]);
  });
  it('il conteggio cresce di circa quattro volte per livello', () => {
    const a = tileInBbox([10.0, 43.62, 10.9, 44.5], 13).length;
    const b = tileInBbox([10.0, 43.62, 10.9, 44.5], 14).length;
    expect(b / a).toBeGreaterThan(3.5);
    expect(b / a).toBeLessThan(4.5);
  });
});

describe('toccaBbox', () => {
  it('la tile del centro di Pisa tocca il riquadro di Pisa, una di Caltanissetta no', () => {
    expect(toccaBbox({z: 14, x: 8665, y: 5975}, [10.38, 43.70, 10.43, 43.73])).toBe(true);
    expect(toccaBbox({z: 14, x: 8831, y: 6349}, [10.38, 43.70, 10.43, 43.73])).toBe(false);
  });
  it('z0 tocca qualunque riquadro', () => {
    expect(toccaBbox({z: 0, x: 0, y: 0}, [10, 43, 11, 44])).toBe(true);
  });
  it('coincide con tileInBbox', () => {
    const b = [10.38, 43.70, 10.43, 43.73];
    for (const z of [12, 14, 16]) {
      expect(tileInBbox(b, z).every(t => toccaBbox(t, b))).toBe(true);
    }
  });
});
