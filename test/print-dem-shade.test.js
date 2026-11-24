import sharp from 'sharp';
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {PIXEL_Z0} from '../src/raster/ombra.js';

/**
 * L'aritmetica del mosaico DEM della pagina stampata (`demShade`).
 *
 * E' l'unica parte di `route.js` che differisce da `pipeline/render-png.mjs`: li'
 * lo zoom e' intero, qui esce da `fitBounds` ed e' frazionario, quindi il livello
 * della fascia si sceglie come nella preview (N - 0,585) e il gradiente si misura
 * su un numero INTERO di pixel della vista. Finora nessun test la eseguiva: tutti
 * iniettavano uno style senza `sources.terrain`, e la funzione usciva con `null`.
 *
 * Per misurare `steps` e il divisore si sostituisce `grigi`, che e' il solo punto
 * in cui quei numeri arrivano; il resto della catena (decodifica Terrarium,
 * `quoteVista`, `fasciaDi`) resta quello vero.
 */

const calls = [];

vi.mock('../src/raster/ombra.js', async importOriginal => {
  const original = await importOriginal();
  return {
    ...original,
    grigi: (...args) => {
      calls.push(args);
      return new Uint8ClampedArray(args[1] * args[2]);
    },
  };
});

/** Le tile richieste: `z/x/y`, per controllare quale livello del DEM si legge. */
const tilesAsked = [];
let terrariumPng;

beforeAll(async () => {
  // una tile Terrarium piatta: i valori non contano, conta l'aritmetica attorno
  terrariumPng = await sharp(Buffer.alloc(256 * 256 * 3, 128), {raw: {width: 256, height: 256, channels: 3}})
    .png().toBuffer();
  vi.stubGlobal('fetch', async url => {
    tilesAsked.push(String(url).replace(/^.*\/terrain\//, '').replace(/\.png$/, ''));
    return {status: 200, arrayBuffer: async () => terrariumPng.buffer.slice(
      terrariumPng.byteOffset, terrariumPng.byteOffset + terrariumPng.byteLength)};
  });
});

afterEach(() => { calls.length = 0; tilesAsked.length = 0; });

/** Due fasce distinguibili: il livello scelto si legge dalla band che torna. */
const BANDS = [
  {name: 'low', zmin: 8, zmax: 12, vert: 1, gamma: 1, slope: 0, sunAz: 315, sunEl: 45, opacity: 0.3},
  {name: 'high', zmin: 13, zmax: 16, vert: 2, gamma: 1, slope: 0, sunAz: 315, sunEl: 60, opacity: 0.3},
];

const style = (minzoom = 8, maxzoom = 16) => ({
  version: 8,
  sources: {terrain: {type: 'raster-dem', tiles: ['http://127.0.0.1:1/dem/v1/terrain/{z}/{x}/{y}.png'], minzoom, maxzoom}},
  layers: [{id: 'bg', type: 'background'}, {id: 'contour-cp', type: 'line', source: 'terrain'}],
  metadata: {'wm:hillshade': {fasce: BANDS}},
});

const VIEW = {center: [10.5, 44.2], width: 256, height: 256};

describe('demShade', () => {
  it('senza terrain, senza fasce o senza curve non c\'e\' ombra', async () => {
    const {demShade} = await import('../src/print/route.js');
    expect(demShade({...style(), sources: {}})).toBe(null);
    expect(demShade({...style(), metadata: {}})).toBe(null);
    expect(demShade({...style(), layers: [{id: 'bg', type: 'background'}]})).toBe(null);
  });

  it('il livello della band si sceglie a N - 0,585, come i PNG di TGen', async () => {
    const {demShade} = await import('../src/print/route.js');
    const shade = demShade(style());
    // 12,41 -> livello 12 (fascia bassa); 12,42 -> livello 13 (fascia alta)
    expect((await shade({...VIEW, zoom: 12.41})).f.name).toBe('low');
    expect(tilesAsked.every(t => t.startsWith('12/'))).toBe(true);
    tilesAsked.length = 0;
    expect((await shade({...VIEW, zoom: 12.42})).f.name).toBe('high');
    // e la tile del DEM letta e' quella di quel livello, non quella dello zoom
    expect(tilesAsked.length).toBeGreaterThan(0);
    expect(tilesAsked.every(t => t.startsWith('13/'))).toBe(true);
  });

  it('sotto il minzoom del DEM non si disegna ombra', async () => {
    const {demShade} = await import('../src/print/route.js');
    const shade = demShade(style(8, 16));
    expect(await shade({...VIEW, zoom: 7.0})).toBe(null);   // livello 7 < 8
    expect(await shade({...VIEW, zoom: 7.42})).not.toBe(null); // livello 8
  });

  it('`steps` e\' un numero INTERO di pixel della vista, e il divisore la distanza vera fra i campioni', async () => {
    const {demShade} = await import('../src/print/route.js');
    const cases = [
      // [zoom, maxzoom del DEM, steps attesi, fascia attesa]
      [10.0, 16, 1, 'low'],   // livello 10, s = 1 esatto
      [12.42, 16, 1, 'high'],   // livello 13, s = 2^-0,58 = 0,67 -> 1
      [14.0, 16, 1, 'high'],
      [17.42, 16, 3, 'high'],   // livello 18 oltre il DEM: zd = 16, s = 2^1,42 = 2,67 -> 3
      [18.42, 16, 5, 'high'],   // s = 2^2,42 = 5,35 -> 5
    ];
    for (const [zoom, maxzoom, steps, band] of cases) {
      calls.length = 0;
      const shade = demShade(style(8, maxzoom));
      const out = await shade({...VIEW, zoom});
      expect(out).not.toBe(null);
      expect(calls).toHaveLength(1);
      const [, width, height, B, passo, f, s] = calls[0];
      expect([width, height]).toEqual([VIEW.width, VIEW.height]);
      expect(s).toBe(steps);
      expect(B).toBe(3 * steps);                       // il bordo serve alla finestra 3x3
      expect(passo).toBeCloseTo((steps * PIXEL_Z0) / 2 ** zoom, 9);
      // la fascia e' quella del LIVELLO, non quella dello zoom della vista
      expect(f.name).toBe(band);
      expect(out.sh).toHaveLength(VIEW.width * VIEW.height);
    }
  });

  it('il divisore e\' la differenza con render-png.mjs: cresce con `steps`, non con lo zoom', async () => {
    const {demShade} = await import('../src/print/route.js');
    const shade = demShade(style(8, 16));
    await shade({...VIEW, zoom: 14.0});
    const a = calls[0];
    calls.length = 0;
    await shade({...VIEW, zoom: 15.0});
    const b = calls[0];
    // stesso `steps` (1), zoom doppio: il passo in metri si dimezza
    expect(a[6]).toBe(1);
    expect(b[6]).toBe(1);
    expect(b[4]).toBeCloseTo(a[4] / 2, 9);
  });

  it('fuori copertura la quota vale 0: il bordo dell\'area non diventa un muro', async () => {
    const {demShade} = await import('../src/print/route.js');
    vi.stubGlobal('fetch', async () => ({status: 204, arrayBuffer: async () => new ArrayBuffer(0)}));
    const shade = demShade(style());
    const out = await shade({...VIEW, zoom: 13.0});
    expect(out).not.toBe(null);
    expect(out.sh).toHaveLength(VIEW.width * VIEW.height);
  });
});
