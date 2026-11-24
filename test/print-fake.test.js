import express from 'express';
import request from 'supertest';
import sharp from 'sharp';
import {describe, expect, it} from 'vitest';
import {fakePrint, fakePrintApp, FAKE_SHARD} from '../src/print/fake.js';
import {printRouter} from '../src/print/route.js';
import {DEFAULT_RPM, MAX_BODY_BYTES, MAX_COORDINATES, MAX_STROKE_WIDTH} from '../src/print/limits.js';
import {MIN_TOKEN_LENGTH} from '../src/print/tokens.js';

/**
 * La finta (R13). Il punto di questi test non e' che disegni qualcosa: e' che
 * rifiuti ESATTAMENTE cio' che rifiuta il servizio vero. Una finta che accetta
 * tutto fa passare i test degli shard e lascia scoprire i difetti contro il
 * servizio reale, cioe' in produzione.
 *
 * Per questo c'e' un test di parita': le stesse richieste cattive vanno al
 * `printRouter` vero (con il rendering sostituito) e alla finta, e le due parti
 * devono dare lo stesso esito e lo stesso messaggio.
 */

const TOKEN = 'token-di-prova-0123456789abcdef';

const line = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: {},
    geometry: {type: 'LineString', coordinates: [[10.0, 44.0], [10.12, 44.08]]},
  }],
};

/** La richiesta valida di riferimento: A4 verticale a 300 dpi, 2480 x 3508 px. */
const valid = {
  geometry: line,
  page: {format: 'a4', orientation: 'portrait', dpi: 300},
  styleId: 'webmapp',
};

const empty = {...valid, geometry: {type: 'FeatureCollection', features: []}};

/** Una traccia che attraversa l'antimeridiano: `fitBounds` la rifiuta. */
const antimeridian = {
  ...valid,
  geometry: {
    type: 'FeatureCollection',
    features: [{type: 'Feature', properties: {},
      geometry: {type: 'LineString', coordinates: [[179.9, 10], [-179.9, 10]]}}],
  },
};

/** Coordinate annidate oltre il limite: senza tetto la ricorsione esplodeva. */
const tooDeep = {
  ...valid,
  geometry: {
    type: 'FeatureCollection',
    features: [{type: 'Feature', properties: {},
      geometry: {type: 'MultiPolygon', coordinates: [[[[[[[[[[10, 44]]]]]]]]]]}}],
  },
};

/**
 * Una `GeometryCollection`: le sue geometrie stanno in `geometries`, non in
 * `coordinates`, quindi il conteggio delle coordinate ne vedeva ZERO e il tetto
 * di `MAX_COORDINATES` si aggirava con un campo. Oggi si rifiuta.
 */
const geometryCollection = {
  ...valid,
  geometry: {
    type: 'FeatureCollection',
    features: [{type: 'Feature', properties: {}, geometry: {type: 'GeometryCollection',
      geometries: [{type: 'LineString', coordinates: [[10.0, 44.0], [10.12, 44.08]]}]}}],
  },
};

/** Ogni campo che un chiamante potrebbe tentare di riempire con un indirizzo. */
const badRequests = [
  ['styleId con un URL', {...valid, styleId: 'http://169.254.169.254/latest/meta-data/'}],
  ['styleId con un percorso', {...valid, styleId: '../style/webmapp.json'}],
  ['styleId sconosciuto', {...valid, styleId: 'osm'}],
  ['format inesistente', {...valid, page: {...valid.page, format: 'a0'}}],
  ['format con un URL', {...valid, page: {...valid.page, format: 'https://example.invalid/a4.json'}}],
  ['orientation inesistente', {...valid, page: {...valid.page, orientation: 'diagonale'}}],
  ['dpi fuori scala', {...valid, page: {...valid.page, dpi: 1200}}],
  ['set con un URL', {...valid, set: 'http://127.0.0.1:8080/'}],
  ['campo sconosciuto nel corpo', {...valid, styleUrl: 'http://example.invalid/s.json'}],
  ['campo sconosciuto in page', {...valid, page: {...valid.page, url: 'http://example.invalid/'}}],
  ['FeatureCollection vuota', empty],
  ['geometry che non e\' una FeatureCollection', {...valid, geometry: {type: 'LineString', coordinates: []}}],
  ['antimeridiano', antimeridian],
  ['coordinate troppo annidate', tooDeep],
  ['stroke che non e\' esadecimale', {...valid, geometry: {type: 'FeatureCollection',
    features: [{...line.features[0], properties: {stroke: 'url(#x)'}}]}}],
  ['stroke-width fuori scala', {...valid, geometry: {type: 'FeatureCollection',
    features: [{...line.features[0], properties: {'stroke-width': MAX_STROKE_WIDTH + 1}}]}}],
  ['maxZoom fuori scala', {...valid, maxZoom: 42}],
  ['mapInfo che non e\' booleano', {...valid, mapInfo: 'si'}],
  ['GeometryCollection', geometryCollection],
  ['geometria di tipo sconosciuto', {...valid, geometry: {type: 'FeatureCollection',
    features: [{type: 'Feature', properties: {}, geometry: {type: 'Circle', coordinates: [10.12, 44.08]}}]}}],
  // corpi SCALARI: `express.json` e' in modo strict e li rifiuta prima della
  // validazione, con un messaggio diverso. Senza questi tre non c'era nessun
  // corpo non-oggetto nel confronto, e la finta dava un messaggio suo.
  ['corpo null', null],
  ['corpo stringa', 'ciao'],
  ['corpo numero', 7],
];

/**
 * I valori che un messaggio d'errore NON deve mai riportare, ricavati dal corpo
 * stesso invece che scritti a mano (R11).
 *
 * Costruirli a mano e' falsa sicurezza: con tre letterali (`179.9`, `10.12`,
 * `44.08`) il test passava anche dopo aver fatto riportare a `route.js` lo
 * `styleId` ricevuto, cioe' con la risposta che restituiva al chiamante
 * `http://169.254.169.254/latest/meta-data/`.
 *
 * Due insiemi:
 * - le COORDINATE del corpo, vietate sempre;
 * - i valori (e le chiavi: una chiave puo' essere essa stessa un dato) che
 *   questo corpo INTRODUCE rispetto a quello valido. La differenza serve
 *   perche' i messaggi legittimi citano i valori ammessi — `webmapp`, `a4`,
 *   `portrait` — che nel corpo valido ci sono.
 */
/**
 * I nomi che il servizio PUO' scrivere in un messaggio: sono campi
 * dell'interfaccia, non dati del chiamante. Una chiave che non e' qui dentro e'
 * roba arrivata da fuori e non deve tornare indietro.
 */
const NOMI_DI_CAMPO = new Set(['geometry', 'page', 'styleId', 'set', 'padding', 'maxZoom', 'mapInfo',
  'format', 'orientation', 'dpi', 'type', 'features', 'properties', 'coordinates', 'geometries',
  'stroke', 'stroke-width']);

function leaves(node, out = []) {
  if (Array.isArray(node)) {
    for (const v of node) leaves(v, out);
    return out;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (!NOMI_DI_CAMPO.has(k)) out.push(k);
      leaves(v, out);
    }
    return out;
  }
  out.push(node);
  return out;
}

function coordinateDi(node, dentro = false, out = []) {
  if (Array.isArray(node)) {
    for (const v of node) coordinateDi(v, dentro, out);
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) coordinateDi(v, dentro || k === 'coordinates', out);
  } else if (dentro && typeof node === 'number') {
    out.push(node);
  }
  return out;
}

/**
 * Il vocabolario dell'interfaccia: tipi GeoJSON, formati, orientamenti, stili.
 * Un messaggio puo' nominarli — «GeometryCollection non e' ammessa» dice cosa
 * c'e' che non va — mentre un valore fuori da questo elenco arriva dal
 * chiamante e non deve tornargli indietro.
 */
const VOCABOLARIO = new Set(['FeatureCollection', 'Feature', 'GeometryCollection',
  'Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon',
  'a4', 'a5', 'portrait', 'landscape', 'webmapp']);

function valoriVietati(bad) {
  const base = new Set(leaves(valid).map(v => JSON.stringify(v)));
  const introdotti = leaves(bad).filter(v => !base.has(JSON.stringify(v)) && !VOCABOLARIO.has(v));
  return [...new Set([...coordinateDi(bad), ...introdotti])]
    .filter(v => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length >= 2));
}

/** Il valore compare nel messaggio come valore, non come pezzo di un altro numero. */
function riporta(msg, v) {
  if (typeof v === 'number') {
    const n = String(v).replace(/[.\\]/g, '\\$&');
    return new RegExp(`(?<![\\d.-])${n}(?![\\d.])`).test(msg);
  }
  return msg.includes(v);
}

/** Il servizio vero, con il rendering e lo stile sostituiti: resta la validazione. */
function realApp() {
  const a = express();
  a.use('/v1/print', printRouter({
    tokens: new Map([[TOKEN, {shard: 'test', rpm: 10_000}]]),
    renderFrame: async ({width, height}) => Buffer.alloc(width * height * 3, 128),
    getStyle: async () => ({version: 8, sources: {},
      layers: [{id: 'bg', type: 'background', paint: {'background-color': '#ffffff'}}]}),
    shadeFactory: null,
  }));
  return a;
}

const post = (a, body, token = TOKEN) => {
  const r = request(a).post('/v1/print/map');
  if (token) r.set('Authorization', `Bearer ${token}`);
  // un corpo scalare va mandato come TESTO JSON: superagent, a cui si passi un
  // numero o una stringa, cambia il tipo del contenuto e la richiesta non
  // arriverebbe mai a `express.json`
  if (body === null || typeof body !== 'object') {
    return r.set('Content-Type', 'application/json').send(JSON.stringify(body));
  }
  return r.send(body);
};

describe('fakePrint', () => {
  it('la finta rifiuta le stesse richieste del servizio vero', async () => {
    for (const [why, bad] of badRequests) {
      await expect(fakePrint(bad), why).rejects.toThrow();
    }
  });

  it('e le rifiuta con lo stesso messaggio, non con uno suo', async () => {
    const a = realApp();
    for (const [why, bad] of badRequests) {
      const res = await post(a, bad);
      expect(res.status, why).toBe(400);
      await expect(fakePrint(bad), why).rejects.toThrow(res.body.error);
    }
  });

  it('rifiuta un corpo oltre il tetto, come il parser del servizio vero', async () => {
    const huge = {...valid, geometry: {type: 'FeatureCollection', features: [{
      type: 'Feature', properties: {},
      geometry: {type: 'LineString',
        coordinates: Array.from({length: 120_000}, (_, i) => [10.111111 + i * 1e-6, 44.222222])},
    }]}};
    expect(Buffer.byteLength(JSON.stringify(huge))).toBeGreaterThan(MAX_BODY_BYTES);
    await expect(fakePrint(huge)).rejects.toThrow(/corpo/);
  });

  it('l\'elenco dei valori da non riportare esce dai corpi, non da tre letterali', () => {
    // il guardiano del guardiano: se l'estrazione dei valori si rompe, i due
    // test qui sotto passano guardando il nulla
    const urlBody = badRequests.find(([why]) => why === 'styleId con un URL')[1];
    expect(valoriVietati(urlBody)).toContain('http://169.254.169.254/latest/meta-data/');
    expect(valoriVietati(antimeridian)).toEqual(expect.arrayContaining([179.9, -179.9]));
    expect(valoriVietati({...valid, maxZoom: 42})).toContain(42);
    expect(badRequests.reduce((n, [, bad]) => n + valoriVietati(bad).length, 0)).toBeGreaterThan(20);
  });

  it('nessun messaggio di errore riporta i valori ricevuti (R11)', async () => {
    for (const [why, bad] of badRequests) {
      const msg = await fakePrint(bad).then(() => '', e => e.message);
      expect(msg, why).not.toBe('');
      for (const v of valoriVietati(bad)) {
        expect(riporta(msg, v), `${why}: il messaggio riporta ${JSON.stringify(v)} — "${msg}"`).toBe(false);
      }
    }
  });

  it('e nemmeno il servizio vero li riporta: lo stesso controllo sulla risposta', async () => {
    const a = realApp();
    for (const [why, bad] of badRequests) {
      const msg = (await post(a, bad)).body.error ?? '';
      for (const v of valoriVietati(bad)) {
        expect(riporta(msg, v), `${why}: la risposta riporta ${JSON.stringify(v)} — "${msg}"`).toBe(false);
      }
    }
  });

  it('una GeometryCollection non aggira il tetto delle coordinate', async () => {
    // le geometrie di una GeometryCollection stanno in `geometries`: il
    // conteggio ne vedeva zero e un corpo sotto il tetto di byte passava con
    // molte piu' coordinate del massimo
    const molte = Array.from({length: 150_000}, () => [10, 44]);
    expect(molte.length).toBeGreaterThan(MAX_COORDINATES);
    const body = {...valid, geometry: {type: 'FeatureCollection', features: [{
      type: 'Feature', properties: {},
      geometry: {type: 'GeometryCollection', geometries: [{type: 'LineString', coordinates: molte}]},
    }]}};
    expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(MAX_BODY_BYTES);
    await expect(fakePrint(body)).rejects.toThrow(/GeometryCollection/);
    const res = await post(realApp(), body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/GeometryCollection/);
  });

  it('la finta restituisce un PNG delle dimensioni giuste', async () => {
    const png = await fakePrint(valid);
    const {width, height, format} = await sharp(png).metadata();
    expect(format).toBe('png');
    expect({width, height}).toEqual({width: 2480, height: 3508});
  });

  it('i PIXEL della pagina sono quelli attesi, non solo le dimensioni', async () => {
    // Il controllo R17 della rotta (il frame deve avere esattamente i pixel
    // della pagina) qui non c'e': `fakePrint` non passa dal router. Togliendo
    // `removeAlpha()` dal frame, `fakePrintApp` risponde 502 mentre `fakePrint`
    // restituiva in silenzio una pagina con il contenuto slittato di un canale.
    // Si becca dai pixel: la pagina finta e' GRIGIA — carta 232, cornice
    // #bdbdbd, scritte #8a8a8a, corredo #1a1a1a su bianco — quindi i tre canali
    // di colore devono coincidere esattamente, e la media e' un valore noto.
    const png = await fakePrint({...valid, page: {format: 'a5', orientation: 'portrait', dpi: 96}});
    const {channels: medie} = await sharp(png).stats();
    const [r, g, b] = medie.map(c => c.mean);
    expect(g).toBeCloseTo(r, 6);
    expect(b).toBeCloseTo(r, 6);
    expect(r).toBeGreaterThan(230);
    expect(r).toBeLessThan(231);
  });

  it('orizzontale scambia i lati, e un formato piccolo costa poco', async () => {
    const png = await fakePrint({...valid, page: {format: 'a5', orientation: 'landscape', dpi: 96}});
    const {width, height} = await sharp(png).metadata();
    expect({width, height}).toEqual({width: 794, height: 559});
  });

  it('mapInfo: false non cambia le dimensioni della pagina', async () => {
    const png = await fakePrint({...valid, page: {format: 'a5', orientation: 'portrait', dpi: 96},
      mapInfo: false});
    const {width, height} = await sharp(png).metadata();
    expect({width, height}).toEqual({width: 559, height: 794});
  });
});

describe('fakePrintApp', () => {
  const app = () => fakePrintApp({token: TOKEN});

  it('senza token risponde 401, come il servizio vero', async () => {
    const res = await post(app(), valid, null);
    expect(res.status).toBe(401);
  });

  it('con il token risponde un PNG e il corredo negli header', async () => {
    const res = await post(app(), {...valid, page: {format: 'a5', orientation: 'portrait', dpi: 96}});
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-wm-scale']).toMatch(/^1:\d+$/);
    expect(res.headers['x-wm-dpi']).toBe('96');
    expect(res.headers['cache-control']).toBe('no-store');
    const {width, height} = await sharp(res.body).metadata();
    expect({width, height}).toEqual({width: 559, height: 794});
  });

  it('e rifiuta una richiesta cattiva con 400', async () => {
    const res = await post(app(), empty);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/geometry\.features/);
  });

  it('risponde al controllo di salute del servizio vero, dichiarandosi finta', async () => {
    const res = await request(app()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({status: 'ok', fake: true});
  });

  it('dichiara di essere una finta nel nome dello shard', () => {
    expect(FAKE_SHARD).toMatch(/fake/);
  });

  it('rifiuta un token piu\' corto del minimo del servizio vero', () => {
    // un token di sei caratteri funzionava contro la finta e faceva FALLIRE
    // L'AVVIO del servizio vero (`loadTokens`): il difetto si scopriva in deploy
    expect(() => fakePrintApp({token: 'abc123'})).toThrow(/almeno 24/);
    expect(MIN_TOKEN_LENGTH).toBe(24);
    expect(() => fakePrintApp({token: 'a'.repeat(MIN_TOKEN_LENGTH)})).not.toThrow();
  });

  it('ha il limite al minuto della produzione, non uno piu\' largo', async () => {
    // la finta era a 600 richieste al minuto contro le 30 di `DEFAULT_RPM`: uno
    // shard che supera il limite deve prendersi il 429 QUI, non in produzione
    const a = fakePrintApp({token: TOKEN, rpm: 2});
    const piccola = {...valid, page: {format: 'a5', orientation: 'portrait', dpi: 72}};
    expect((await post(a, piccola)).status).toBe(200);
    expect((await post(a, piccola)).status).toBe(200);
    const terza = await post(a, piccola);
    expect(terza.status).toBe(429);
    expect(terza.headers['retry-after']).toBeDefined();
  });

  it('e di serie quel limite e\' esattamente DEFAULT_RPM', async () => {
    // il contatore del minuto sta PRIMA della validazione: un corpo cattivo
    // consuma quota come una pagina resa, e il conto costa un 400 invece di un
    // rendering
    const a = fakePrintApp({token: TOKEN});
    let passate = 0;
    for (let i = 0; i < DEFAULT_RPM + 1; i++) {
      // eslint-disable-next-line no-await-in-loop
      if ((await post(a, empty)).status === 429) break;
      passate++;
    }
    expect(passate).toBe(DEFAULT_RPM);
  });
});
