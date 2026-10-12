import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import {adattaStile, localizza, per, sposta} from '../src/raster/stile-nativo.js';

/**
 * L'adattamento dello stile a maplibre-native non da' errori quando sbaglia:
 * una grandezza non raddoppiata esce sottile la meta', una soglia non spostata
 * accende un layer un livello prima. Questi test fissano le regole.
 */

describe('sposta', () => {
  it('alza di uno le soglie di uno step sullo zoom', () => {
    expect(sposta(['step', ['zoom'], 1, 12, 2, 14, 3])).toEqual(['step', ['zoom'], 1, 13, 2, 15, 3]);
  });
  it('alza di uno le soglie di un interpolate sullo zoom', () => {
    expect(sposta(['interpolate', ['linear'], ['zoom'], 11, 9, 16, 11])).toEqual(['interpolate', ['linear'], ['zoom'], 12, 9, 17, 11]);
  });
  it('lascia stare i valori che non dipendono dallo zoom', () => {
    expect(sposta(['match', ['get', 'class'], 'a', 1, 2])).toEqual(['match', ['get', 'class'], 'a', 1, 2]);
    expect(sposta(3)).toBe(3);
  });
});

describe('per', () => {
  it('moltiplica le uscite di uno step, non le soglie', () => {
    expect(per(['step', ['zoom'], 1, 12, 2], 2)).toEqual(['step', ['zoom'], 2, 12, 4]);
  });
  it('moltiplica le uscite di un interpolate, non le soglie', () => {
    expect(per(['interpolate', ['linear'], ['zoom'], 11, 9, 16, 11], 2)).toEqual(['interpolate', ['linear'], ['zoom'], 11, 18, 16, 22]);
  });
  it('avvolge un\'espressione sui dati', () => {
    expect(per(['get', 'w'], 2)).toEqual(['*', 2, ['get', 'w']]);
  });
});

describe('adattaStile', () => {
  const base = {
    version: 8, sources: {s: {type: 'vector', tiles: ['http://x/{z}/{x}/{y}.pbf']}},
    layers: [
      {id: 'landcover-fill', type: 'fill', source: 's', 'source-layer': 'a', minzoom: 12, paint: {'fill-color': '#fff'}},
      {id: 'strada', type: 'line', source: 's', 'source-layer': 'a', paint: {'line-color': '#000'}},
      {id: 'nome', type: 'symbol', source: 's', 'source-layer': 'a',
        layout: {'symbol-placement': 'line', 'text-field': ['get', 'name'], 'symbol-spacing': 150}},
      {id: 'scudo', type: 'symbol', source: 's', 'source-layer': 'a',
        layout: {'symbol-placement': 'line', 'text-field': ['get', 'ref'], 'icon-image': 'x', 'symbol-spacing': 760}},
    ],
  };
  const a = adattaStile(base);
  const l = id => a.layers.find(x => x.id === id);

  it('non modifica lo stile di partenza', () => {
    expect(base.layers[0].minzoom).toBe(12);
    expect(base.layers[1].paint['line-width']).toBeUndefined();
  });
  it('alza minzoom di uno', () => {
    expect(l('landcover-fill').minzoom).toBe(13);
  });
  it('raddoppia anche le grandezze lasciate al default', () => {
    expect(l('strada').paint['line-width']).toBe(2);
    expect(l('nome').layout['text-size']).toBe(32);
  });
  it('quadruplica la spaziatura del testo lungo le linee: pixel ratio e passo di OpenLayers', () => {
    expect(l('nome').layout['symbol-spacing']).toBe(600);
  });
  it('raddoppia soltanto la spaziatura dei simboli con icona', () => {
    expect(l('scudo').layout['symbol-spacing']).toBe(1520);
  });
  it('spegne il contorno sfumato sulle superfici', () => {
    expect(l('landcover-fill').paint['fill-antialias']).toBe(false);
  });
  it('produce uno stile valido anche su quello vero', () => {
    const vero = JSON.parse(readFileSync(new URL('../style/webmapp.json', import.meta.url), 'utf8'));
    // le sorgenti le inietta il server: per la validazione bastano vuote (come validate-style.mjs)
    vero.sources = Object.fromEntries([...new Set(vero.layers.map(l => l.source).filter(Boolean))]
      .map(s => [s, {type: 'vector', tiles: ['http://example.invalid/{z}/{x}/{y}.pbf']}]));
    vero.glyphs ??= 'http://example.invalid/{fontstack}/{range}.pbf';
    expect(validateStyleMin(adattaStile(vero))).toEqual([]);
  });
});

describe('localizza', () => {
  it('riporta al server locale tile, glifi, sprite e quote dello stile pubblico', () => {
    const s = localizza({
      version: 8, glyphs: 'https://tiles.maphub.it/glyphs/{fontstack}/{range}.pbf', sprite: 'https://tiles.maphub.it/sprite/v1/webmapp',
      sources: {
        osm: {type: 'vector', tiles: ['https://tiles.maphub.it/t/v/s/osm/{z}/{x}/{y}.pbf']},
        terrain: {type: 'raster-dem', tiles: ['https://tiles.maphub.it/dem/terrain/{z}/{x}/{y}.png']},
      },
      layers: [],
    }, 'http://localhost:8080/');
    expect(s.sources.osm.tiles[0]).toBe('http://localhost:8080/t/v/s/osm/{z}/{x}/{y}.pbf');
    expect(s.sources.terrain.tiles[0]).toBe('http://localhost:8080/dem/terrain/{z}/{x}/{y}.png');
    expect(s.glyphs).toBe('http://localhost:8080/glyphs/{fontstack}/{range}.pbf');
    expect(s.sprite).toBe('http://localhost:8080/sprite/v1/webmapp');
  });
});
