import {describe, expect, it} from 'vitest';
import {componi, decodificaTerrarium, fasciaDi, grigi, quoteVista, sfoca} from '../src/raster/ombra.js';

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
/** Come `piano`, ma su un frame rettangolare width x height con bordo B. */
const pianoRect = (dx, dy, width, height) => {
  const Wr = width + 2 * B, Hr = height + 2 * B;
  const E = new Float32Array(Wr * Hr);
  for (let r = 0; r < Hr; r++) for (let c = 0; c < Wr; c++) E[r * Wr + c] = 1000 + dx * c + dy * r;
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
    const {luce} = grigi(piano(0, 0), N, N, B, 10, set);
    expect(new Set(luce).size).toBe(1);
  });
  it('il versante esposto a nord-ovest, verso il sole, e\' piu\' chiaro di quello a sud-est', () => {
    // la quota scende verso nord-ovest (sinistra e in alto): il versante guarda la luce
    const versoSole = media(grigi(piano(5, 5), N, N, B, 10, set).luce);
    const controSole = media(grigi(piano(-5, -5), N, N, B, 10, set).luce);
    expect(versoSole).toBeGreaterThan(controSole + 50);
  });
  it('la pendenza in overlay c\'e\' solo se il set la chiede', () => {
    expect(grigi(piano(5, 0), N, N, B, 10, set).pend).toBeNull();
    expect(grigi(piano(5, 0), N, N, B, 10, {...set, slope: 0.3}).pend).not.toBeNull();
  });
});

describe('frame rettangolare', () => {
  it('un frame rettangolare non e\' il quadrato del lato maggiore', () => {
    const {luce} = grigi(pianoRect(0, 1, 24, 16), 24, 16, B, 10, set);
    expect(luce.length).toBe(24 * 16);
  });
  it('su un piano inclinato il rettangolo da\' gli stessi valori del quadrato', () => {
    const q = grigi(piano(0, 1), 16, 16, B, 10, set).luce;
    const r = grigi(pianoRect(0, 1, 16, 16), 16, 16, B, 10, set).luce;
    expect(Array.from(r)).toEqual(Array.from(q));
  });
  it('riga e colonna non si scambiano: un piano che sale a sud e uno che sale a est restano distinti su 24x16', () => {
    // la luce viene da nord-ovest: un versante che sale verso sud guarda il sole, uno che sale verso nord no
    const sud = media(grigi(pianoRect(0, 5, 24, 16), 24, 16, B, 10, set).luce);
    const nord = media(grigi(pianoRect(0, -5, 24, 16), 24, 16, B, 10, set).luce);
    expect(sud).toBeGreaterThan(nord + 50);
  });
  it('la luce segue la geometria: pendenza solo lungo le colonne, varia lungo la riga e non lungo la colonna', () => {
    // quota 1000 + c^2 (convessa verso est), nessuna dipendenza dalla riga, su 24x16
    const width = 24, height = 16, Wr = width + 2 * B, Hr = height + 2 * B;
    const E = new Float32Array(Wr * Hr);
    for (let r = 0; r < Hr; r++) for (let c = 0; c < Wr; c++) E[r * Wr + c] = 1000 + 2 * c * c;
    const {luce} = grigi(E, width, height, B, 10, set);
    // lungo una riga (r fisso) la luce cambia con la colonna
    const riga = Array.from({length: width}, (_, c) => luce[8 * width + c]);
    expect(new Set(riga).size).toBeGreaterThan(3);
    // lungo una colonna (c fisso) e' costante: tutte le righe sono uguali
    for (let c = 0; c < width; c++) {
      for (let r = 1; r < height; r++) expect(luce[r * width + c]).toBe(luce[c]);
    }
  });
  it('lo stesso rilievo ruotato di 90 gradi: la luce varia lungo la colonna e non lungo la riga', () => {
    const width = 24, height = 16, Wr = width + 2 * B, Hr = height + 2 * B;
    const E = new Float32Array(Wr * Hr);
    for (let r = 0; r < Hr; r++) for (let c = 0; c < Wr; c++) E[r * Wr + c] = 1000 + 2 * r * r;
    const {luce} = grigi(E, width, height, B, 10, set);
    const colonna = Array.from({length: height}, (_, r) => luce[r * width + 12]);
    expect(new Set(colonna).size).toBeGreaterThan(3);
    for (let r = 0; r < height; r++) {
      for (let c = 1; c < width; c++) expect(luce[r * width + c]).toBe(luce[r * width]);
    }
  });
  it('dimensioni incoerenti con E sollevano un errore', () => {
    // limite: uno scambio esatto width/height ha lo stesso prodotto e la guardia non lo vede
    expect(() => grigi(pianoRect(0, 1, 24, 16), 24, 20, B, 10, set)).toThrow(/attese/);
  });
  it('quoteVista rettangolare: lunghezza e posizione delle quote', () => {
    const Wd = 40, D = new Float32Array(Wd * Wd).map((_, i) => 10 * (i % Wd) + 1000 * Math.floor(i / Wd));
    const E = quoteVista(D, Wd, 0, 0, 5, 7, 12, 6, 2, 1);
    const Wr = 12 + 4;
    expect(E.length).toBe(Wr * (6 + 4));
    expect(E[0]).toBe(10 * 3 + 1000 * 5);            // colonna x0 - B, riga y0 - B
    expect(E[Wr * 2 + 3]).toBe(10 * 6 + 1000 * 7);
  });
  it('sfoca e componi rispettano width x height', () => {
    const a = new Float32Array(24 * 16).fill(100);
    a[5 * 24 + 20] = 255;
    const o = sfoca(a, 24, 16);
    expect(o.length).toBe(24 * 16);
    expect(o[5 * 24 + 20]).toBeGreaterThan(o[5 * 24 + 18]);
    const sotto = Buffer.alloc(24 * 16 * 4, 255), sopra = Buffer.alloc(24 * 16 * 4);
    expect(componi(sotto, sopra, null, null, 24, 16).length).toBe(24 * 16 * 3);
  });
  it('componi: una riga diversa resta nella sua riga, non nella colonna', () => {
    const width = 24, height = 16, riga = 5;
    const sotto = Buffer.alloc(width * height * 4, 100);
    for (let i = 0; i < width * height; i++) sotto[i * 4 + 3] = 255;
    for (let c = 0; c < width; c++) sotto.set([200, 200, 200, 255], (riga * width + c) * 4);
    const out = componi(sotto, Buffer.alloc(width * height * 4), null, null, width, height);
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) expect(out[(r * width + c) * 3]).toBe(r === riga ? 200 : 100);
    }
  });
  it('sfoca: un impulso su una sola riga non si sposta in colonna', () => {
    const width = 24, height = 16, a = new Float32Array(width * height);
    for (let c = 0; c < width; c++) a[5 * width + c] = 200;
    const o = sfoca(a, width, height);
    for (let c = 0; c < width; c++) expect(o[5 * width + c]).toBeGreaterThan(o[1 * width + c]);
    for (let c = 1; c < width; c++) expect(o[5 * width + c]).toBe(o[5 * width]);
  });
});

describe('quoteVista', () => {
  // un piano che sale di 10 m a ogni punto verso est: D(u, v) = 10 u
  const Wd = 12, D = new Float32Array(Wd * Wd).map((_, i) => 10 * (i % Wd));
  it('fino all\'ultimo livello del DEM restituisce i suoi punti, senza interpolare', () => {
    const E = quoteVista(D, Wd, 0, 0, 2, 2, 4, 4, 2, 1);
    expect(E[0]).toBe(0);           // vista da x0 - B = 0
    expect(E[5]).toBe(50);
  });
  it('oltre, interpola fra i punti: su un piano la quota cresce di meta\' a ogni pixel', () => {
    const E = quoteVista(D, Wd, 0, 0, 8, 8, 4, 4, 6, 2);
    const W = 4 + 2 * 6;
    expect(E[W * 6 + 7] - E[W * 6 + 6]).toBeCloseTo(5, 5);
  });
});

describe('grigi oltre l\'ultimo livello del DEM', () => {
  it('un piano da\' la stessa luce che al livello del DEM', () => {
    const P = 10;
    const Wd = 40, D = new Float32Array(Wd * Wd).map((_, i) => 3 * (i % Wd) + 2 * Math.floor(i / Wd));
    const a = grigi(quoteVista(D, Wd, 0, 0, 10, 10, 8, 8, 3, 1), 8, 8, 3, P, set, 1);
    const b = grigi(quoteVista(D, Wd, 0, 0, 20, 20, 8, 8, 6, 2), 8, 8, 6, P, set, 2);
    expect(Math.abs(a.luce[36] - b.luce[36])).toBeLessThanOrEqual(1);
  });
});

describe('sfoca', () => {
  it('conserva un campo uniforme', () => {
    expect([...sfoca(new Float32Array(N * N).fill(200), N, N)].every(x => x === 200)).toBe(true);
  });
});

describe('componi', () => {
  const opaco = (r, g, b) => { const x = Buffer.alloc(4); x.set([r, g, b, 255]); return x; };
  const trasparente = Buffer.alloc(4);
  it('multiply: un\'ombra bianca non cambia il colore', () => {
    expect([...componi(opaco(200, 100, 50), trasparente, {luce: [255], pend: null}, set, 1, 1)]).toEqual([200, 100, 50]);
  });
  it('multiply: l\'ombra nera scurisce in proporzione all\'opacita\'', () => {
    expect([...componi(opaco(200, 100, 50), trasparente, {luce: [0], pend: null}, set, 1, 1)]).toEqual([140, 70, 35]);
  });
  it('normal: l\'ombra si sostituisce al colore con la sua opacita\'', () => {
    const f = {...set, blend: 'normal'};
    expect([...componi(opaco(200, 100, 50), trasparente, {luce: [255], pend: null}, f, 1, 1)]).toEqual([217, 147, 112]);
  });
  it('il layer sopra copre l\'ombra dove e\' opaco', () => {
    expect([...componi(opaco(200, 100, 50), opaco(10, 20, 30), {luce: [0], pend: null}, set, 1, 1)]).toEqual([10, 20, 30]);
  });
});

describe('fasciaDi', () => {
  const fasce = [{zmin: 7, zmax: 7, id: 'a'}, {zmin: 8, zmax: 16, id: 'b'}];
  it('sotto la prima fascia vale la prima, sopra l\'ultima', () => {
    expect(fasciaDi(fasce, 3).id).toBe('a');
    expect(fasciaDi(fasce, 18).id).toBe('b');
  });
});
