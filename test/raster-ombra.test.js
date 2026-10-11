import {describe, expect, it} from 'vitest';
import {componi, decodificaTerrarium, fasciaDi, grigi, sfoca} from '../src/raster/ombra.js';

/**
 * L'ombra dei PNG puo' sbagliare senza alcun errore, come e' successo a quella
 * delle app: un segno invertito specchia l'esposizione, e le vette si leggono
 * come valli. Qui si verificano il verso della luce e la composizione; la
 * coincidenza con l'ombra delle app la verifica tools/ombra-native-vs-ol.mjs.
 */

const N = 16, B = 3, W = N + 2 * B;
/** Un piano inclinato: la quota cresce verso `dx` (colonne) e `dy` (righe, verso il basso). */
const piano = (dx, dy) => {
  const E = new Float32Array(W * W);
  for (let r = 0; r < W; r++) for (let c = 0; c < W; c++) E[r * W + c] = 1000 + dx * c + dy * r;
  return E;
};
const media = a => a.reduce((s, x) => s + x, 0) / a.length;
const set = {vert: 1, gamma: 1, slope: 0, sunAzimuth: 315, sunElevation: 45, opacity: 0.3, blend: 'multiply'};

describe('decodificaTerrarium', () => {
  it('ricompone la quota dai tre canali', () => {
    // 1000 m: 33768 = 131*256 + 232, blu 0
    expect(decodificaTerrarium(Uint8Array.from([131, 232, 0]), 3, 1)[0]).toBe(1000);
  });
});

describe('grigi', () => {
  it('un piano e\' uniforme', () => {
    const {luce} = grigi(piano(0, 0), N, B, 10, set);
    expect(new Set(luce).size).toBe(1);
  });
  it('il versante esposto a nord-ovest, verso il sole, e\' piu\' chiaro di quello a sud-est', () => {
    // la quota scende verso nord-ovest (sinistra e in alto): il versante guarda la luce
    const versoSole = media(grigi(piano(5, 5), N, B, 10, set).luce);
    const controSole = media(grigi(piano(-5, -5), N, B, 10, set).luce);
    expect(versoSole).toBeGreaterThan(controSole + 50);
  });
  it('la pendenza in overlay c\'e\' solo se il set la chiede', () => {
    expect(grigi(piano(5, 0), N, B, 10, set).pend).toBeNull();
    expect(grigi(piano(5, 0), N, B, 10, {...set, slope: 0.3}).pend).not.toBeNull();
  });
});

describe('sfoca', () => {
  it('conserva un campo uniforme', () => {
    expect([...sfoca(new Float32Array(N * N).fill(200), N)].every(x => x === 200)).toBe(true);
  });
});

describe('componi', () => {
  const opaco = (r, g, b) => { const x = Buffer.alloc(4); x.set([r, g, b, 255]); return x; };
  const trasparente = Buffer.alloc(4);
  it('multiply: un\'ombra bianca non cambia il colore', () => {
    expect([...componi(opaco(200, 100, 50), trasparente, {luce: [255], pend: null}, set, 1)]).toEqual([200, 100, 50]);
  });
  it('multiply: l\'ombra nera scurisce in proporzione all\'opacita\'', () => {
    expect([...componi(opaco(200, 100, 50), trasparente, {luce: [0], pend: null}, set, 1)]).toEqual([140, 70, 35]);
  });
  it('normal: l\'ombra si sostituisce al colore con la sua opacita\'', () => {
    const f = {...set, blend: 'normal'};
    expect([...componi(opaco(200, 100, 50), trasparente, {luce: [255], pend: null}, f, 1)]).toEqual([217, 147, 112]);
  });
  it('il layer sopra copre l\'ombra dove e\' opaco', () => {
    expect([...componi(opaco(200, 100, 50), opaco(10, 20, 30), {luce: [0], pend: null}, set, 1)]).toEqual([10, 20, 30]);
  });
});

describe('fasciaDi', () => {
  const fasce = [{zmin: 7, zmax: 7, id: 'a'}, {zmin: 8, zmax: 16, id: 'b'}];
  it('sotto la prima fascia vale la prima, sopra l\'ultima', () => {
    expect(fasciaDi(fasce, 3).id).toBe('a');
    expect(fasciaDi(fasce, 18).id).toBe('b');
  });
});
