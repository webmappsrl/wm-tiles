import express from 'express';
import request from 'supertest';
import {describe, expect, it} from 'vitest';
import {printRouter, STYLE_IDS} from '../src/print/route.js';
import {openapi, unmappedErrors} from '../src/print/schema.js';
import {PAGE_FORMATS} from '../src/print/formats.js';
import {
  DEFAULT_MAX_ZOOM, DEFAULT_PADDING_MM, DEFAULT_RPM, MAX_BODY_BYTES, MAX_COORDINATES, MAX_DPI,
  MAX_FEATURES, MAX_PIXELS, MAX_SIDE, MAX_SLOTS, MAX_STROKE_WIDTH, MAX_ZOOM, MIN_DPI,
  RATE_WINDOW_MS, RENDER_TIMEOUT_MS, RETRY_AFTER_SECONDS, RETRY_AFTER_TIMEOUT_SECONDS,
} from '../src/print/limits.js';
import {MIN_TOKEN_LENGTH} from '../src/print/tokens.js';

/**
 * Lo schema OpenAPI e' la validazione, non una sua descrizione (Task 12): questi
 * test cadono se le due cose si scostano.
 *
 * Non verificano che il documento sia scritto bene — lo verificherebbe un
 * validatore qualunque — ma che **il servizio si comporti come il documento
 * dichiara**, perche' il documento e' cio' che si manda allo shard di oc:8982 al
 * posto di una sezione di prosa. Ogni vincolo dichiarato nello schema viene
 * violato apposta e deve dare `400`; ogni valore che lo schema dichiara ammesso
 * deve dare `200`; e nessun messaggio di Ajv — che contiene i valori ricevuti —
 * deve arrivare al chiamante (R11).
 */

const TOKEN = 'token-di-prova-0123456789abcdef';
const GREY = 128;

function app() {
  const a = express();
  a.use('/v1/print', printRouter({
    tokens: new Map([[TOKEN, {shard: 'test', rpm: 100_000}]]),
    renderFrame: async ({width, height}) => Buffer.alloc(width * height * 3, GREY),
    getStyle: async () => ({version: 8, sources: {},
      layers: [{id: 'bg', type: 'background', paint: {'background-color': '#ffffff'}}]}),
    shadeFactory: null,
  }));
  return a;
}

const post = (body, a = app()) => request(a).post('/v1/print/map')
  .set('Authorization', `Bearer ${TOKEN}`).send(body);

/** Il corpo minimo valido, piccolo: la pagina si rende in pochi millisecondi. */
const valid = () => ({
  geometry: {type: 'FeatureCollection', features: [{type: 'Feature', properties: {},
    geometry: {type: 'LineString', coordinates: [[10.0, 44.0], [10.12, 44.08]]}}]},
  page: {format: 'a5', orientation: 'portrait', dpi: 72},
});

/** Un corpo valido con una sola feature, a cui cambiare le `properties`. */
const withProps = props => {
  const b = valid();
  b.geometry.features[0].properties = props;
  return b;
};

/** Coordinate annidate n livelli: `[[[...[10, 44]...]]]`. */
const nested = n => {
  let c = [10, 44];
  for (let i = 1; i < n; i++) c = [c];
  return c;
};

const req = openapi.components.schemas.PrintMapRequest;
const page = openapi.components.schemas.Page;
const props = openapi.components.schemas.FeatureProperties;
const limiti = openapi['x-wm-limits'];

describe('il documento OpenAPI', () => {
  it('dichiara l\'operazione, i codici di risposta veri e il Retry-After dove c\'e\'', () => {
    const op = openapi.paths['/v1/print/map'].post;
    expect(op.operationId).toBe('printMap');
    expect(Object.keys(op.responses)).toEqual(
      expect.arrayContaining(['200', '400', '401', '413', '429', '502', '503', '504']));
    for (const code of ['429', '503', '504']) {
      expect(op.responses[code].headers['Retry-After'], code).toBeDefined();
      expect(op.responses[code].headers['Retry-After'].required, code).toBe(true);
    }
    // il 200 e' un PNG, non un JSON con dentro un'immagine
    expect(Object.keys(op.responses['200'].content)).toEqual(['image/png']);
    for (const h of ['x-wm-scale', 'x-wm-dpi', 'x-wm-attribution']) {
      expect(op.responses['200'].headers[h], h).toBeDefined();
    }
    // ogni operazione ha un operationId: e' cio' che un generatore di client usa
    // per dare il nome al metodo, e due operazioni senza nome diventano due
    // metodi con lo stesso nome
    for (const [p, item] of Object.entries(openapi.paths)) {
      for (const [verbo, o] of Object.entries(item)) expect(o.operationId, `${verbo} ${p}`).toBeTruthy();
    }
  });

  it('non contiene nessun token plausibile: il repo e\' pubblico', () => {
    const testo = JSON.stringify(openapi);
    // niente valore di esempio per l'Authorization, e nessuna stringa lunga che
    // somigli a un segreto (un esempio plausibile prima o poi viene copiato da
    // qualcuno che lo crede valido)
    expect(testo).not.toMatch(/Bearer\s+[A-Za-z0-9_-]{8,}/);
    expect(JSON.stringify(openapi.components.securitySchemes)).not.toMatch(/[A-Fa-f0-9]{24,}/);
    const sospette = (testo.match(/"[A-Za-z0-9+/_-]{24,}"/g) ?? [])
      .filter(s => !/^"(?:[a-z]+:)?\/\//.test(s)) // gli URL non sono segreti
      .filter(s => /\d/.test(s));                   // ne' i nomi dei campi, che non hanno cifre
    expect(sospette).toEqual([]);
  });

  it('e i suoi esempi di richiesta sono accettati dal servizio', async () => {
    const esempi = openapi.paths['/v1/print/map'].post.requestBody.content['application/json'].examples;
    expect(Object.keys(esempi).length).toBeGreaterThan(0);
    for (const [nome, {value}] of Object.entries(esempi)) {
      const r = await post(value);
      expect(r.status, `${nome}: ${JSON.stringify(r.body)}`).toBe(200);
    }
  });
});

describe('i numeri del servizio vengono dallo schema', () => {
  it('ogni tetto del codice e\' quello dichiarato nel documento', () => {
    // I VALORI SONO SCRITTI A MANO di proposito. Confrontare la costante con la
    // stessa espressione che il codice usa per leggerla e' una tautologia: la
    // review del 24 novembre 2026 ha tolto `maxItems: 500` dal documento e ha
    // visto 75 test verdi mentre una richiesta con 600 feature passava, perche'
    // `undefined === undefined`. Questi numeri sono il contratto: se cambiano
    // nel documento devono cambiare anche qui, e la modifica si vede in diff.
    expect(MAX_BODY_BYTES).toBe(2 * 1024 * 1024);
    expect(MAX_PIXELS).toBe(12_000_000);
    expect(MAX_SIDE).toBe(6000);
    expect(MAX_COORDINATES).toBe(100_000);
    expect(DEFAULT_PADDING_MM).toBe(8);
    expect(MAX_SLOTS).toBe(2);
    expect(RENDER_TIMEOUT_MS).toBe(120_000);
    expect(RETRY_AFTER_SECONDS).toBe(30);
    expect(RETRY_AFTER_TIMEOUT_SECONDS).toBe(60);
    expect(DEFAULT_RPM).toBe(30);
    expect(RATE_WINDOW_MS).toBe(60_000);
    expect(MIN_DPI).toBe(72);
    expect(MAX_DPI).toBe(600);
    expect(MAX_FEATURES).toBe(500);
    expect(MAX_ZOOM).toBe(19);
    expect(DEFAULT_MAX_ZOOM).toBe(16);
    expect(MAX_STROKE_WIDTH).toBe(40);
    expect(MIN_TOKEN_LENGTH).toBe(24);
    // e il documento deve dichiarare gli stessi: e' l'altra meta' del contratto
    expect(limiti.maxBodyBytes).toBe(MAX_BODY_BYTES);
    expect(page.properties.dpi.minimum).toBe(MIN_DPI);
    expect(page.properties.dpi.maximum).toBe(MAX_DPI);
    expect(openapi.components.schemas.FeatureCollection.properties.features.maxItems).toBe(MAX_FEATURES);
    expect(req.properties.maxZoom.maximum).toBe(MAX_ZOOM);
    expect(props.properties['stroke-width'].maximum).toBe(MAX_STROKE_WIDTH);
    expect(openapi.components.securitySchemes.shardToken['x-wm-min-token-length']).toBe(MIN_TOKEN_LENGTH);
    for (const [k, v] of Object.entries(limiti)) expect(Number.isFinite(v), k).toBe(true);
  });

  it('il valore di serie di styleId e\' dichiarato e ammesso', () => {
    // senza, una richiesta che omette styleId — il secondo esempio del documento —
    // chiede uno stile inesistente e finisce in 502
    expect(req.properties.styleId.default).toBe('webmapp');
    expect(req.properties.styleId.enum).toContain(req.properties.styleId.default);
  });

  it('le mappe chiuse del codice sono quelle dichiarate', () => {
    expect(Object.keys(STYLE_IDS).sort()).toEqual([...req.properties.styleId.enum].sort());
    expect(Object.keys(PAGE_FORMATS).sort()).toEqual([...page.properties.format.enum].sort());
  });

  it('la catena della profondita\' e\' lunga quanto il numero dichiarato', () => {
    const livelli = Object.keys(openapi.components.schemas)
      .filter(k => /^CoordinatesDepth\d+$/.test(k));
    expect(livelli).toHaveLength(limiti.maxCoordDepth);
    // l'ultimo livello e' quello che CHIUDE: i suoi elementi non possono essere array
    const ultimo = openapi.components.schemas[`CoordinatesDepth${limiti.maxCoordDepth}`];
    expect(ultimo.items).toEqual({not: {type: 'array'}});
  });
});

describe('il comportamento coincide con lo schema', () => {
  it('un valore oltre ogni vincolo dichiarato e\' 400, e il valore dentro e\' 200', async () => {
    const fuori = [
      ['dpi sotto il minimo', {...valid(), page: {...valid().page, dpi: MIN_DPI - 1}}, /dpi/],
      ['dpi sopra il massimo', {...valid(), page: {...valid().page, dpi: MAX_DPI + 1}}, /dpi/],
      ['dpi non intero', {...valid(), page: {...valid().page, dpi: 150.5}}, /dpi/],
      ['maxZoom sopra il massimo', {...valid(), maxZoom: MAX_ZOOM + 1}, /maxZoom/],
      ['maxZoom negativo', {...valid(), maxZoom: -1}, /maxZoom/],
      ['padding negativo', {...valid(), padding: -1}, /padding/],
      ['set piu' + ' corto', {...valid(), set: '0123456789a'}, /set/],
      ['set con maiuscole', {...valid(), set: '0123456789AB'}, /set/],
      ['styleId fuori dall\'elenco', {...valid(), styleId: 'nessuno'}, /styleId/],
      ['format fuori dall\'elenco', {...valid(), page: {...valid().page, format: 'a3'}}, /format/],
      ['orientation fuori dall\'elenco', {...valid(), page: {...valid().page, orientation: 'obliquo'}},
        /orientation/],
      ['mapInfo non booleano', {...valid(), mapInfo: 'si'}, /mapInfo/],
      ['campo sconosciuto nel corpo', {...valid(), styleUrl: 'http://127.0.0.1:9/x'}, /ammessi/],
      ['campo sconosciuto in page', {...valid(), page: {...valid().page, margine: 1}}, /page/],
      ['geometry assente', {page: valid().page}, /geometry/],
      ['page assente', {geometry: valid().geometry}, /page/],
      ['stroke non esadecimale', withProps({stroke: 'rosso'}), /stroke/],
      ['stroke-width oltre il massimo', withProps({'stroke-width': MAX_STROKE_WIDTH + 1}), /stroke-width/],
      ['stroke-width a zero', withProps({'stroke-width': 0}), /stroke-width/],
      ['nessuna feature', {...valid(), geometry: {type: 'FeatureCollection', features: []}}, /features/],
      ['tipo di geometria inesistente', {...valid(), geometry: {type: 'FeatureCollection',
        features: [{type: 'Feature', properties: {}, geometry: {type: 'Circle', coordinates: [10, 44]}}]}},
      /geometry\.features\[0\]\.geometry\.type/],
      ['GeometryCollection', {...valid(), geometry: {type: 'FeatureCollection',
        features: [{type: 'Feature', properties: {}, geometry: {type: 'GeometryCollection',
          geometries: [{type: 'Point', coordinates: [10, 44]}]}}]}}, /GeometryCollection/],
      ['coordinate oltre la profondita\'', {...valid(), geometry: {type: 'FeatureCollection',
        features: [{type: 'Feature', properties: {},
          geometry: {type: 'MultiPolygon', coordinates: nested(limiti.maxCoordDepth + 1)}}]}},
      /annidato oltre 8 livelli/],
      ['feature senza geometria', {...valid(), geometry: {type: 'FeatureCollection',
        features: [{type: 'Feature', properties: {}}]}}, /geometry\.features\[0\]/],
      ['feature che non e\' una Feature', {...valid(), geometry: {type: 'FeatureCollection',
        features: [{type: 'Punto', geometry: {type: 'Point', coordinates: [10, 44]}}]}},
      /geometry\.features\[0\]/],
      ['properties che non e\' un oggetto', withProps(['#fff']), /properties/],
      ['geometry che non e\' una FeatureCollection', {...valid(),
        geometry: {type: 'LineString', coordinates: [[10, 44], [10.1, 44.1]]}}, /geometry/],
      // 501 e' scritto a mano: con `MAX_FEATURES + 1`, se il tetto sparisse dallo
      // schema `MAX_FEATURES` sarebbe `undefined`, `{length: NaN}` darebbe un array
      // VUOTO e il 400 arriverebbe da `minItems` — il test passerebbe senza tetto.
      // Il messaggio atteso nomina il massimo, cosi' il 400 giusto non si confonde
      // con quello della collection vuota.
      ['troppe feature', {...valid(), geometry: {type: 'FeatureCollection',
        features: Array.from({length: 501}, () => ({type: 'Feature', properties: {},
          geometry: {type: 'Point', coordinates: [10, 44]}}))}}, /massimo di 500 feature/],
    ];
    const a = app();
    for (const [why, body, atteso] of fuori) {
      const r = await post(body, a);
      expect(r.status, why).toBe(400);
      expect(r.body.error, why).toMatch(atteso);
    }

    const dentro = [
      ['dpi al minimo', {...valid(), page: {...valid().page, dpi: MIN_DPI}}],
      ['maxZoom al massimo', {...valid(), maxZoom: MAX_ZOOM}],
      ['maxZoom a zero', {...valid(), maxZoom: 0}],
      ['padding a zero', {...valid(), padding: 0}],
      ['set di 12 cifre esadecimali', {...valid(), set: '0123456789ab'}],
      ['stroke-width al massimo', withProps({'stroke-width': MAX_STROKE_WIDTH})],
      ['stroke a tre cifre', withProps({stroke: '#ABC'})],
      ['stroke e stroke-width a null', withProps({stroke: null, 'stroke-width': null})],
      ['properties assenti', {...valid(), geometry: {type: 'FeatureCollection',
        features: [{type: 'Feature', geometry: {type: 'Point', coordinates: [10, 44]}}]}}],
      ['properties con campi che verranno buttati', withProps({nome: 'Sentiero', id: 7})],
      ...req.properties.styleId.enum.map(v => [`styleId ${v}`, {...valid(), styleId: v}]),
      ...page.properties.format.enum.flatMap(format => page.properties.orientation.enum
        .map(orientation => [`${format} ${orientation}`,
          {...valid(), page: {format, orientation, dpi: MIN_DPI}}])),
    ];
    for (const [why, body] of dentro) {
      const r = await post(body, a);
      expect(r.status, `${why}: ${JSON.stringify(r.body)}`).toBe(200);
    }
  });

  it('nessun errore di validazione resta senza traduzione', () => {
    // `schema.js` conta gli errori di Ajv per cui non ha un messaggio: li' il
    // messaggio nomina solo il campo, il che e' corretto ma significa che una
    // regola dello schema e' stata aggiunta senza dirla in italiano. Le
    // violazioni le ha appena fatte tutte il test qui sopra.
    expect(unmappedErrors()).toBe(0);
  });

  it('i messaggi non sono quelli di Ajv: non riportano i dati ricevuti (R11)', async () => {
    const cattivi = [
      {...valid(), styleId: 'http://169.254.169.254/latest/meta-data/'},
      {...valid(), set: 'http://127.0.0.1:8080/'},
      {...valid(), '44.123456,10.654321': 1},
      {...valid(), page: {...valid().page, dpi: 4242}},
      withProps({stroke: 'url(http://interno/x)'}),
    ];
    const a = app();
    for (const body of cattivi) {
      const {error} = (await post(body, a)).body;
      // le forme tipiche di Ajv: «must be ...», il percorso con le barre
      expect(error).not.toMatch(/must (be|have|match|NOT)|data\//);
      expect(error).not.toMatch(/\//);
      for (const v of ['169.254.169.254', '127.0.0.1', '44.123456', '10.654321', '4242', 'interno']) {
        expect(error, v).not.toContain(v);
      }
    }
  });

  it('la regola che lo schema NON puo\' esprimere e\' vera: il dpi massimo non basta', async () => {
    // il documento dichiara `dpi` fino a 600 e dice, in `x-wm-regole-aggiuntive`,
    // che il tetto vero e' il numero di pixel della pagina. Se cosi' non fosse,
    // lo shard taglierebbe le pagine sul numero sbagliato
    const r = await post({...valid(), page: {format: 'a5', orientation: 'portrait', dpi: MAX_DPI}});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/pixel/);
    expect(openapi['x-wm-regole-aggiuntive'].map(x => x.id)).toEqual(
      expect.arrayContaining(['coordinate', 'pagina', 'inquadratura']));
  });

  it('e il totale delle coordinate, che e\' una somma su tutte le feature', async () => {
    const perFeature = Math.ceil((MAX_COORDINATES + 10) / 2);
    const traccia = () => ({type: 'Feature', properties: {}, geometry: {type: 'LineString',
      coordinates: Array.from({length: perFeature}, () => [10, 44])}});
    const r = await post({...valid(),
      geometry: {type: 'FeatureCollection', features: [traccia(), traccia()]}});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(new RegExp(`${MAX_COORDINATES} coordinate`));
  });
});

describe('lo schema servito dal servizio', () => {
  it('e\' lo stesso file del repo, senza token, e si prende senza autenticarsi', async () => {
    const r = await request(app()).get('/v1/print/openapi.json');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/application\/json/);
    expect(r.headers['cache-control']).toMatch(/no-cache/);
    expect(r.body).toEqual(openapi);
  });

  it('e la pagina di lettura non porta dipendenze nel runtime', async () => {
    const r = await request(app()).get('/v1/print/docs');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/html/);
    // il documento si chiede per percorso relativo: la pagina funziona ovunque
    // sia montato il router
    expect(r.text).toContain('spec-url="openapi.json"');
    // Redoc arriva da CDN, con una versione ESATTA: non e' in package.json
    expect(r.text).toMatch(/redoc@\d+\.\d+\.\d+\//);
    const {dependencies} = JSON.parse(
      await import('node:fs').then(fs => fs.promises.readFile('package.json', 'utf8')));
    expect(Object.keys(dependencies)).not.toContain('redoc');
    expect(Object.keys(dependencies)).not.toContain('swagger-ui-dist');
    // e Ajv, che la validazione usa davvero, e' fissato a una versione esatta
    expect(dependencies.ajv).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
