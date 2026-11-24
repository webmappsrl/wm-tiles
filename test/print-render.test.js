import http from 'node:http';
import {describe, expect, it} from 'vitest';
import {createMaps, renderFrame} from '../src/print/render.js';
import {grigi} from '../src/raster/ombra.js';

/**
 * Il renderer puo' sbagliare senza alcun errore: un frame parziale esce come
 * un'immagine a posto. Qui si verificano le dimensioni, la traduzione dello
 * zoom (256 px, come OpenLayers) in quello di maplibre-native, il fallimento
 * esplicito e il verso dell'ombra su un frame non quadrato.
 */

const CENTER = [10, 44];
const W = 64, H = 96;

/** Stile senza rete: sfondo bianco e un poligono rosso che comincia `dx` pixel a est del centro (zoom OL). */
const stileConBordo = (zoom, dx) => {
  const lon = CENTER[0] + (dx * 360) / (256 * 2 ** zoom);
  return {
    version: 8,
    sources: {s: {type: 'geojson', data: {type: 'Feature', properties: {},
      geometry: {type: 'Polygon', coordinates: [[[lon, 40], [lon + 1, 40], [lon + 1, 48], [lon, 48], [lon, 40]]]}}}},
    layers: [
      {id: 'bg', type: 'background', paint: {'background-color': '#ffffff'}},
      {id: 'rosso', type: 'fill', source: 's', paint: {'fill-color': '#ff0000', 'fill-antialias': false}},
    ],
  };
};
const stileMinimo = {version: 8, sources: {}, layers: [{id: 'bg', type: 'background', paint: {'background-color': '#336699'}}]};
// come lo stile vero: le curve di livello (qui vuote) segnano dove sta l'ombra
const stileConCurve = {version: 8, sources: {c: {type: 'geojson', data: {type: 'FeatureCollection', features: []}}},
  layers: [{id: 'bg', type: 'background', paint: {'background-color': '#ffffff'}},
    {id: 'contour-x', type: 'line', source: 'c', paint: {'line-color': '#000'}}]};
const base = {center: CENTER, zoom: 12, width: W, height: H, ratio: 1, shade: null};

/** Prima colonna rossa a meta' altezza. */
const primoRosso = (rgb, width, height) => {
  const r = Math.floor(height / 2);
  for (let c = 0; c < width; c++) {
    const i = (r * width + c) * 3;
    if (rgb[i] > 200 && rgb[i + 1] < 60) return c;
  }
  return -1;
};

describe('renderFrame', () => {
  it('restituisce width*height*3 byte', async () => {
    const rgb = await renderFrame({style: stileMinimo, ...base});
    expect(rgb.length).toBe(W * H * 3);
    expect(Array.from(rgb.subarray(0, 3))).toEqual([0x33, 0x66, 0x99]);
  }, 60000);

  it('un errore del renderer non diventa un frame parziale', async () => {
    const stileRotto = {version: 8,
      sources: {v: {type: 'vector', tiles: ['http://localhost:1/{z}/{x}/{y}.pbf'], maxzoom: 14}},
      layers: [{id: 'bg', type: 'background', paint: {'background-color': '#fff'}},
        {id: 'x', type: 'fill', source: 'v', 'source-layer': 'a', paint: {'fill-color': '#f00'}}]};
    await expect(renderFrame({style: stileRotto, ...base})).rejects.toThrow();
  }, 60000);

  it('un layer di tipo sconosciuto non esce come frame senza quel layer', async () => {
    const stile = {...stileMinimo, layers: [...stileMinimo.layers, {id: 'a', type: 'nonsense'}]};
    await expect(renderFrame({style: stile, ...base})).rejects.toThrow(/stile non valido/);
  }, 60000);

  it('lo zoom e\' quello a 256 px, qualunque sia il ratio: il bordo cade dove deve', async () => {
    // il poligono comincia 16 px a est del centro: colonna W/2 + 16 = 48, a ratio 0,5 e a ratio 1
    for (const ratio of [0.5, 1]) {
      const rgb = await renderFrame({style: stileConBordo(12, 16), ...base, ratio});
      expect(Math.abs(primoRosso(rgb, W, H) - (W / 2 + 16)), `ratio ${ratio}`).toBeLessThanOrEqual(1);
    }
  }, 60000);

  it('un frame non quadrato ha le sue due dimensioni, non scambiate', async () => {
    const rgb = await renderFrame({style: stileConBordo(12, 16), ...base, width: 40, height: 120, ratio: 0.5});
    expect(rgb.length).toBe(40 * 120 * 3);
    expect(Math.abs(primoRosso(rgb, 40, 120) - (20 + 16))).toBeLessThanOrEqual(1);
  }, 60000);

  it('due rendering in parallelo: l\'errore va solo a chi lo ha causato, per le richieste', async () => {
    const stileRotto = {version: 8,
      sources: {v: {type: 'vector', tiles: ['http://localhost:1/{z}/{x}/{y}.pbf'], maxzoom: 14}},
      layers: [{id: 'x', type: 'fill', source: 'v', 'source-layer': 'a', paint: {'fill-color': '#f00'}}]};
    const [buono, rotto] = await Promise.allSettled([
      renderFrame({style: stileMinimo, ...base}), renderFrame({style: stileRotto, ...base})]);
    expect(rotto.status).toBe('rejected');
    expect(buono.status).toBe('fulfilled');
  }, 60000);

  it('createMaps restituisce la coppia sotto/sopra e si rilascia', () => {
    const m = createMaps({...stileMinimo, layers: [...stileMinimo.layers, {id: 'contour-x', type: 'background', paint: {}}]});
    expect(m.mSotto).toBeDefined();
    expect(m.mSopra).toBeDefined();
    m.release();
  });

  it('l\'ombra su un frame 64x96 ha il verso giusto: il versante verso il sole e\' piu\' chiaro', async () => {
    const set = {vert: 1, gamma: 1, slope: 0, sunAzimuth: 315, sunElevation: 45, opacity: 0.3, blend: 'multiply'};
    const f = {...set, zmin: 0, zmax: 99};
    const B = 3;
    const piano = (dx, dy) => {
      const Wr = W + 2 * B, Hr = H + 2 * B, E = new Float32Array(Wr * Hr);
      for (let r = 0; r < Hr; r++) for (let c = 0; c < Wr; c++) E[r * Wr + c] = 1000 + dx * c + dy * r;
      return E;
    };
    const media = async (dx, dy) => {
      const rgb = await renderFrame({style: stileConCurve, ...base, shade: async () => ({f, sh: grigi(piano(dx, dy), W, H, B, 10, f, 1)})});
      let s = 0;
      for (let i = 0; i < rgb.length; i += 3) s += rgb[i];
      return s / (rgb.length / 3);
    };
    // la luce viene da nord-ovest: un piano che sale verso sud guarda il sole; vale per le righe e per le colonne
    expect(await media(0, 5)).toBeGreaterThan(await media(0, -5) + 3);
    expect(await media(5, 0)).toBeGreaterThan(await media(-5, 0) + 3);
  }, 60000);

  it('l\'ombra sta dove deve, per posizione: il rilievo che varia solo per colonna da righe tutte uguali', async () => {
    const f = {vert: 1, gamma: 1, slope: 0, sunAzimuth: 315, sunElevation: 45, opacity: 0.3, blend: 'multiply', zmin: 0, zmax: 99};
    const B = 3, Wr = W + 2 * B, Hr = H + 2 * B;
    // quota che dipende solo dalla colonna, poi solo dalla riga: uno stride sbagliato in componi la mescola
    const quota = (fn) => {
      const E = new Float32Array(Wr * Hr);
      for (let r = 0; r < Hr; r++) for (let c = 0; c < Wr; c++) E[r * Wr + c] = fn(r, c);
      return E;
    };
    const render = E => renderFrame({style: stileConCurve, ...base, shade: async () => ({f, sh: grigi(E, W, H, B, 10, f, 1)})});
    const px = (rgb, r, c) => rgb[(r * W + c) * 3];
    const perColonna = await render(quota((r, c) => 1000 + 2 * c * c));
    const valoriRiga0 = new Set(Array.from({length: W}, (_, c) => px(perColonna, 0, c)));
    expect(valoriRiga0.size).toBeGreaterThan(3);
    for (const r of [1, 17, 48, H - 1]) for (let c = 0; c < W; c++) expect(px(perColonna, r, c)).toBe(px(perColonna, 0, c));
    const perRiga = await render(quota(r => 1000 + 2 * r * r));
    expect(new Set(Array.from({length: H}, (_, r) => px(perRiga, r, 0))).size).toBeGreaterThan(3);
    for (const c of [1, 17, W - 1]) for (let r = 0; r < H; r++) expect(px(perRiga, r, c)).toBe(px(perRiga, r, 0));
  }, 60000);

  it('uno sprite o un glifo mancante (404) e\' un errore, una tile fuori copertura no', async () => {
    const server = http.createServer((req, res) => { res.statusCode = 404; res.end(); });
    await new Promise(ok => server.listen(0, '127.0.0.1', ok));
    const host = `http://127.0.0.1:${server.address().port}`;
    try {
      const conTile = {version: 8, sources: {v: {type: 'vector', tiles: [`${host}/{z}/{x}/{y}.pbf`], maxzoom: 14}},
        layers: [{id: 'bg', type: 'background', paint: {'background-color': '#fff'}},
          {id: 'x', type: 'fill', source: 'v', 'source-layer': 'a', paint: {'fill-color': '#f00'}}]};
      await expect(renderFrame({style: conTile, ...base})).resolves.toBeDefined();
      const conGlifi = {...conTile, glyphs: `${host}/g/{fontstack}/{range}.pbf`,
        layers: [...conTile.layers, {id: 't', type: 'symbol', source: 's2', layout: {'text-field': 'ciao', 'text-font': ['F']}}],
        sources: {...conTile.sources, s2: {type: 'geojson', data: {type: 'Point', coordinates: CENTER}}}};
      await expect(renderFrame({style: conGlifi, ...base})).rejects.toThrow();
    } finally { server.close(); }
  }, 60000);

  it('una tile 200 corrotta e\' un errore, anche se la richiesta e\' riuscita', async () => {
    const server = http.createServer((req, res) => { res.setHeader('content-type', 'application/x-protobuf'); res.end(Buffer.from([0xff, 0xff, 0xff, 0x01, 0x02])); });
    await new Promise(ok => server.listen(0, '127.0.0.1', ok));
    const host = `http://127.0.0.1:${server.address().port}`;
    try {
      const stile = {version: 8, sources: {v: {type: 'vector', tiles: [`${host}/{z}/{x}/{y}.pbf`], maxzoom: 14}},
        layers: [{id: 'x', type: 'fill', source: 'v', 'source-layer': 'a', paint: {'fill-color': '#f00'}}]};
      await expect(renderFrame({style: stile, ...base})).rejects.toThrow();
    } finally { server.close(); }
  }, 60000);

  it('due render concorrenti sulla stessa coppia di mappe: il secondo rifiuta', async () => {
    const maps = createMaps(stileMinimo, 1);
    try {
      const [a, b] = await Promise.allSettled([renderFrame({style: stileMinimo, ...base, maps}), renderFrame({style: stileMinimo, ...base, maps})]);
      expect(a.status).toBe('fulfilled');
      expect(b.status).toBe('rejected');
      expect(String(b.reason)).toMatch(/occupate/);
      await expect(renderFrame({style: stileMinimo, ...base, maps})).resolves.toBeDefined();
    } finally { maps.release(); }
  }, 60000);
});
