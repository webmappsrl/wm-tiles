import {describe, expect, it} from 'vitest';
import {bloccante, registra, stato} from '../src/revisione/registro.js';

const d = (id, misure) => ({id, misure});

describe('registro', () => {
  it('senza verdetto la difformita\' e\' aperta e blocca', () => {
    expect(stato(d('z13:bosco:stile', {dE: 12}), {})).toBe('aperta');
    expect(bloccante('aperta')).toBe(true);
  });
  it('contenuto silenzia finche\' le misure restano quelle', () => {
    const reg = registra({}, {id: 'z14:residuo:#303030', verdetto: 'contenuto', motivo: 'strade nuove in OSM', giro: 'a', misure: {diffusione: 0.2}});
    expect(stato(d('z14:residuo:#303030', {diffusione: 0.25}), reg)).toBe('giudicata');
    expect(bloccante('giudicata')).toBe(false);
  });
  it('se le misure cambiano oltre tolleranza, il verdetto vecchio non vale piu\'', () => {
    const reg = registra({}, {id: 'z14:residuo:#303030', verdetto: 'contenuto', motivo: 'x', giro: 'a', misure: {diffusione: 0.2}});
    expect(stato(d('z14:residuo:#303030', {diffusione: 0.6}), reg)).toBe('riaperta');
  });
  it('stile e mancanza restano da correggere, e bloccano', () => {
    const reg = registra({}, {id: 'z13:bosco:stile', verdetto: 'stile', motivo: 'verde troppo chiaro', giro: 'a', misure: {dE: 12}});
    expect(stato(d('z13:bosco:stile', {dE: 12}), reg)).toBe('da-correggere');
    expect(bloccante('da-correggere')).toBe(true);
  });
  it('review 4: riapre se cambia il rapporto dei simboli, il colore locale o i pixel del residuo', () => {
    const r1 = registra({}, {id: 'a', verdetto: 'motore', motivo: 'x', giro: 'g', misure: {rapporto: 2.5, diffusione: 1}});
    expect(stato(d('a', {rapporto: 10, diffusione: 1}), r1)).toBe('riaperta');
    expect(stato(d('a', {rapporto: 2.7, diffusione: 1}), r1)).toBe('giudicata');
    const r2 = registra({}, {id: 'b', verdetto: 'contenuto', motivo: 'x', giro: 'g', misure: {dE: 12, locale: [100, 100, 100]}});
    expect(stato(d('b', {dE: 13, locale: [160, 100, 100]}), r2)).toBe('riaperta');
    const r3 = registra({}, {id: 'c', verdetto: 'contenuto', motivo: 'x', giro: 'g', misure: {diffusione: 0.2, pixel: 1000}});
    expect(stato(d('c', {diffusione: 0.2, pixel: 3000}), r3)).toBe('riaperta');
  });
  it('rifiuta un verdetto sconosciuto', () => {
    expect(() => registra({}, {id: 'x', verdetto: 'boh', motivo: '', giro: 'a', misure: {}})).toThrow();
  });
});
