import {describe, expect, it} from 'vitest';
import {aggrega, regressioni} from '../src/revisione/aggrega.js';

const r = (tile, classi, residuo = []) => ({tile, z: Number(tile.split('/')[0]), classi, residuo});
const c = (dE, presenza = 0) => ({n: 500, tgen: [0, 0, 0], locale: [0, 0, 0], dE, presenza});

describe('aggrega', () => {
  it('scarto sistematico: stile; scarto su una tile sola: sparso', () => {
    const ris = [
      r('13/1/1', {bosco: c(14), strada: c(2)}),
      r('13/1/2', {bosco: c(12), strada: c(15)}),
      r('13/1/3', {bosco: c(13), strada: c(1)}),
      r('13/1/4', {bosco: c(15), strada: c(2)}),
    ];
    const {tabella, difformita} = aggrega(ris);
    expect(tabella[13].bosco.esito).toBe('stile');
    expect(tabella[13].strada.esito).toBe('sparso');
    expect(difformita.map(d => d.id)).toEqual(['z13:bosco:stile']);
    expect(difformita[0].esempi[0].tile).toBe('13/1/4'); // il peggiore per primo
  });
  it('residuo dello stesso colore su molte tile: sistematico', () => {
    const ris = Array.from({length: 10}, (_, i) => r(`14/1/${i}`, {}, i < 4 ? [{colore: '#303030', n: 90, bbox: [1, 1, 9, 9]}] : []));
    const {difformita} = aggrega(ris);
    expect(difformita).toHaveLength(1);
    expect(difformita[0]).toMatchObject({id: 'z14:residuo:#303030', tipo: 'residuo'});
    expect(difformita[0].misure.diffusione).toBeCloseTo(0.4);
  });
  it('gli esempi di un residuo sono tile diverse', () => {
    const q = n => ({colore: '#303030', n, bbox: [1, 1, 9, 9]});
    const ris = Array.from({length: 5}, (_, i) => r(`14/1/${i}`, {}, i === 0 ? [q(900), q(800)] : [q(100 + i)]));
    const es = aggrega(ris).difformita[0].esempi.map(e => e.tile);
    expect(new Set(es).size).toBe(es.length);
    expect(es[0]).toBe('14/1/0');
  });
  it('residuo su una tile su dieci non basta', () => {
    const ris = Array.from({length: 20}, (_, i) => r(`14/1/${i}`, {}, i < 1 ? [{colore: '#303030', n: 90, bbox: [1, 1, 9, 9]}] : []));
    expect(aggrega(ris).difformita).toHaveLength(0);
  });
  it('presenza alta e sistematica: il layer e\' disegnato solo da noi o in altro modo', () => {
    const ris = Array.from({length: 4}, (_, i) => r(`15/1/${i}`, {sentieri: c(3, 0.9)}));
    expect(aggrega(ris).difformita[0]).toMatchObject({id: 'z15:sentieri:presenza', tipo: 'presenza'});
  });
});

describe('aggrega: simboli', () => {
  const s = (tgen, locale) => ({n: 2000, tgen, locale});
  it('un layer che scrive sistematicamente il triplo di TGen e\' una difformita\'', () => {
    const ris = Array.from({length: 4}, (_, i) => ({tile: `14/1/${i}`, z: 14, classi: {}, residuo: [], simboli: {cime: s(0.01, 0.03), nomi: s(0.05, 0.05)}}));
    const {tabella, difformita} = aggrega(ris);
    expect(difformita.map(d => d.id)).toEqual(['z14:cime:simboli']);
    expect(difformita[0].misure.rapporto).toBeCloseTo(3, 1);
    expect(tabella[14].nomi.esito).toBe('conforme');
  });
  it('un layer che TGen disegna e noi no: rapporto vicino a zero', () => {
    const ris = Array.from({length: 4}, (_, i) => ({tile: `14/1/${i}`, z: 14, classi: {}, residuo: [], simboli: {stazioni: s(0.04, 0)}}));
    expect(aggrega(ris).difformita[0]).toMatchObject({id: 'z14:stazioni:simboli', tipo: 'simboli'});
  });
});

describe('review 4: misure di una difformita\' di stile', () => {
  it('portano i colori mediani dei due lati', () => {
    const ris = Array.from({length: 3}, (_, i) => ({tile: `13/1/${i}`, z: 13, residuo: [],
      classi: {bosco: {n: 500, tgen: [80, 140, 60], locale: [100, 160, 80], dE: 12, presenza: 0}}}));
    const d = aggrega(ris).difformita[0];
    expect(d.misure.tgen).toEqual([80, 140, 60]);
    expect(d.misure.locale).toEqual([100, 160, 80]);
  });
});

describe('review 5: regressioni oltre il dE', () => {
  it('simboli: il rapporto che si allontana da 1', () => {
    const reg = regressioni({16: {cime: {rapporto: 3}}}, {16: {cime: {rapporto: 1}}});
    expect(reg.map(d => d.id)).toEqual(['z16:cime:regressione']);
    expect(regressioni({16: {cime: {rapporto: 1.1}}}, {16: {cime: {rapporto: 3}}})).toEqual([]);
  });
  it('presenza che cresce', () => {
    expect(regressioni({14: {strada: {dE: 2, presenza: 0.5}}}, {14: {strada: {dE: 2, presenza: 0.1}}}).map(d => d.id))
      .toEqual(['z14:strada:regressione']);
  });
  it('un layer che c\'era e non c\'e\' piu\'', () => {
    expect(regressioni({14: {}}, {14: {ferrovia: {dE: 2, presenza: 0}}}).map(d => d.id)).toEqual(['z14:ferrovia:sparito']);
  });
});

describe('regressioni', () => {
  it('segnala un layer peggiorato oltre tolleranza, non uno migliorato', () => {
    const prima = {12: {bosco: {dE: 3}, strada: {dE: 9}}};
    const ora = {12: {bosco: {dE: 8}, strada: {dE: 4}}};
    const reg = regressioni(ora, prima);
    expect(reg.map(d => d.id)).toEqual(['z12:bosco:regressione']);
  });
});
