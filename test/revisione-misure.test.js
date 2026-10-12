import {describe, expect, it} from 'vitest';
import {deltaE, misuraTile, quantizza, regioni} from '../src/revisione/misure.js';

const N = 256 * 256;
const tinta = ([r, g, b]) => { const a = Buffer.alloc(N * 3); for (let i = 0; i < N; i++) a.set([r, g, b], 3 * i); return a; };
const dipingi = (buf, [r, g, b], x0, y0, x1, y1) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) buf.set([r, g, b], 3 * (y * 256 + x));
};
const maschera = (x0, y0, x1, y1) => {
  const m = new Uint8Array(N);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * 256 + x] = 1;
  return m;
};
const tutto = () => new Uint8Array(N).fill(1);
const niente = () => new Uint8Array(N);

describe('colore', () => {
  it('deltaE nullo fra colori uguali, grande fra bianco e nero', () => {
    expect(deltaE([10, 20, 30], [10, 20, 30])).toBe(0);
    expect(deltaE([255, 255, 255], [0, 0, 0])).toBeCloseTo(100, 0);
  });
  it('quantizza al centro della classe', () => {
    expect(quantizza([0, 31, 255])).toBe('#1010f0');
  });
});

describe('regioni', () => {
  it('separa due blocchi staccati', () => {
    const b = niente();
    for (const [x0, y0] of [[0, 0], [100, 100]]) for (let y = y0; y < y0 + 5; y++) for (let x = x0; x < x0 + 5; x++) b[y * 256 + x] = 1;
    const r = regioni(b);
    expect(r.length).toBe(2);
    expect(r.map(q => q.n)).toEqual([25, 25]);
    expect(r[1].bbox).toEqual([100, 100, 104, 104]);
  });
});

describe('misuraTile', () => {
  it('un layer col colore sbagliato da\' il suo scarto', () => {
    const tgen = tinta([200, 220, 180]), locale = tinta([200, 220, 180]);
    dipingi(tgen, [80, 140, 60], 0, 0, 128, 256);
    dipingi(locale, [100, 160, 80], 0, 0, 128, 256);
    const {classi} = misuraTile({tgen, locale, etichette: niente(), maschere: [
      {id: 'sfondo', tipo: 'sfondo', data: tutto()}, {id: 'bosco', tipo: 'fill', data: maschera(0, 0, 128, 256)},
    ]});
    expect(classi.bosco.tgen).toEqual([80, 140, 60]);
    expect(classi.bosco.locale).toEqual([100, 160, 80]);
    expect(classi.bosco.dE).toBeCloseTo(deltaE([80, 140, 60], [100, 160, 80]), 5);
    expect(classi.sfondo.dE).toBe(0); // misurato solo dove nessun altro layer copre
  });
  it('un oggetto disegnato solo da TGen finisce nel residuo', () => {
    const tgen = tinta([240, 240, 240]), locale = tinta([240, 240, 240]);
    dipingi(tgen, [40, 40, 40], 50, 50, 70, 54); // una ferrovia che non abbiamo
    const {residuo} = misuraTile({tgen, locale, etichette: niente(), maschere: [{id: 'sfondo', tipo: 'sfondo', data: tutto()}]});
    expect(residuo).toHaveLength(1);
    expect(residuo[0]).toMatchObject({colore: '#303030', n: 80, bbox: [50, 50, 69, 53]});
  });
  it('vicino a una nostra geometria non c\'e\' residuo: e\' presenza del layer', () => {
    const tgen = tinta([240, 240, 240]), locale = tinta([240, 240, 240]);
    dipingi(tgen, [40, 40, 40], 50, 50, 70, 54);
    const {residuo, classi} = misuraTile({tgen, locale, etichette: niente(), maschere: [
      {id: 'sfondo', tipo: 'sfondo', data: tutto()}, {id: 'strada', tipo: 'line', data: maschera(50, 50, 70, 54)},
    ]});
    expect(residuo).toHaveLength(0);
    expect(classi.strada.presenza).toBe(1);
  });
  it('una linea sottile che manca da una parte da\' uno scarto forte', () => {
    // una curva di livello di 1 px, tono vicino al fondo (dE ~12): la maschera
    // e' larga 3, quindi la mediana sotto di essa e' il fondo da entrambe le parti
    const tgen = tinta([210, 218, 203]), locale = tinta([210, 218, 203]);
    for (let y = 0; y < 256; y++) tgen.set([178, 186, 171], 3 * (y * 256 + 100));
    const {classi} = misuraTile({tgen, locale, etichette: niente(), maschere: [
      {id: 'sfondo', tipo: 'sfondo', data: tutto()}, {id: 'curve', tipo: 'line', data: maschera(99, 0, 102, 256)},
    ]});
    expect(classi.curve.tgen).toEqual([178, 186, 171]);
    expect(classi.curve.dE).toBeGreaterThan(10);
  });
  it('bordo e riempimento sovrapposti: ognuno ha i suoi pixel, quello sopra vince', () => {
    const tgen = tinta([240, 240, 240]), locale = tinta([240, 240, 240]);
    dipingi(tgen, [120, 120, 120], 0, 96, 256, 104); dipingi(locale, [120, 120, 120], 0, 96, 256, 104);
    dipingi(tgen, [255, 255, 255], 0, 98, 256, 102); dipingi(locale, [250, 200, 120], 0, 98, 256, 102);
    const {classi} = misuraTile({tgen, locale, etichette: niente(), maschere: [
      {id: 'bordo', tipo: 'line', data: maschera(0, 96, 256, 104)},
      {id: 'riempimento', tipo: 'line', data: maschera(0, 98, 256, 102)},
    ]});
    expect(classi.bordo.dE).toBeLessThan(1);
    expect(classi.riempimento.dE).toBeGreaterThan(20);
  });
  it('simboli: inchiostro nella zona del layer, lato per lato', () => {
    const tgen = tinta([200, 220, 180]), locale = tinta([200, 220, 180]);
    dipingi(locale, [0, 0, 0], 100, 100, 160, 112); // un nome che TGen non scrive
    const {simboli} = misuraTile({tgen, locale, etichette: maschera(80, 80, 180, 140), maschere: [
      {id: 'prato', tipo: 'fill', data: tutto()},
    ], zone: [{id: 'nomi', data: maschera(80, 80, 180, 140)}]});
    expect(simboli.nomi.n).toBe(100 * 60);
    expect(simboli.nomi.tgen).toBe(0);
    expect(simboli.nomi.locale).toBeCloseTo(720 / 6000, 5);
  });
  it('simboli: l\'inchiostro di una zona sovrapposta a un\'altra non si attribuisce a nessuna delle due', () => {
    // un nome di paese dentro la zona di un lago: senza questa regola il lago
    // risultava scrivere il triplo di TGen (lake-label z14 nel primo giro)
    const tgen = tinta([200, 220, 180]), locale = tinta([200, 220, 180]);
    dipingi(locale, [0, 0, 0], 110, 110, 150, 120);
    const {simboli} = misuraTile({tgen, locale, etichette: maschera(0, 0, 256, 256), maschere: [], zone: [
      {id: 'laghi', data: maschera(0, 0, 160, 160)},
      {id: 'paesi', data: maschera(100, 100, 256, 256)},
    ]});
    expect(simboli.laghi.locale).toBe(0);
    expect(simboli.paesi.locale).toBe(0);
  });
  it('review 1: cio\' che TGen disegna sopra una superficie conforme e\' residuo', () => {
    // una ferrovia che il locale non ha, sopra un bosco dello stesso colore:
    // la maschera del bosco non deve "spiegarla"
    const tgen = tinta([120, 150, 100]), locale = tinta([120, 150, 100]);
    dipingi(tgen, [30, 30, 30], 0, 126, 256, 130);
    const {residuo} = misuraTile({tgen, locale, etichette: niente(), maschere: [
      {id: 'bosco', tipo: 'fill', data: tutto()},
    ]});
    expect(residuo).toHaveLength(1);
    expect(residuo[0].colore).toBe('#101010'); // 30 cade nella prima classe da 32
  });
  it('una pista tratteggiata tenue che solo TGen disegna e\' residuo, l\'ombra no', () => {
    // tono a ~20 dal fondo (sotto la soglia di colore) e tratti di 3 px
    const tgen = tinta([200, 210, 190]), locale = tinta([200, 210, 190]);
    for (let x = 10; x < 246; x += 6) dipingi(tgen, [165, 160, 150], x, 100, x + 3, 102);
    // un'ombra diversa: rampa morbida, piu' scura fino a 40 livelli nel locale
    for (let y = 150; y < 256; y++) for (let x = 0; x < 256; x++) {
      const d = Math.round((40 * (y - 150)) / 106);
      locale.set([200 - d, 210 - d, 190 - d], 3 * (y * 256 + x));
    }
    const {residuo} = misuraTile({tgen, locale, etichette: niente(), maschere: [
      {id: 'prato', tipo: 'fill', data: tutto()},
    ]});
    expect(residuo).toHaveLength(1);
    expect(residuo[0].bbox[1]).toBeGreaterThanOrEqual(98);
    expect(residuo[0].bbox[3]).toBeLessThanOrEqual(104);
  });
  it('review 1: dove la superficie stessa e\' sbagliata, lo scarto e\' suo e non residuo', () => {
    const tgen = tinta([60, 120, 40]), locale = tinta([200, 210, 190]);
    const {residuo, classi} = misuraTile({tgen, locale, etichette: niente(), maschere: [
      {id: 'bosco', tipo: 'fill', data: tutto()},
    ]});
    expect(residuo).toHaveLength(0);
    expect(classi.bosco.dE).toBeGreaterThan(30);
  });
  it('review 2: il nome lungo una strada non toglie la strada dalla misura', () => {
    const tgen = tinta([240, 238, 230]), locale = tinta([240, 238, 230]);
    dipingi(tgen, [255, 255, 255], 0, 124, 256, 132); dipingi(locale, [255, 255, 255], 0, 124, 256, 132);
    for (let x = 20; x < 236; x += 4) dipingi(tgen, [40, 40, 40], x, 126, x + 2, 130); // il nome di TGen sopra
    const {classi} = misuraTile({tgen, locale, etichette: tutto(), etichettePunti: niente(), maschere: [
      {id: 'strada', tipo: 'line', larghezza: 8, data: maschera(0, 124, 256, 132)},
    ]});
    expect(classi.strada).toBeDefined();
    expect(classi.strada.dE).toBeLessThan(3); // linea larga: mediana, il testo e' minoranza
  });
  it('simboli: icona e nome dello stesso oggetto hanno la stessa zona, e non si escludono', () => {
    const tgen = tinta([200, 220, 180]), locale = tinta([200, 220, 180]);
    dipingi(tgen, [60, 40, 20], 120, 120, 130, 130);
    const z = maschera(80, 80, 180, 180);
    const {simboli} = misuraTile({tgen, locale, etichette: z, maschere: [], zone: [
      {id: 'cime-icona', data: z}, {id: 'cime-nome', data: maschera(80, 80, 180, 184)},
    ]});
    expect(simboli['cime-icona']).toBeDefined();
    expect(simboli['cime-nome']).toBeDefined();
  });
  it('un\'etichetta in posizione diversa non sporca residuo e classi', () => {
    const tgen = tinta([200, 220, 180]), locale = tinta([200, 220, 180]);
    dipingi(tgen, [0, 0, 0], 100, 100, 160, 112);   // il nome di TGen
    dipingi(locale, [0, 0, 0], 110, 120, 170, 132); // lo stesso nome, piu' in basso
    const {residuo, classi} = misuraTile({tgen, locale, etichette: maschera(80, 80, 190, 150), maschere: [
      {id: 'prato', tipo: 'fill', data: tutto()},
    ]});
    expect(residuo).toHaveLength(0);
    expect(classi.prato.dE).toBe(0);
  });
});
