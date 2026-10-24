import {describe, expect, it} from 'vitest';
import request from 'supertest';
import {createApp} from '../src/server.js';

/**
 * Uno stile per renderer. OpenLayers, che e' il frontend di wm-tiles, ha bisogno
 * del tileSize 256 sulle sorgenti vettoriali per chiedere lo stesso livello del
 * riferimento raster; MapLibre GL JS rifiuta qualunque valore diverso da 512 e
 * con il suo default e' gia' allineato, quindi gli serve l'assenza del campo.
 * Le tile sono le stesse: cambia solo cosa dichiara lo stile.
 */
describe('uno stile per renderer', () => {
  const app = createApp();
  const vettoriali = s => Object.entries(s).filter(([, v]) => v.type === 'vector');
  // supertest apre un server su una porta diversa a ogni richiesta, e senza
  // PUBLIC_URL lo stile costruisce gli URL delle tile dalla richiesta: la porta
  // va normalizzata, o i confronti falliscono su qualcosa che non c'entra.
  const senzaPorta = o => JSON.parse(JSON.stringify(o).replaceAll(/127\.0\.0\.1:\d+/g, '127.0.0.1:PORTA'));
  const stile = async url => senzaPorta((await request(app).get(url)).body);

  it('OpenLayers: ogni sorgente vettoriale dichiara 256', async () => {
    const v = vettoriali((await stile('/style-openlayers.json')).sources);
    expect(v.length).toBeGreaterThan(10);
    expect(v.filter(([, s]) => s.tileSize !== 256)).toEqual([]);
  });

  it('MapLibre: nessuna sorgente vettoriale dichiara il campo', async () => {
    const v = vettoriali((await stile('/style-maplibre.json')).sources);
    expect(v.length).toBeGreaterThan(10);
    expect(v.filter(([, s]) => 'tileSize' in s)).toEqual([]);
  });

  it('/style.json e\' quello di OpenLayers: chi lo usa oggi non si accorge di niente', async () => {
    expect(await stile('/style.json')).toEqual(await stile('/style-openlayers.json'));
  });

  it('il raster-dem del terrain resta a 256 in entrambi: li\' il campo e\' legittimo', async () => {
    for (const url of ['/style-openlayers.json', '/style-maplibre.json']) {
      const dem = Object.values((await stile(url)).sources).filter(s => s.type === 'raster-dem');
      expect(dem.length).toBeGreaterThan(0);
      expect(dem.every(s => s.tileSize === 256)).toBe(true);
    }
  });

  it('fra i due cambia solo il tileSize delle vettoriali, nient\'altro', async () => {
    const ol = await stile('/style-openlayers.json');
    const ml = await stile('/style-maplibre.json');
    for (const s of Object.values(ol.sources)) if (s.type === 'vector') delete s.tileSize;
    expect(ml).toEqual(ol);
  });

  it('i layer, le sorgenti e gli URL delle tile sono gli stessi: le tile non cambiano', async () => {
    const ol = await stile('/style-openlayers.json');
    const ml = await stile('/style-maplibre.json');
    expect(Object.keys(ml.sources)).toEqual(Object.keys(ol.sources));
    expect(ml.layers.map(l => l.id)).toEqual(ol.layers.map(l => l.id));
    const url = s => Object.values(s.sources).flatMap(x => x.tiles ?? []);
    expect(url(ml)).toEqual(url(ol));
    expect(url(ml).length).toBeGreaterThan(10);
  });
});
