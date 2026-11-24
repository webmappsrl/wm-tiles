import {describe, expect, it} from 'vitest';
import {adattaStile} from '../src/raster/stile-nativo.js';
import {addOverlay, DEFAULT_STROKE, DEFAULT_WIDTH} from '../src/print/overlay.js';

const stileMinimo = {version: 8, sources: {}, layers: [{id: 'bg', type: 'background', paint: {'background-color': '#fff'}}]};
const fc = (...geometries) => ({type: 'FeatureCollection', features: geometries.map(([geometry, properties = {}]) => ({type: 'Feature', properties, geometry}))});
const linea = (coordinates, properties) => fc([{type: 'LineString', coordinates}, properties]);
const lineaConStile = (stroke, width) => linea([[10, 44], [10.1, 44.1]], {stroke, 'stroke-width': width});

describe('addOverlay', () => {
  it('aggiunge una source geojson e due layer, alone sotto e traccia sopra', () => {
    const s = addOverlay(stileMinimo, linea([[10, 44], [10.1, 44.1]]));
    expect(s.sources['print-overlay'].type).toBe('geojson');
    const ids = s.layers.slice(-2).map(l => l.id);
    expect(ids).toEqual(['print-overlay-halo', 'print-overlay-line']);
  });
  it('legge stroke e stroke-width dalla feature', () => {
    const s = addOverlay(stileMinimo, lineaConStile('#c1272d', 4));
    const l = s.layers.at(-1);
    expect(l.paint['line-color']).toEqual(['coalesce', ['get', 'stroke'], DEFAULT_STROKE]);
    expect(l.paint['line-width']).toEqual(['coalesce', ['get', 'stroke-width'], DEFAULT_WIDTH]);
  });
  it('non muta lo stile ricevuto', () => {
    const prima = JSON.stringify(stileMinimo);
    addOverlay(stileMinimo, linea([[10, 44], [10.1, 44.1]]));
    expect(JSON.stringify(stileMinimo)).toBe(prima);
  });
  it('i dati sono inline: nessun URL, la collezione e\' copiata', () => {
    const dati = linea([[10, 44], [10.1, 44.1]], {stroke: '#123456'});
    const s = addOverlay(stileMinimo, dati);
    const data = s.sources['print-overlay'].data;
    expect(typeof data).toBe('object');
    expect(data).toEqual(dati);
    expect(data).not.toBe(dati);
  });
  it('rifiuta dati che non sono una FeatureCollection (stringhe/URL comprese)', () => {
    expect(() => addOverlay(stileMinimo, 'http://10.0.0.1/x.geojson')).toThrow();
    expect(() => addOverlay(stileMinimo, {type: 'Feature', properties: {}, geometry: null})).toThrow();
    expect(() => addOverlay(stileMinimo, null)).toThrow();
  });
  it('alone chiaro, piu\' largo della traccia di 4 px, non configurabile', () => {
    const s = addOverlay(stileMinimo, lineaConStile('#000000', 2));
    const halo = s.layers.at(-2);
    expect(halo.type).toBe('line');
    expect(halo.paint['line-color']).toBe('#ffffff');
    expect(halo.paint['line-width']).toEqual(['+', ['coalesce', ['get', 'stroke-width'], DEFAULT_WIDTH], 4]);
  });
  it('i punti sono cerchi sotto alone e traccia; le linee non li toccano', () => {
    const s = addOverlay(stileMinimo, fc([{type: 'Point', coordinates: [10, 44]}, {stroke: '#00ff00'}]));
    const ids = s.layers.map(l => l.id);
    expect(ids.slice(-4)).toEqual(['print-overlay-point-halo', 'print-overlay-point', 'print-overlay-halo', 'print-overlay-line']);
    const punto = s.layers.find(l => l.id === 'print-overlay-point');
    expect(punto.type).toBe('circle');
    expect(punto.filter).toEqual(['==', ['geometry-type'], 'Point']);
    expect(punto.paint['circle-color']).toEqual(['coalesce', ['get', 'stroke'], DEFAULT_STROKE]);
    expect(s.layers.at(-1).filter).toEqual(['!=', ['geometry-type'], 'Point']);
  });
  it('tutti i layer aggiunti leggono la source inline', () => {
    const s = addOverlay(stileMinimo, linea([[10, 44], [10.1, 44.1]]));
    for (const l of s.layers.slice(1)) expect(l.source).toBe('print-overlay');
  });
  it('stile con sources e layers gia\' popolati: si aggiunge senza accumulo', () => {
    const base = {version: 8, sources: {a: {type: 'geojson', data: {type: 'FeatureCollection', features: []}}},
      layers: [{id: 'bg', type: 'background', paint: {}}, {id: 'x', type: 'line', source: 'a', paint: {}}]};
    const s = addOverlay(base, linea([[10, 44], [10.1, 44.1]]));
    expect(Object.keys(s.sources)).toEqual(['a', 'print-overlay']);
    expect(s.layers.map(l => l.id)).toEqual(['bg', 'x', 'print-overlay-point-halo', 'print-overlay-point',
      'print-overlay-halo', 'print-overlay-line']);
    expect(base.layers).toHaveLength(2);
  });
  it('chiamata due volte sullo stesso stile: errore esplicito', () => {
    const una = addOverlay(stileMinimo, linea([[10, 44], [10.1, 44.1]]));
    expect(() => addOverlay(una, linea([[10, 44], [10.1, 44.1]]))).toThrow(/print-overlay/);
  });
  it('ordine con adattaStile: se l\'overlay arriva prima, la traccia raddoppia come la strada', () => {
    const s = adattaStile(addOverlay(stileMinimo, linea([[10, 44], [10.1, 44.1]])));
    const traccia = s.layers.find(l => l.id === 'print-overlay-line');
    const alone = s.layers.find(l => l.id === 'print-overlay-halo');
    expect(JSON.stringify(traccia.paint['line-width'])).toBe(JSON.stringify(['*', 2, ['coalesce', ['get', 'stroke-width'], DEFAULT_WIDTH]]));
    expect(alone.paint['line-width']).toEqual(['*', 2, ['+', ['coalesce', ['get', 'stroke-width'], DEFAULT_WIDTH], 4]]);
  });
});
