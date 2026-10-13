import {describe, expect, it} from 'vitest';
import request from 'supertest';
import {createApp} from '../src/server.js';

/**
 * Quote e curve di livello hanno una cache di un anno: con un indirizzo fisso,
 * dopo una rigenerazione browser e CloudFront continuano a mostrare quelle
 * vecchie (13 ottobre 2026: la cucitura corretta del DEM non arrivava). La
 * versione sta nel percorso, come per lo sprite, e cambia con i dati.
 */
describe('versione di quote e curve nello stile', () => {
  const app = createApp();
  it('le URL di terrain e contours portano la versione dei dati', async () => {
    const {sources} = (await request(app).get('/style.json')).body;
    expect(sources.terrain.tiles[0]).toMatch(/\/dem\/v\d+\/terrain\/\{z\}\/\{x\}\/\{y\}\.png$/);
    expect(sources.contours.tiles[0]).toMatch(/\/t\/dem-v\d+\/[0-9a-f]+\/contours\//);
  });
  it('gli indirizzi versionati rispondono come quelli fissi', async () => {
    const {sources} = (await request(app).get('/style.json')).body;
    const path = u => new URL(u.replace('{z}/{x}/{y}', '0/0/0')).pathname;
    const dem = path(sources.terrain.tiles[0]);
    expect([200, 404]).toContain((await request(app).get(dem)).status);
    const cur = path(sources.contours.tiles[0]);
    expect([200, 204]).toContain((await request(app).get(cur)).status);
  });
});
