import net from 'node:net';
import express from 'express';
import request from 'supertest';
import sharp from 'sharp';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {printRouter, STYLE_IDS} from '../src/print/route.js';
import {
  MAX_BODY_BYTES, MAX_SLOTS, RENDER_TIMEOUT_MS, RETRY_AFTER_TIMEOUT_SECONDS, createLimits,
} from '../src/print/limits.js';
import {ATTRIBUTIONS} from '../src/print/map-info.js';

/**
 * La prima rotta in scrittura del server. Qui si verificano le cose che non si
 * vedono guardando un PNG: il token, gli slot, il tempo massimo, i tetti, e il
 * fatto che un errore di validazione non riporti mai le coordinate ricevute
 * (R11: dagli shard arrivano anche sentieri non pubblicati).
 *
 * Il rendering vero non serve: `renderFrame` e' una dipendenza e qui restituisce
 * un rettangolo di grigio uniforme. Tutto il resto della catena — inquadratura,
 * corredo, PNG — e' quello di produzione, cosi' la misura sul PNG di risposta
 * dice davvero se il corredo finisce sulla pagina.
 */

const TOKEN = 'token-di-prova-0123456789abcdef';
const tokens = () => new Map([[TOKEN, {shard: 'test', rpm: 1000}]]);

const line = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: {},
    geometry: {type: 'LineString', coordinates: [[10.0, 44.0], [10.12, 44.08]]},
  }],
};
const point = (lon, lat) => ({
  type: 'FeatureCollection',
  features: [{type: 'Feature', properties: {}, geometry: {type: 'Point', coordinates: [lon, lat]}}],
});

/** A5 a 300 dpi: una pagina vera (1748x2480) ma un quarto dei pixel di un A4. */
const validRequest = {
  geometry: line,
  page: {format: 'a5', orientation: 'portrait', dpi: 300},
  styleId: 'webmapp',
};
/** Pagina piccola: per i test che non guardano l'immagine. */
const lightRequest = {...validRequest, page: {format: 'a5', orientation: 'portrait', dpi: 96}};

const GREY = 128;
/** Un frame finto: grigio uniforme, delle dimensioni chieste. */
const greyFrame = async ({width, height}) => Buffer.alloc(width * height * 3, GREY);

/** Uno stile minimo: la rotta non deve andare a chiedere niente a nessuno. */
const fakeStyle = async () => ({version: 8, sprite: 'http://127.0.0.1:1/sprite/v1/webmapp',
  sources: {}, layers: [{id: 'bg', type: 'background', paint: {'background-color': '#ffffff'}}]});

function app(deps = {}) {
  const a = express();
  a.use('/v1/print', printRouter({tokens: tokens(), renderFrame: greyFrame, getStyle: fakeStyle, ...deps}));
  return a;
}

const post = (a, body, token = TOKEN) => {
  const r = request(a).post('/v1/print/map');
  if (token) r.set('Authorization', `Bearer ${token}`);
  return r.send(body);
};

/** Statistiche di una finestra dell'immagine: quanti pixel non sono il grigio di fondo. */
async function stats(png, {left, top, width, height}) {
  // con il corredo il PNG ha anche il canale alfa (la composizione dell'SVG):
  // senza toglierlo il passo di lettura sarebbe sbagliato e il confronto senza senso
  const {data} = await sharp(png).extract({left, top, width, height}).removeAlpha().raw()
    .toBuffer({resolveWithObject: true});
  let n = 0, light = 0, dark = 0;
  for (let i = 0; i < data.length; i += 3) {
    if (data[i] !== GREY || data[i + 1] !== GREY || data[i + 2] !== GREY) n++;
    if (data[i] > 200) light++;
    if (data[i] < 60) dark++;
  }
  return {n, light, dark};
}

describe('POST /v1/print/map', () => {
  it('senza token risponde 401', async () => {
    const r = await post(app(), lightRequest, null);
    expect(r.status).toBe(401);
  });

  it('con un token sconosciuto risponde 401', async () => {
    const r = await post(app(), lightRequest, 'un-altro-token-qualunque-aaaa');
    expect(r.status).toBe(401);
  });

  it('con token valido risponde image/png', async () => {
    const r = await post(app(), validRequest);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
    const meta = await sharp(r.body).metadata();
    expect([meta.width, meta.height]).toEqual([1748, 2480]);
  });

  it('i campi di corredo tornano negli header anche con mapInfo false', async () => {
    const r = await post(app(), {...validRequest, mapInfo: false});
    expect(r.status).toBe(200);
    // il client di Node rilegge gli header in latin1, quindi il confronto e' sui
    // BYTE: la stringa riletta andata e ritorno si compenserebbe da sola (R15)
    expect(Buffer.from(r.headers['x-wm-attribution'], 'latin1'))
      .toEqual(Buffer.from(ATTRIBUTIONS.join(' · '), 'utf8'));
    expect(Buffer.from(r.headers['x-wm-scale'], 'latin1').toString('utf8')).toMatch(/^1:\d+$/);
    expect(r.headers['x-wm-dpi']).toBe('300');
  });

  // R15 end-to-end: finora `drawMapInfo` aveva solo il suo test di unita'.
  it('con mapInfo acceso il corredo e\' DISEGNATO sulla pagina, con false no', async () => {
    const on = await post(app(), validRequest);
    const off = await post(app(), {...validRequest, mapInfo: false});
    expect(on.status).toBe(200);
    expect(off.status).toBe(200);

    // la barra di scala sta in basso a sinistra, il nord in alto a destra
    const bar = {left: 0, top: 2480 - 300, width: 700, height: 300};
    const north = {left: 1748 - 300, top: 0, width: 300, height: 300};
    const middle = {left: 700, top: 1000, width: 400, height: 400};
    for (const zone of [bar, north]) {
      const a = await stats(on.body, zone);
      expect(a.n).toBeGreaterThan(1000); // riquadro chiaro + inchiostro
      expect(a.light).toBeGreaterThan(0);
      expect(a.dark).toBeGreaterThan(0);
      expect((await stats(off.body, zone)).n).toBe(0);
    }
    // in mezzo alla mappa non si disegna niente, nemmeno con il corredo acceso
    expect((await stats(on.body, middle)).n).toBe(0);
  });

  it('mapInfo acceso e\' il default: ometterlo disegna il corredo', async () => {
    const omitted = await post(app(), validRequest);
    const explicit = await post(app(), {...validRequest, mapInfo: true});
    expect(omitted.body.equals(explicit.body)).toBe(true);
  });

  it('oltre gli slot risponde 503 con Retry-After', async () => {
    let release;
    const hung = () => new Promise(ok => { release = ok; });
    const limits = createLimits({slots: 1});
    const a = app({limits, renderFrame: ({width, height}) => hung().then(() => Buffer.alloc(width * height * 3, GREY))});
    // `.then()` fa PARTIRE la richiesta: una Test di supertest non parte con `.send()`,
    // e senza questo il primo rendering non prende mai lo slot
    const first = post(a, lightRequest).then(r => r);
    await new Promise(ok => setTimeout(ok, 120)); // il primo rendering deve avere preso lo slot
    const r = await post(a, lightRequest);
    expect(r.status).toBe(503);
    expect(r.headers['retry-after']).toBeDefined();
    release();
    expect((await first).status).toBe(200);
    expect(limits.freeSlots()).toBe(1);
  });

  it('un rendering che non finisce libera lo slot e fallisce', async () => {
    const limits = createLimits({renderTimeoutMs: 60});
    const a = app({limits, renderFrame: () => new Promise(() => {})});
    const r = await post(a, lightRequest);
    expect(r.status).toBe(504);
    expect(limits.freeSlots()).toBe(MAX_SLOTS);
  });

  it('oltre il limite al minuto risponde 429 con Retry-After', async () => {
    const a = app({tokens: new Map([[TOKEN, {shard: 'test', rpm: 2}]])});
    expect((await post(a, lightRequest)).status).toBe(200);
    expect((await post(a, lightRequest)).status).toBe(200);
    const r = await post(a, lightRequest);
    expect(r.status).toBe(429);
    expect(r.headers['retry-after']).toBeDefined();
  });

  it('un corpo oltre il tetto risponde 413 dicendo il limite', async () => {
    // una linea di coordinate finte, abbastanza lunga da superare il tetto del corpo
    const n = Math.ceil(MAX_BODY_BYTES / 8);
    const coordinate = Array.from({length: n}, (_, i) => [10 + (i % 1000) / 10000, 44 + (i % 997) / 10000]);
    const huge = {...lightRequest,
      geometry: {type: 'FeatureCollection',
        features: [{type: 'Feature', properties: {}, geometry: {type: 'LineString', coordinates: coordinate}}]}};
    const r = await post(app(), huge);
    expect(r.status).toBe(413);
    expect(r.body.error).toMatch(/dimensione massima/);
  });

  it('uno styleId sconosciuto o un URL sono rifiutati', async () => {
    for (const styleId of ['http://interno/stile.json', '../../etc/passwd', 'inesistente']) {
      const r = await post(app(), {...lightRequest, styleId});
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.body)).not.toContain('interno');
      expect(JSON.stringify(r.body)).not.toContain('passwd');
    }
    expect(Object.keys(STYLE_IDS)).toContain('webmapp');
  });

  it('l\'errore di validazione non contiene le coordinate ricevute', async () => {
    const r = await post(app(), {...lightRequest, geometry: point(999, 999)});
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).not.toContain('999');
  });

  it('una FeatureCollection vuota e\' un errore: non c\'e\' niente da inquadrare', async () => {
    const r = await post(app(), {...lightRequest, geometry: {type: 'FeatureCollection', features: []}});
    expect(r.status).toBe(400);
  });

  it('una bbox che attraversa l\'antimeridiano e\' rifiutata', async () => {
    const attraversa = {type: 'FeatureCollection', features: [{type: 'Feature', properties: {},
      geometry: {type: 'LineString', coordinates: [[179, 10], [-179, 10]]}}]};
    const r = await post(app(), {...lightRequest, geometry: attraversa});
    expect(r.status).toBe(400);
  });

  it('un punto solo produce comunque una pagina (R3)', async () => {
    const r = await post(app(), {...validRequest, geometry: point(10.5, 44.2)});
    expect(r.status).toBe(200);
    expect(r.headers['x-wm-scale']).toMatch(/^1:\d+$/);
  });

  it('stroke e stroke-width fuori range sono rifiutati con 400', async () => {
    const withProps = props => ({type: 'FeatureCollection', features: [{type: 'Feature', properties: props,
      geometry: {type: 'LineString', coordinates: [[10, 44], [10.1, 44.1]]}}]});
    for (const props of [{stroke: 'url(http://interno/x)'}, {stroke: 'rosso; evil'}, {'stroke-width': 1e6},
      {'stroke-width': -2}, {'stroke-width': 'big'}]) {
      const r = await post(app(), {...lightRequest, geometry: withProps(props)});
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.body)).not.toContain('interno');
    }
    // i valori validi passano
    expect((await post(app(), {...lightRequest, geometry: withProps({stroke: '#00ff00', 'stroke-width': 6})})).status).toBe(200);
  });

  it('il formato della pagina e i tetti in pixel sono rifiutati per nome del campo', async () => {
    const cases = [
      [{format: 'a3', orientation: 'portrait', dpi: 300}, /format/],
      [{format: 'a4', orientation: 'diagonale', dpi: 300}, /orientation/],
      [{format: 'a4', orientation: 'portrait', dpi: 5}, /dpi/],
      [{format: 'a4', orientation: 'portrait', dpi: 1200}, /dpi|pixel/],
    ];
    for (const [page, expected] of cases) {
      const r = await post(app(), {...lightRequest, page});
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(expected);
    }
  });

  it('maxZoom e padding fuori dai tetti sono rifiutati', async () => {
    expect((await post(app(), {...lightRequest, maxZoom: 30})).status).toBe(400);
    expect((await post(app(), {...lightRequest, padding: -1})).status).toBe(400);
    expect((await post(app(), {...lightRequest, padding: 99999})).status).toBe(400);
    expect((await post(app(), {...lightRequest, maxZoom: 12})).status).toBe(200);
  });

  it('un campo sconosciuto nel corpo e\' rifiutato (nessun URL entra da una porta laterale)', async () => {
    const r = await post(app(), {...lightRequest, styleUrl: 'http://127.0.0.1:9/interno'});
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).not.toContain('127.0.0.1');
  });

  it('un corpo che non e\' JSON risponde 400, non 500', async () => {
    const r = await request(app()).post('/v1/print/map')
      .set('Authorization', `Bearer ${TOKEN}`)
      .set('Content-Type', 'application/json')
      .send('{non json');
    expect(r.status).toBe(400);
  });

  it('la risposta non si puo\' cachare: le geometrie non restano in giro (R11)', async () => {
    const r = await post(app(), validRequest);
    expect(r.headers['cache-control']).toMatch(/no-store/);
  });

  it('un rendering che fallisce risponde 502 e non un PNG a meta\' (R17)', async () => {
    const limits = createLimits();
    const a = app({limits, renderFrame: () => { throw new Error('maplibre-native: layer mancante'); }});
    const r = await post(a, lightRequest);
    expect(r.status).toBe(502);
    expect(limits.freeSlots()).toBe(MAX_SLOTS);
  });

  it('un frame della dimensione sbagliata e\' un errore, non una pagina storta (R17)', async () => {
    const a = app({renderFrame: ({width, height}) => Buffer.alloc(width * height * 3 - 30, GREY)});
    const r = await post(a, lightRequest);
    expect(r.status).toBe(502);
  });
});

describe('lo stile di stampa', () => {
  /**
   * Le tre decisioni dei task precedenti che si vedono solo guardando lo stile
   * passato al renderer: ordine delle trasformazioni, fattore tipografico,
   * sprite @3x.
   */
  const style = {
    version: 8,
    sprite: 'http://127.0.0.1:1/sprite/v1/webmapp',
    glyphs: 'http://127.0.0.1:1/glyphs/{fontstack}/{range}.pbf',
    sources: {},
    layers: [{id: 'bg', type: 'background', paint: {'background-color': '#fff'}},
      {id: 'contour', type: 'line', source: 'bg', paint: {}}],
  };

  let seen;
  beforeEach(() => { seen = null; });
  const a = () => app({
    getStyle: async () => structuredClone(style),
    renderFrame: async ({style: s, width, height}) => { seen = s; return Buffer.alloc(width * height * 3, GREY); },
  });

  it('lo sprite punta all\'atlas @3x (le icone sono nitide a typeScale 3,2)', async () => {
    expect((await post(a(), lightRequest)).status).toBe(200);
    expect(seen.sprite).toMatch(/@3x$/);
  });

  it('l\'overlay entra PRIMA di adattaStile: il tratto non esce sottile la meta\'', async () => {
    await post(a(), lightRequest);
    const lineLayer = seen.layers.find(l => l.id === 'print-overlay-line');
    expect(lineLayer).toBeDefined();
    // adattaStile moltiplica per 1/PIXEL_RATIO * typeScale = 2 * 3,2 = 6,4
    expect(lineLayer.paint['line-width']).toEqual(['*', 6.4, ['coalesce', ['get', 'stroke-width'], 4]]);
  });

  it('le geometrie arrivano inline nella source, mai come indirizzo (R10)', async () => {
    await post(a(), lightRequest);
    const src = seen.sources['print-overlay'];
    expect(src.type).toBe('geojson');
    expect(typeof src.data).toBe('object');
    expect(src.data.features).toHaveLength(1);
  });

  it('le proprieta\' delle feature si riducono a stroke e stroke-width', async () => {
    const withProps = {type: 'FeatureCollection', features: [{type: 'Feature',
      properties: {stroke: '#112233', 'stroke-width': 3, name: 'Sentiero non pubblicato', id: 42},
      geometry: {type: 'LineString', coordinates: [[10, 44], [10.1, 44.1]]}}]};
    await post(a(), {...lightRequest, geometry: withProps});
    expect(seen.sources['print-overlay'].data.features[0].properties)
      .toEqual({stroke: '#112233', 'stroke-width': 3});
  });
});

describe('la rotta registrata nel server', () => {
  /**
   * Il server vero. La rotta si monta SOLO se `PRINT_TOKENS_PATH` e' impostato:
   * e' cosi' che R6 — il processo che serve le tile non rende pagine — vale per
   * COSTRUZIONE e non per configurazione. La review del Task 10 ha avviato
   * `src/server.js` con la variabile impostata e ha ottenuto un PNG in-process:
   * il processo era capace di rendere, era solo non autenticato.
   */
  it('senza PRINT_TOKENS_PATH la rotta non esiste: 404, non 401', async () => {
    const {createApp} = await import('../src/server.js');
    const prima = process.env.PRINT_TOKENS_PATH;
    delete process.env.PRINT_TOKENS_PATH;
    try {
      const r = await request(createApp()).post('/v1/print/map').send(lightRequest);
      expect(r.status).toBe(404);
    } finally {
      if (prima !== undefined) process.env.PRINT_TOKENS_PATH = prima;
    }
  });

  it('con PRINT_TOKENS_PATH la rotta c\'e\' e senza token valido risponde 401', async () => {
    const {createApp} = await import('../src/server.js');
    const prima = process.env.PRINT_TOKENS_PATH;
    // un percorso che non esiste: `loadTokens` restituisce una mappa vuota, e la
    // rotta risponde 401 a tutti — un deploy senza token e' chiuso, non aperto
    process.env.PRINT_TOKENS_PATH = '/non/esiste/print-tokens.json';
    try {
      const r = await request(createApp()).post('/v1/print/map').send(lightRequest);
      expect(r.status).toBe(401);
    } finally {
      if (prima === undefined) delete process.env.PRINT_TOKENS_PATH;
      else process.env.PRINT_TOKENS_PATH = prima;
    }
  });

  it('il resto del server non ha acquistato un parser del corpo', async () => {
    const {createApp} = await import('../src/server.js');
    const r = await request(createApp()).post('/manifest').send({a: 1});
    expect(r.status).toBe(404);
  });
});

/**
 * Le difformita' trovate dalla review del Task 9, ognuna con la prova che cade
 * se il codice torna com'era.
 */
describe('le difese che la review ha trovato scoperte', () => {
  // ---------------------------------------------------------------- C1: i rendering in volo
  it('alla scadenza i rendering NON si accumulano: oltre il tetto e\' 503, non un altro render', async () => {
    let alive = 0, started = 0;
    const limits = createLimits({slots: 2, renderTimeoutMs: 50});
    const a = app({limits, renderFrame: () => new Promise(() => { started++; alive++; })});

    const codes = [];
    for (let i = 0; i < 8; i++) codes.push((await post(a, lightRequest)).status);

    // i primi due prendono gli slot e scadono; gli altri sei trovano i rendering
    // abbandonati ancora in volo e ricevono 503 senza farne partire di nuovi
    expect(codes.filter(c => c === 504)).toHaveLength(2);
    expect(codes.filter(c => c === 503)).toHaveLength(6);
    expect(alive).toBe(2);
    expect(started).toBe(2);
    expect(limits.inFlight()).toBe(2);
    // lo slot e' libero (R16) ma il posto no: e' la distinzione che mancava
    expect(limits.freeSlots()).toBe(2);
  });

  it('quando il rendering abbandonato rientra, il servizio riprende', async () => {
    let release, calls = 0;
    const limits = createLimits({slots: 1, renderTimeoutMs: 50});
    // il primo rendering resta appeso, i successivi rispondono subito: cosi' il
    // 503 che segue non puo' venire da un secondo rendering appeso
    const a = app({limits, renderFrame: ({width, height}) => {
      const frame = Buffer.alloc(width * height * 3, GREY);
      if (calls++) return Promise.resolve(frame);
      return new Promise(ok => { release = () => ok(frame); });
    }});
    expect((await post(a, lightRequest)).status).toBe(504);
    expect((await post(a, lightRequest)).status).toBe(503);
    release();
    // il rendering rientra quando TUTTO il lavoro e' finito, corredo compreso
    for (let i = 0; i < 100 && limits.inFlight(); i++) await new Promise(ok => setTimeout(ok, 20));
    expect(limits.inFlight()).toBe(0);
    expect((await post(a, lightRequest)).status).toBe(200);
  });

  // ---------------------------------------------------------------- m3: Retry-After del 504
  it('il Retry-After del 504 e\' la costante dichiarata, non il tempo massimo del rendering', async () => {
    const limits = createLimits({renderTimeoutMs: 60});
    const a = app({limits, renderFrame: () => new Promise(() => {})});
    const r = await post(a, lightRequest);
    expect(r.status).toBe(504);
    expect(r.headers['retry-after']).toBe(String(RETRY_AFTER_TIMEOUT_SECONDS));
    expect(r.headers['retry-after']).not.toBe(String(RENDER_TIMEOUT_MS / 1000));
  });

  // ---------------------------------------------------------------- I1: solo i messaggi di validazione
  it('un RangeError della ricorsione non esce come messaggio di validazione', async () => {
    // il corpo si scrive a mano: 20.000 livelli non li serializza nemmeno il
    // client di supertest, mentre `JSON.parse` di Node li legge senza battere ciglio
    const D = 20_000;
    const deep = '['.repeat(D) + '[10.123456,44.123456]' + ']'.repeat(D);
    const rawBody = JSON.stringify(lightRequest).replace(/"geometry":\{[^]*?\}\]\}/,
      `"geometry":{"type":"FeatureCollection","features":[{"type":"Feature","properties":{},`
      + `"geometry":{"type":"LineString","coordinates":${deep}}}]}`);
    const r = await request(app()).post('/v1/print/map')
      .set('Authorization', `Bearer ${TOKEN}`).set('Content-Type', 'application/json').send(rawBody);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/annidato/);
    expect(JSON.stringify(r.body)).not.toMatch(/call stack|RangeError/i);
    expect(JSON.stringify(r.body)).not.toContain('10.123456');
  });

  // ---------------------------------------------------------------- I1.1: il tetto delle coordinate non si aggira
  it('una GeometryCollection e\' 400: le sue coordinate non si contavano', async () => {
    // `countCoordinates` guarda `coordinates`, che una GeometryCollection non
    // ha: le sue geometrie stanno in `geometries`, il conto tornava ZERO e un
    // corpo sotto il tetto di byte passava con 300.000 coordinate. Si rifiuta.
    const molte = Array.from({length: 150_000}, () => [10, 44]);
    const body = {...lightRequest, geometry: {type: 'FeatureCollection', features: [{
      type: 'Feature', properties: {},
      geometry: {type: 'GeometryCollection', geometries: [{type: 'LineString', coordinates: molte}]},
    }]}};
    expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(MAX_BODY_BYTES);
    const r = await post(app(), body);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/GeometryCollection/);
  });

  it('e un tipo di geometria che non esiste e\' 400, non un 500', async () => {
    const r = await post(app(), {...lightRequest, geometry: {type: 'FeatureCollection', features: [{
      type: 'Feature', properties: {}, geometry: {type: 'Circle', coordinates: [10.12, 44.08]}}]}});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/geometry\.features\[0\]\.geometry\.type/);
    expect(JSON.stringify(r.body)).not.toContain('10.12');
  });

  // ---------------------------------------------------------------- I2: byte UTF-8 sul filo
  it('gli header x-wm-* sono UTF-8 nei BYTE letti dal socket', async () => {
    const server = app().listen(0);
    await new Promise(ok => server.once('listening', ok));
    const raw = await new Promise((ok, ko) => {
      const chunks = [];
      const s = net.connect(server.address().port, '127.0.0.1', () => {
        const payload = Buffer.from(JSON.stringify(lightRequest));
        s.write(`POST /v1/print/map HTTP/1.1\r\nHost: 127.0.0.1\r\n`
          + `Authorization: Bearer ${TOKEN}\r\nContent-Type: application/json\r\n`
          + `Content-Length: ${payload.length}\r\nConnection: close\r\n\r\n`);
        s.write(payload);
      });
      s.on('data', c => chunks.push(c));
      s.on('end', () => ok(Buffer.concat(chunks)));
      s.on('error', ko);
    });
    server.close();
    const head = raw.subarray(0, raw.indexOf('\r\n\r\n'));
    // i byte veri dell'attribuzione: © e' C2 A9, · e' C2 B7, due byte ciascuno
    expect(head.includes(Buffer.from(ATTRIBUTIONS.join(' · '), 'utf8'))).toBe(true);
    // e NON i byte di prima: un carattere solo per `©` e `·`, che un job PHP che
    // decodifica UTF-8 legge come due byte malformati
    expect(head.includes(Buffer.from(ATTRIBUTIONS.join(' · '), 'latin1'))).toBe(false);
  });

  // ---------------------------------------------------------------- I3.1: il limite e' PER TOKEN
  it('il limite al minuto e\' per token: esaurito uno, l\'altro passa', async () => {
    const OTHER = 'secondo-token-di-prova-0123456789';
    const a = app({tokens: new Map([[TOKEN, {shard: 'uno', rpm: 1}], [OTHER, {shard: 'due', rpm: 1}]])});
    expect((await post(a, lightRequest)).status).toBe(200);
    expect((await post(a, lightRequest)).status).toBe(429);
    // con un contatore globale questo sarebbe gia' 429: e' il cuore di R8
    expect((await post(a, lightRequest, OTHER)).status).toBe(200);
    expect((await post(a, lightRequest, OTHER)).status).toBe(429);
  });

  // ---------------------------------------------------------------- I3.2: `set` validato
  it('un set non valido e\' 400, e un set valido arriva allo stile', async () => {
    for (const set of ['nope', '0123456789AB', '0123456789abc', '../../etc', 42]) {
      expect((await post(app(), {...lightRequest, set})).status).toBe(400);
    }
    let seenSet = 'mai chiamato';
    const a = app({getStyle: async arg => { seenSet = arg.set; return fakeStyle(); }});
    expect((await post(a, {...lightRequest, set: '0123456789ab'})).status).toBe(200);
    expect(seenSet).toBe('0123456789ab');
  });

  // ---------------------------------------------------------------- I3.3: il tetto del corpo e' QUELLO dichiarato
  it('un corpo oltre i 100 kB di Express ma sotto il tetto dichiarato passa (R9)', async () => {
    const coords = Array.from({length: 12_000}, (_, i) => [10 + (i % 1000) / 100000, 44 + (i % 997) / 100000]);
    const big = {...lightRequest, geometry: {type: 'FeatureCollection',
      features: [{type: 'Feature', properties: {}, geometry: {type: 'LineString', coordinates: coords}}]}};
    const bytes = Buffer.byteLength(JSON.stringify(big));
    expect(bytes).toBeGreaterThan(100 * 1024); // oltre il default di Express
    expect(bytes).toBeLessThan(MAX_BODY_BYTES); // sotto il tetto dichiarato
    expect((await post(app(), big)).status).toBe(200);
  });

  // ---------------------------------------------------------------- I3.4: la mappa degli stili e' CHIUSA
  it('le chiavi del prototipo non sono stili', async () => {
    for (const styleId of ['toString', 'constructor', 'hasOwnProperty', '__proto__', 'valueOf']) {
      const r = await post(app(), {...lightRequest, styleId});
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/styleId/);
    }
  });

  // ---------------------------------------------------------------- I3.5 + m1: nemmeno i log
  it('il log di un 400 non contiene coordinate, e la risposta non ripete il campo ricevuto', async () => {
    const lines = [];
    const spies = [vi.spyOn(console, 'log').mockImplementation(m => lines.push(m)),
      vi.spyOn(console, 'error').mockImplementation(m => lines.push(m))];
    try {
      // 1. una geometria fuori dal mondo: le coordinate non devono finire nel log
      const r1 = await post(app(), {...lightRequest, geometry: point(999.123456, 88.654321)});
      expect(r1.status).toBe(400);
      // 2. un campo sconosciuto la cui CHIAVE e' essa stessa un dato
      const r2 = await post(app(), {...lightRequest, '44.123456,10.654321': 1});
      expect(r2.status).toBe(400);
      expect(r2.body.error).toMatch(/ammessi/);
      expect(JSON.stringify(r2.body)).not.toContain('44.123456');
    } finally {
      for (const s of spies) s.mockRestore();
    }
    const log = lines.join('\n');
    expect(log).not.toContain('999.123456');
    expect(log).not.toContain('88.654321');
    expect(log).not.toContain('44.123456');
    expect(log).not.toContain('10.654321');
    // il log c'e' comunque: dice CHI ha chiamato, non cosa conteneva la richiesta
    expect(log).toContain('richiesta rifiutata');
    expect(log).toContain('"shard":"test"');
  });

  // ---------------------------------------------------------------- m2: lo schema e' case-insensitive
  it('lo schema Bearer si confronta senza guardare le maiuscole (RFC 9110)', async () => {
    for (const scheme of ['bearer', 'BEARER', 'BeArEr']) {
      const r = await request(app()).post('/v1/print/map')
        .set('Authorization', `${scheme} ${TOKEN}`).send(lightRequest);
      expect(r.status).toBe(200);
    }
  });
});
