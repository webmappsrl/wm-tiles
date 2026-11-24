import {describe, expect, it} from 'vitest';
import {PAGE_FORMATS, pageSize} from '../src/print/formats.js';
import {fitBounds} from '../src/print/fit.js';

const punto = (lon, lat) => ({
  type: 'FeatureCollection',
  features: [{type: 'Feature', properties: {}, geometry: {type: 'Point', coordinates: [lon, lat]}}],
});
const linea = coordinates => ({
  type: 'FeatureCollection',
  features: [{type: 'Feature', properties: {}, geometry: {type: 'LineString', coordinates}}],
});
const base = {width: 2480, height: 3508, padding: 24, maxZoom: 15};

describe('pageSize', () => {
  it('un A4 verticale a 300 dpi e\' 2480x3508', () => {
    expect(pageSize({format: 'a4', orientation: 'portrait', dpi: 300})).toEqual({width: 2480, height: 3508});
  });
  it('orizzontale scambia i lati', () => {
    expect(pageSize({format: 'a4', orientation: 'landscape', dpi: 300})).toEqual({width: 3508, height: 2480});
  });
  it('un A5 verticale a 150 dpi e\' 874x1240', () => {
    expect(pageSize({format: 'a5', orientation: 'portrait', dpi: 150})).toEqual({width: 874, height: 1240});
  });
  it('i formati sono in millimetri, verticali', () => {
    expect(PAGE_FORMATS.a4).toEqual({widthMm: 210, heightMm: 297});
    expect(PAGE_FORMATS.a5).toEqual({widthMm: 148, heightMm: 210});
  });
  it('formato, orientamento o dpi non validi sono errori che nominano il campo', () => {
    expect(() => pageSize({format: 'a0', orientation: 'portrait', dpi: 300})).toThrow(/format/);
    expect(() => pageSize({format: 'a4', orientation: 'diagonale', dpi: 300})).toThrow(/orientation/);
    expect(() => pageSize({format: 'a4', orientation: 'portrait'})).toThrow(/dpi/);
    expect(() => pageSize({format: 'a4', orientation: 'portrait', dpi: 0})).toThrow(/dpi/);
  });
  it('l\'errore non riporta il valore ricevuto', () => {
    expect(() => pageSize({format: 'segretissimo', orientation: 'portrait', dpi: 300})).toThrow(/^(?!.*segretissimo)/s);
  });
});

describe('fitBounds', () => {
  it('un punto solo non porta lo zoom all\'infinito', () => {
    const {zoom} = fitBounds(punto(10.72, 44.21), {width: 2480, height: 3508, padding: 24, maxZoom: 15});
    expect(zoom).toBe(15);
  });
  it('una traccia larga entra per il lato lungo', () => {
    const {zoom} = fitBounds(linea([[10.0, 44.2], [10.2, 44.2]]), {width: 2480, height: 3508, padding: 24, maxZoom: 18});
    expect(zoom).toBeLessThan(fitBounds(linea([[10.0, 44.2], [10.02, 44.2]]), {width: 2480, height: 3508, padding: 24, maxZoom: 18}).zoom);
  });
  it('zoom e centro coincidono col conto Web Mercator fatto a mano', () => {
    // 0,2 gradi di longitudine = 0,2 * 6378137 * pi/180 = 22263,898 m;
    // area utile 2480 - 48 = 2432 px -> 9,15441 m/px;
    // zoom = log2(156543,034 / 9,15441) = 14,0617087
    const r = fitBounds(linea([[10.0, 44.2], [10.2, 44.2]]), {width: 2480, height: 3508, padding: 24, maxZoom: 18});
    expect(r.zoom).toBeCloseTo(14.0617087, 5);
    expect(r.center[0]).toBeCloseTo(10.1, 9);
    expect(r.center[1]).toBeCloseTo(44.2, 9);
  });
  it('il lato alto decide quando la traccia e\' verticale, e il centro e\' il medio in Mercatore', () => {
    // lat 44 -> 45 a lon 10: dy Mercatore = 6378137 * (ln tan(pi/4+45deg/2) - ln tan(pi/4+44deg/2));
    // senza padding su 2000 px di altezza lo zoom e' 10,9700644;
    // il centro non e' 44,5 ma 44,5021440203 (media in metri, non in gradi)
    const r = fitBounds(linea([[10, 44], [10, 45]]), {width: 1000, height: 2000, padding: 0, maxZoom: 18});
    expect(r.zoom).toBeCloseTo(10.9700644, 5);
    expect(r.center[0]).toBeCloseTo(10, 9);
    expect(r.center[1]).toBeCloseTo(44.5021440203, 8);
  });
  it('il padding toglie spazio su entrambi i lati', () => {
    // 100 px - 2*10 = 80 px utili: mezzo zoom (log2(100/80)) piu' in la senza padding
    const g = linea([[10, 44], [10.1, 44]]);
    const senza = fitBounds(g, {width: 100, height: 100, padding: 0, maxZoom: 18}).zoom;
    const con = fitBounds(g, {width: 100, height: 100, padding: 10, maxZoom: 18}).zoom;
    expect(senza - con).toBeCloseTo(Math.log2(100 / 80), 9);
  });
  it('maxZoom limita anche una traccia piccola', () => {
    expect(fitBounds(linea([[10, 44], [10.00001, 44]]), {...base, maxZoom: 12}).zoom).toBe(12);
  });
  it('un padding piu\' grande della pagina e\' un errore, non uno zoom negativo', () => {
    expect(() => fitBounds(linea([[10, 44], [10.1, 44.1]]), {width: 100, height: 100, padding: 200, maxZoom: 18}))
      .toThrow(/padding/);
    expect(() => fitBounds(linea([[10, 44], [10.1, 44.1]]), {width: 100, height: 100, padding: 50, maxZoom: 18}))
      .toThrow(/padding/);
  });
  it('una collection vuota e\' un errore che non cita i dati', () => {
    expect(() => fitBounds({type: 'FeatureCollection', features: []}, base)).toThrow(/nessuna geometria/);
  });
  it('coordinate invertite cadono fuori dal mondo e lo dicono', () => {
    expect(() => fitBounds(punto(44.21, 10.72), base)).not.toThrow();
    expect(() => fitBounds(punto(200, 95), base)).toThrow(/fuori/);
  });
  it('l\'errore di coordinate fuori dal mondo non riporta i valori', () => {
    expect(() => fitBounds(punto(201.123456, 95.654321), base)).toThrow(/^(?!.*(201|95\.65))/s);
  });
  it('oltre il limite di Mercatore la latitudine si ferma', () => {
    const {center} = fitBounds(punto(10, 85.5), base);
    expect(center[1]).toBeLessThanOrEqual(85.0512);
    expect(center[1]).toBeGreaterThan(85);
  });
  it('accetta Feature, geometrie nude, poligoni e collezioni miste', () => {
    const poly = {type: 'Polygon', coordinates: [[[10, 44], [10.1, 44], [10.1, 44.1], [10, 44]]]};
    expect(fitBounds(poly, base).center[0]).toBeCloseTo(10.05, 9);
    expect(fitBounds({type: 'Feature', properties: {}, geometry: poly}, base).center[0]).toBeCloseTo(10.05, 9);
    const mista = {type: 'FeatureCollection', features: [
      {type: 'Feature', properties: {}, geometry: {type: 'Point', coordinates: [10, 44]}},
      {type: 'Feature', properties: {}, geometry: {type: 'MultiPoint', coordinates: [[10.2, 44]]}},
    ]};
    expect(fitBounds(mista, base).center[0]).toBeCloseTo(10.1, 9);
  });
  it('feature con geometry null e coordinate non numeriche sono errori sul campo', () => {
    const nulla = {type: 'FeatureCollection', features: [{type: 'Feature', properties: {}, geometry: null}]};
    expect(() => fitBounds(nulla, base)).toThrow(/nessuna geometria/);
    expect(() => fitBounds(punto('x', 44), base)).toThrow(/coordinat/);
    expect(() => fitBounds(punto(NaN, 44), base)).toThrow(/coordinat/);
  });
  it('opzioni non valide nominano il campo', () => {
    expect(() => fitBounds(punto(10, 44), {...base, width: 0})).toThrow(/width/);
    expect(() => fitBounds(punto(10, 44), {...base, height: -1})).toThrow(/height/);
    expect(() => fitBounds(punto(10, 44), {...base, padding: -1})).toThrow(/padding/);
    expect(() => fitBounds(punto(10, 44), {...base, maxZoom: undefined})).toThrow(/maxZoom/);
  });
  it('rifiuta un bbox che attraversa l\'antimeridiano, senza citare le coordinate', () => {
    expect(() => fitBounds(linea([[179, 10], [-179, 10]]), base)).toThrow(/antimeridiano/);
    expect(() => fitBounds(linea([[179.123, 10], [-179.456, 10]]), base)).toThrow(/^(?!.*(179|456))/s);
  });
  it('non rifiuta chi tocca i 180 senza attraversarli, ne\' un emisfero intero', () => {
    expect(() => fitBounds(linea([[179, 10], [180, 10]]), base)).not.toThrow();
    expect(() => fitBounds(linea([[-180, 10], [-179, 10]]), base)).not.toThrow();
    expect(() => fitBounds(linea([[0, 10], [180, 10]]), base)).not.toThrow();
    expect(() => fitBounds(linea([[-180, 10], [0, 10]]), base)).not.toThrow();
    expect(fitBounds(linea([[-179, 10], [-178, 10]]), base).center[0]).toBeCloseTo(-178.5, 9);
  });
  it('una lista di coordinate vuota e\' un errore sul campo', () => {
    expect(() => fitBounds(linea([]), base)).toThrow(/coordinate/);
  });
});
