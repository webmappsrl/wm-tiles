import {describe, expect, it} from 'vitest';
import request from 'supertest';
import {createApp} from '../src/server.js';

/**
 * Un indirizzo per ogni area della preview, da mandare a chi deve guardare un
 * caso d'uso: /preview/appennino-tosco-emiliano apre gia' su quell'area. Il
 * nome viene dall'etichetta dell'area, senza parentesi.
 */
describe('/preview/<area>', () => {
  const app = createApp();
  it('il nome dell\'area porta alla preview con l\'area scelta', async () => {
    const r = await request(app).get('/preview/appennino-tosco-emiliano');
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe('/preview/?area=appennino');
  });
  it('vale anche l\'id, e le parentesi dell\'etichetta non contano', async () => {
    expect((await request(app).get('/preview/appennino')).headers.location).toBe('/preview/?area=appennino');
    expect((await request(app).get('/preview/monte-pisano')).headers.location).toBe('/preview/?area=montepisano');
  });
  it('la configurazione della preview porta il nome di ogni area, per riscrivere l\'indirizzo', async () => {
    const {areas} = (await request(app).get('/preview/config.json')).body;
    expect(areas.find(a => a.id === 'appennino').slug).toBe('appennino-tosco-emiliano');
  });
  it('un nome sconosciuto e i file della preview non cambiano', async () => {
    expect((await request(app).get('/preview/nessuna-area')).status).toBe(404);
    expect((await request(app).get('/preview/config.json')).status).toBe(200);
  });
});
