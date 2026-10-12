import {describe, expect, it} from 'vitest';
import {campiona, cellaDi, coperta, fascia, limiti} from '../src/revisione/campione.js';
import {tileInBbox} from '../src/raster/tiles.js';

/**
 * Il campione decide quali tile si guardano: se e' instabile due giri non si
 * confrontano, se esclude un livello quel livello non lo controlla nessuno.
 */
const universo = [];
// bbox interno alle quattro celle: le tile di bordo non sconfinano in una quinta
for (let z = 6; z <= 12; z++) universo.push(...tileInBbox([10.1, 43.1, 11.9, 44.9], z));

describe('campiona', () => {
  it('prende tutte le tile fino a tutteFino', () => {
    const c = campiona(universo, {perLivello: 5, seed: 1});
    for (const z of [6, 7, 8]) {
      expect(c.filter(t => t.z === z).length).toBe(universo.filter(t => t.z === z).length);
    }
  });
  it('sopra, perLivello tile per livello', () => {
    const c = campiona(universo, {perLivello: 5, seed: 1});
    for (const z of [9, 10, 11, 12]) expect(c.filter(t => t.z === z).length).toBe(5);
  });
  it('stesso seed, stesso campione; seed diverso, campione diverso', () => {
    const a = campiona(universo, {perLivello: 8, seed: 1});
    expect(campiona(universo, {perLivello: 8, seed: 1})).toEqual(a);
    expect(campiona(universo, {perLivello: 8, seed: 2})).not.toEqual(a);
  });
  it('ripartisce fra le celle di un grado', () => {
    const c = campiona(universo, {perLivello: 8, seed: 3}).filter(t => t.z === 12);
    expect(new Set(c.map(cellaDi)).size).toBe(4); // bbox di 2x2 gradi
  });
  it('ordine di estrazione: le prime tile di un livello coprono gia\' tutte le celle', () => {
    // l'orchestratore pesca da un bacino piu' grande e scarta le tile di solo
    // mare: un prefisso del campione deve restare stratificato
    const c = campiona(universo, {perLivello: 40, seed: 3}).filter(t => t.z === 12);
    expect(new Set(c.slice(0, 4).map(cellaDi)).size).toBe(4);
  });
});

describe('coperta', () => {
  it('vuole la tile intera dentro un riquadro', () => {
    const dentro = tileInBbox([10.4, 43.4, 10.5, 43.5], 12)[0];
    expect(coperta(dentro, [[10, 43, 11, 44]])).toBe(true);
    // una z8 e' larga 1,4 gradi: in una cella di 1 grado non entra mai
    const z8 = tileInBbox([10.5, 43.5, 10.5, 43.5], 8)[0];
    expect(coperta(z8, [[10, 43, 11, 44]])).toBe(false);
  });
  it('review 3: una tile a cavallo di due celle contigue e\' coperta dalla loro unione', () => {
    const z8 = tileInBbox([10.9, 43.5, 10.9, 43.5], 8)[0]; // da 9,84 a 11,25 E: il confine a 11 la taglia
    expect(coperta(z8, [[9, 42, 11, 45], [11, 42, 13, 45]])).toBe(true);
    expect(coperta(z8, [[9, 42, 11, 45]])).toBe(false);
  });
  it('senza riquadri tutto e\' coperto', () => {
    expect(coperta({z: 5, x: 17, y: 11}, null)).toBe(true);
  });
});

describe('limiti e fascia', () => {
  it('limiti della tile 0/0/0', () => {
    const [w, s, e, n] = limiti({z: 0, x: 0, y: 0});
    expect(w).toBe(-180); expect(e).toBe(180);
    expect(n).toBeCloseTo(85.0511, 3); expect(s).toBeCloseTo(-85.0511, 3);
  });
  it('fascia: 2018 fino a z12, 2025 da z13', () => {
    expect(fascia(12)).toBe('2018');
    expect(fascia(13)).toBe('2025');
  });
});
