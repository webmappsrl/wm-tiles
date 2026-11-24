/**
 * `POST /v1/print/map`: la prima rotta in SCRITTURA di wm-tiles (R1).
 *
 * Riceve dallo shard una `FeatureCollection`, il formato della pagina e lo
 * stile; calcola l'inquadratura, disegna la pagina con maplibre-native e
 * risponde con un PNG. Il chiamante e' un job Horizon: non c'e' nessuna coda
 * qui dentro, chi trova il servizio pieno riceve `503` e riprova (R7).
 *
 * Le difese, una per requisito:
 * - R8: un token per shard nell'`Authorization`, e il limite al minuto PER
 *   TOKEN (Caddy su quell'host non ha il modulo `rate_limit`).
 * - R9: tutti i tetti sono numeri dichiarati in `limits.js`, compreso quello del
 *   corpo — `express.json` senza `limit` userebbe i 100 kB di serie, che una
 *   mappa d'insieme supera.
 * - R10: lo stile si sceglie per IDENTIFICATIVO, su una mappa chiusa. Nessun
 *   campo della richiesta accetta un URL, e i campi sconosciuti si rifiutano:
 *   un indirizzo accettato qui sarebbe SSRF verso la rete interna dell'host.
 *   La forma del corpo la decide lo SCHEMA (`openapi.json` via `schema.js`), che
 *   e' anche il documento che si manda a chi scrive lo shard: una regola scritta
 *   due volte, una nel codice e una nella documentazione, diverge.
 * - R11: niente geometrie nei log, nelle cache e nei messaggi d'errore. Un
 *   errore nomina il CAMPO, mai il suo contenuto; delle feature si tengono solo
 *   `stroke` e `stroke-width`, cosi' nemmeno i nomi dei sentieri entrano nel
 *   processo; la risposta e' `no-store`.
 * - R16: ogni rendering ha un tempo massimo e lo slot si libera comunque. Alla
 *   scadenza il rendering pero' CONTINUA, e `limits` lo conta a parte: finche'
 *   quelli abbandonati non rientrano si risponde 503, perche' farne partire altri
 *   sopra sarebbe il processo ucciso dal tetto di memoria, non un 503.
 * - R17: una pagina incompleta e' un errore. `renderFrame` rifiuta se
 *   maplibre-native ha segnalato qualcosa, e qui si controlla anche che il
 *   frame abbia esattamente i pixel della pagina.
 *
 * Le dipendenze si iniettano (`printRouter(deps)`) perche' il rendering vero
 * vuole il modulo nativo e il server acceso: i test esercitano la rotta, i
 * tetti e il corredo senza di essi.
 */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import express from 'express';
import sharp from 'sharp';
import {fitBounds} from './fit.js';
import {pageSize} from './formats.js';
import {drawMapInfo, mapInfoFields} from './map-info.js';
import {addOverlay} from './overlay.js';
import {
  DEFAULT_MAX_ZOOM, DEFAULT_PADDING_MM, DEFAULT_RPM, MAX_BODY_BYTES, MAX_COORDINATES,
  MAX_PIXELS, MAX_SIDE, RETRY_AFTER_TIMEOUT_SECONDS, RateLimitError, RenderTimeoutError,
  SlotsBusyError, createLimits,
} from './limits.js';
import {
  BadRequestError, COORD_DEPTH, openapi, STYLE_ID_VALUES, validateBody,
} from './schema.js';
import {adattaStile, PIXEL_RATIO, localizza} from '../raster/stile-nativo.js';
import {decodificaTerrarium, fasciaDi, grigi, PIXEL_Z0, quoteVista} from '../raster/ombra.js';

/**
 * Gli stili che si possono chiedere, per nome. E' una mappa CHIUSA: tutto cio'
 * che non e' una sua chiave e' `400`, URL e percorsi compresi (R10). Il valore
 * e' un percorso del server stesso, non un indirizzo che arriva da fuori.
 */
export const STYLE_IDS = {webmapp: '/style-openlayers.json'};

// lo schema dichiara allo shard QUALI nomi esistono e la rotta li risolve: se le
// due parti si scostano, il codice si ferma qui e non a richiesta ricevuta — un
// nome documentato e non risolvibile sarebbe un 500 per chi lo usa
if (Object.keys(STYLE_IDS).join() !== [...STYLE_ID_VALUES].sort().join()) {
  throw new Error('gli stili di route.js e quelli di openapi.json non coincidono');
}

/**
 * Il fattore tipografico della stampa, a pixel ratio 0,5 (Task 7): porta il
 * testo piu' piccolo a 2,53 mm di corpo, sopra i 2,5 mm richiesti da R5.
 * Dipende dal ratio: a ratio 1 l'equivalente sarebbe 1,6, ma a ratio 1
 * maplibre-native carica le tile di un livello piu' basso e la pagina perde i
 * nomi di localita', corsi d'acqua, strade minori e sentieri.
 */
export const TYPE_SCALE = 3.2;

/**
 * Esegue la validazione di un ALTRO modulo (`formats.js`, `fit.js`), che nomina
 * il campo ma lancia `Error` semplici, e la riporta dentro `BadRequestError`.
 * Un `RangeError` o un `TypeError` non sono messaggi di validazione e passano
 * oltre: diventano un 500, non un 400 che riporta un difetto interno.
 */
function asBadRequest(fn, prefix = '') {
  try {
    return fn();
  } catch (e) {
    if (e instanceof BadRequestError) throw e;
    if (e?.constructor === Error) throw new BadRequestError(`${prefix}${e.message}`);
    throw e;
  }
}

/** Header con caratteri non ASCII: sul filo devono essere i BYTE UTF-8. */
const headerUtf8 = v => Buffer.from(v, 'utf8').toString('latin1');

const log = (level, msg, fields = {}) => {
  const line = JSON.stringify({ts: new Date().toISOString(), level, msg, ...fields});
  if (level === 'error') console.error(line);
  else console.log(line);
};

// ------------------------------------------------------------------ validazione

// Il tetto di profondita' delle coordinate NON si dichiara qui: e' `COORD_DEPTH`,
// cioe' la lunghezza della catena `CoordinatesDepth*` dello schema. Un
// MultiPolygon ne usa 4 livelli, oltre non c'e' geometria GeoJSON; senza quel
// tetto una lista di 20.000 livelli faceva esplodere la ricorsione e il
// `RangeError` usciva come messaggio di validazione.

/**
 * Quante coordinate porta una geometria, senza costruirne la lista. Il totale
 * sulla collection e' l'unico tetto che JSON Schema non esprime (e' una somma su
 * tutte le feature), quindi resta qui: lo schema lo dichiara in
 * `x-wm-regole-aggiuntive`.
 *
 * La profondita' la vincola lo SCHEMA (catena `CoordinatesDepth1..8`), e senza
 * quel tetto una lista di 20.000 livelli faceva esplodere la ricorsione. Il
 * controllo qui resta come seconda serratura: se un giorno la catena dello
 * schema si accorciasse, questa funzione non diventerebbe un `RangeError` che
 * esce come messaggio di validazione.
 */
function countCoordinates(c, i, depth = 1) {
  if (!Array.isArray(c)) return 0;
  if (depth > COORD_DEPTH) {
    throw new BadRequestError(`geometry.features[${i}].geometry.coordinates e' annidato oltre ${COORD_DEPTH} livelli`);
  }
  if (typeof c[0] === 'number') return 1;
  let n = 0;
  for (const x of c) n += countCoordinates(x, i, depth + 1);
  return n;
}

/**
 * Le proprieta' di una feature ridotte a quelle che l'overlay usa davvero
 * (simplestyle-spec). Lo schema ha gia' detto che `stroke` e' esadecimale e che
 * `stroke-width` sta nella scala: qui si BUTTA VIA tutto il resto — nomi, id,
 * descrizioni di sentieri non pubblicati — che non ha motivo di entrare nel
 * processo (R11). Un `null` vale come assente, come prima.
 */
function cleanProperties(props) {
  const out = {};
  if (!props) return out;
  if (props.stroke !== null && props.stroke !== undefined) out.stroke = props.stroke;
  const w = props['stroke-width'];
  if (w !== null && w !== undefined) out['stroke-width'] = w;
  return out;
}

/**
 * La FeatureCollection ripulita. La FORMA l'ha gia' verificata lo schema; qui
 * restano le due cose che non sa fare: contare le coordinate di tutte le feature
 * insieme e togliere le proprieta' che non ci riguardano. Le coordinate come
 * numeri le valida `fitBounds`.
 */
function cleanGeometry(geometry) {
  let coords = 0;
  const features = geometry.features.map((f, i) => {
    coords += countCoordinates(f.geometry.coordinates, i);
    return {type: 'Feature', properties: cleanProperties(f.properties), geometry: f.geometry};
  });
  if (coords > MAX_COORDINATES) {
    throw new BadRequestError(`geometry supera il massimo di ${MAX_COORDINATES} coordinate`);
  }
  return {type: 'FeatureCollection', features};
}

/**
 * La richiesta validata, con i valori predefiniti gia' applicati.
 *
 * **La validazione vera e' lo schema OpenAPI** (`openapi.json`, compilato in
 * `schema.js`): campi ammessi, tipi, enumerazioni, intervalli e profondita'
 * stanno li' e non qui. Quello che resta e' cio' che JSON Schema non puo' dire —
 * i tetti CALCOLATI (i pixel della pagina dipendono da formato, orientamento e
 * dpi insieme; il totale delle coordinate e' una somma su tutte le feature; il
 * padding si misura contro il lato corto) — piu' i valori di serie, che non si
 * lasciano applicare a Ajv apposta: `parseRequest` deve distinguere un campo
 * assente da un campo uguale al suo default, e `padding` il suo default lo
 * ricava dal dpi.
 */
export function parseRequest(body) {
  // `express.json` in modo strict rifiuta gia' un corpo scalare, ma `fakePrint`
  // chiama questa funzione direttamente: il messaggio deve essere lo stesso
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestError('il corpo deve essere un oggetto JSON');
  }
  validateBody(body);

  const geometry = cleanGeometry(body.geometry);

  const page = body.page;
  const dpi = page.dpi;
  // i messaggi di `pageSize` nominano gia' il campo e non il valore
  const size = asBadRequest(() => pageSize({format: page.format, orientation: page.orientation, dpi}), 'page.');
  if (size.width > MAX_SIDE || size.height > MAX_SIDE) {
    throw new BadRequestError(`la pagina supera il lato massimo di ${MAX_SIDE} pixel: scegli un dpi piu' basso`);
  }
  if (size.width * size.height > MAX_PIXELS) {
    throw new BadRequestError(`la pagina supera il massimo di ${MAX_PIXELS} pixel: scegli un dpi piu' basso`);
  }

  const styleId = body.styleId ?? openapi.components.schemas.PrintMapRequest.properties.styleId.default;
  const set = body.set;

  const padding = body.padding ?? Math.round((DEFAULT_PADDING_MM * dpi) / 25.4);
  if (padding * 2 >= Math.min(size.width, size.height)) {
    throw new BadRequestError('padding troppo grande per la pagina: non resta area utile');
  }

  const maxZoom = body.maxZoom ?? DEFAULT_MAX_ZOOM;
  const mapInfo = body.mapInfo ?? true; // acceso quando non viene passato (R15)

  return {geometry, ...size, dpi, format: page.format, orientation: page.orientation,
    styleId, set, padding, maxZoom, mapInfo};
}

// ------------------------------------------------------------------ lo stile e l'ombra

/** Lo stile del server, riscritto verso l'indirizzo locale (niente CDN per il renderer). */
const fetchStyle = baseUrl => async ({styleId, set}) => {
  const url = `${baseUrl}${STYLE_IDS[styleId]}${set ? `?set=${set}` : ''}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`lo stile non e' disponibile: ${r.status}`);
  return localizza(await r.json(), baseUrl);
};

/**
 * L'ombreggiatura della pagina, con le stesse formule dei PNG delle tile
 * (`src/raster/ombra.js`, parametri da `metadata['wm:hillshade']`).
 *
 * Differenza con `pipeline/render-png.mjs`: li' lo zoom e' intero, qui esce da
 * `fitBounds` ed e' frazionario. Il livello della fascia si sceglie come nella
 * preview (`livelloDi`, N - 0,585) e il gradiente si misura su un numero INTERO
 * di pixel della vista (`passi`), perche' `grigi` usa quel valore come scarto
 * di indice: il divisore e' quindi la distanza vera in metri fra i campioni.
 *
 * Nota: e' la terza copia di questo mosaico (render-png.mjs, page-cost.mjs,
 * qui). Estrarla tocca lo script che produce i PNG di produzione, garantiti
 * identici byte per byte: non si fa dentro questo task.
 */
export function demShade(style) {
  const terrain = style.sources?.terrain;
  const bands = style.metadata?.['wm:hillshade']?.fasce ?? [];
  const hasContour = style.layers.some(l => l.id.startsWith('contour'));
  if (!terrain?.tiles?.length || !bands.length || !hasContour) return null;
  const demMin = terrain.minzoom ?? 8;
  const demMax = terrain.maxzoom ?? 16;

  const tile = async (z, x, y) => {
    const r = await fetch(terrain.tiles[0].replace('{z}', z).replace('{x}', x).replace('{y}', y));
    // fuori copertura quota 0, come la preview: il bordo dell'area non diventa un muro
    if (r.status !== 200) return new Float32Array(256 * 256);
    const {data, info} = await sharp(Buffer.from(await r.arrayBuffer())).raw().toBuffer({resolveWithObject: true});
    return decodificaTerrarium(data, info.channels);
  };

  async function mosaic(zd, u0, v0, Wd, Hd) {
    const D = new Float32Array(Wd * Hd), k = 2 ** zd, jobs = [];
    for (let ty = Math.floor(v0 / 256); ty <= Math.floor((v0 + Hd - 1) / 256); ty++) {
      for (let tx = Math.floor(u0 / 256); tx <= Math.floor((u0 + Wd - 1) / 256); tx++) {
        if (tx < 0 || ty < 0 || tx >= k || ty >= k) continue;
        jobs.push(tile(zd, tx, ty).then(q => {
          for (let r = 0; r < 256; r++) {
            const dr = ty * 256 + r - v0;
            if (dr < 0 || dr >= Hd) continue;
            for (let c = 0; c < 256; c++) {
              const dc = tx * 256 + c - u0;
              if (dc >= 0 && dc < Wd) D[dr * Wd + dc] = q[r * 256 + c];
            }
          }
        }));
      }
    }
    await Promise.all(jobs);
    return D;
  }

  return async ({zoom, center, width, height}) => {
    const level = Math.floor(zoom + 0.585); // il cambio di livello di TGen, come nella preview
    if (level < demMin) return null;
    const zd = Math.min(level, demMax);
    const s = 2 ** (zoom - zd);             // pixel della vista per punto del DEM
    const steps = Math.max(1, Math.round(s)); // scarto di indice: intero per forza
    const B = 3 * steps;
    // angolo della vista in pixel mondo allo zoom (frazionario) della pagina
    const world = 256 * 2 ** zoom;
    const sinLat = Math.sin((center[1] * Math.PI) / 180);
    const cx = ((center[0] + 180) / 360) * world;
    const cy = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * world;
    const x0 = Math.round(cx - width / 2), y0 = Math.round(cy - height / 2);
    const u0 = Math.floor((x0 - B + 0.5) / s - 0.5), u1 = Math.floor((x0 + width + B - 0.5) / s - 0.5) + 1;
    const v0 = Math.floor((y0 - B + 0.5) / s - 0.5), v1 = Math.floor((y0 + height + B - 0.5) / s - 0.5) + 1;
    const Wd = u1 - u0 + 1, Hd = v1 - v0 + 1;
    const D = await mosaic(zd, u0, v0, Wd, Hd);
    const E = quoteVista(D, Wd, u0, v0, x0, y0, width, height, B, s);
    const f = fasciaDi(bands, level);
    return {f, sh: grigi(E, width, height, B, (steps * PIXEL_Z0) / 2 ** zoom, f, steps)};
  };
}

/** La pagina di lettura dello schema: Redoc da CDN, nessuna dipendenza in piu'. */
const DOCS_HTML = readFileSync(fileURLToPath(new URL('./docs.html', import.meta.url)), 'utf8');

// ------------------------------------------------------------------ la rotta

/**
 * @param {object} deps
 *   - `tokens`: Map token -> {shard, rpm} (R8)
 *   - `limits`: da `createLimits()`
 *   - `baseUrl`: il server delle tile da cui leggere stile, glifi, sprite e DEM
 *   - `getStyle`, `renderFrame`, `shadeFactory`: iniettabili per i test
 */
export function printRouter({
  tokens = new Map(),
  limits = createLimits(),
  baseUrl = process.env.PRINT_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 8080}`,
  getStyle = fetchStyle(baseUrl),
  renderFrame = null,
  shadeFactory = demShade,
} = {}) {
  const router = express.Router();

  // il modulo nativo si carica solo quando serve davvero: importare la rotta non
  // deve aprire un contesto OpenGL (e sull'host il prebuilt non si carica affatto)
  const render = renderFrame ?? (async args => (await import('./render.js')).renderFrame(args));

  const auth = (req, res, next) => {
    const header = req.get('authorization') ?? '';
    // RFC 9110: lo schema e' case-insensitive, `bearer <token>` e' valido quanto `Bearer`
    const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
    const info = m && tokens.get(m[1]);
    if (!info) {
      res.set('WWW-Authenticate', 'Bearer').status(401).json({error: 'token mancante o non valido'});
      return;
    }
    req.printShard = info.shard; // il token non entra mai in req, nei log o negli errori
    try {
      limits.checkRate(m[1], info.rpm ?? DEFAULT_RPM);
    } catch (e) {
      if (!(e instanceof RateLimitError)) throw e;
      res.set('Retry-After', String(e.retryAfterSeconds)).status(429).json({error: e.message});
      return;
    }
    next();
  };

  // il tetto del corpo e' DICHIARATO: il default di Express (100 kB) farebbe
  // sembrare un difetto dello shard il 413 su una mappa d'insieme (R9)
  const body = express.json({limit: MAX_BODY_BYTES});

  // lo schema e la sua pagina stanno PRIMA dell'autenticazione, e apposta: e' il
  // documento che si manda a chi deve scrivere il chiamante, e chiederglielo con
  // un token che ancora non ha sarebbe un giro a vuoto. Non contiene segreti —
  // e' lo stesso file che sta nel repo pubblico — e non cita nessun token.
  router.get('/openapi.json', (req, res) => {
    // come `/style.json` e `/manifest`: uno schema cachato che non corrisponde
    // piu' al servizio e' peggio di nessuno schema
    res.set('Cache-Control', 'no-cache').json(openapi);
  });
  router.get('/docs', (req, res) => {
    res.type('html').set('Cache-Control', 'no-cache').send(DOCS_HTML);
  });

  router.post('/map', auth, body, async (req, res) => {
    const t0 = Date.now();
    let r, view;
    try {
      r = parseRequest(req.body);
      view = asBadRequest(() => fitBounds(r.geometry,
        {width: r.width, height: r.height, padding: r.padding, maxZoom: r.maxZoom}));
    } catch (e) {
      // SOLO un BadRequestError e' un messaggio per il chiamante: tutto il resto
      // e' un difetto nostro e va al gestore degli errori, che risponde 500 senza
      // riportare niente (R11)
      if (!(e instanceof BadRequestError)) throw e;
      // i messaggi di parseRequest e fitBounds nominano il campo, mai il valore (R11)
      log('warn', 'print: richiesta rifiutata', {shard: req.printShard, reason: e.message});
      res.status(400).json({error: e.message});
      return;
    }

    const fields = mapInfoFields({zoom: view.zoom, center: view.center, dpi: r.dpi});
    try {
      const png = await limits.run(async () => {
        const base = await getStyle({styleId: r.styleId, set: r.set});
        // sprite @3x: a typeScale 3,2 l'icona chiede 1,07 volte i pixel dell'atlas
        // a densita' 3, quindi resta nitida; con l'1x uscirebbe sfocata (Task 7)
        const withSprite = typeof base.sprite === 'string' && !base.sprite.endsWith('@3x')
          ? {...base, sprite: `${base.sprite}@3x`} : base;
        // ORDINE: l'overlay PRIMA dell'adattamento, o il suo `stroke-width` non
        // riceve il raddoppio di `IN_PIXEL` e la traccia esce sottile la meta'
        const style = adattaStile(addOverlay(withSprite, r.geometry), {typeScale: TYPE_SCALE});
        const shade = shadeFactory ? shadeFactory(style) : null;
        const rgb = await render({style, center: view.center, zoom: view.zoom,
          width: r.width, height: r.height, ratio: PIXEL_RATIO, shade});
        // R17: una pagina incompleta e' un errore. `renderFrame` rifiuta gia' sugli
        // avvisi del renderer; qui si controlla che i pixel siano quelli della pagina
        if (!Buffer.isBuffer(rgb) || rgb.length !== r.width * r.height * 3) {
          throw new Error('il frame non ha i pixel della pagina');
        }
        return r.mapInfo
          ? drawMapInfo(rgb, {width: r.width, height: r.height, dpi: r.dpi, zoom: view.zoom, center: view.center})
          : sharp(rgb, {raw: {width: r.width, height: r.height, channels: 3}}).png().toBuffer();
      });

      res.set({
        'Content-Type': 'image/png',
        // le geometrie non restano in nessuna cache, nemmeno in quella di un proxy (R11)
        'Cache-Control': 'no-store',
        // il corredo anche a `mapInfo: false`: lo shard lo stampa dove preferisce (R15)
        // i byte sono UTF-8: Node scrive gli header in latin1, quindi `©` e `·`
        // uscirebbero come un byte solo e un job PHP che decodifica UTF-8
        // leggerebbe due byte malformati (R15)
        'x-wm-attribution': headerUtf8(fields.attribution),
        'x-wm-scale': headerUtf8(fields.scale),
        'x-wm-dpi': String(fields.dpi),
      });
      log('info', 'print: pagina resa', {shard: req.printShard, format: r.format, orientation: r.orientation,
        dpi: r.dpi, width: r.width, height: r.height, mapInfo: r.mapInfo, bytes: png.length, ms: Date.now() - t0});
      res.status(200).send(png);
    } catch (e) {
      if (e instanceof SlotsBusyError) {
        // i due 503 sono la stessa risposta ma non lo stesso guasto, e dal di
        // fuori non si distinguono: con `freeSlots` a 0 il servizio e' CARICO,
        // con slot liberi e `inFlight` pieno e' ROTTO — rendering scaduti che non
        // sono mai rientrati, che solo il riciclo del processo rimuove (R6/R16).
        log('warn', 'print: slot pieni', {shard: req.printShard, ms: Date.now() - t0,
          freeSlots: limits.freeSlots(), inFlight: limits.inFlight(),
          cause: limits.freeSlots() > 0 ? 'rendering abbandonati' : 'carico'});
        res.set('Retry-After', String(e.retryAfterSeconds)).status(503).json({error: e.message});
        return;
      }
      if (e instanceof RenderTimeoutError) {
        log('error', 'print: rendering scaduto', {shard: req.printShard, ms: Date.now() - t0});
        res.set('Retry-After', String(RETRY_AFTER_TIMEOUT_SECONDS)).status(504).json({error: e.message});
        return;
      }
      // il messaggio del renderer puo' citare un URL di tile, mai il corpo della
      // richiesta: resta nel log, non nella risposta
      log('error', 'print: rendering fallito', {shard: req.printShard, reason: e.message, ms: Date.now() - t0});
      res.status(502).json({error: 'rendering fallito'});
    }
  });

  // gli errori del parser del corpo arrivano qui
  router.use((err, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    if (err?.type === 'entity.too.large') {
      res.status(413).json({error: `il corpo supera la dimensione massima di ${MAX_BODY_BYTES} byte`});
      return;
    }
    if (err instanceof SyntaxError || err?.type === 'entity.parse.failed') {
      res.status(400).json({error: 'corpo non valido: atteso JSON'});
      return;
    }
    log('error', 'print: errore non gestito', {reason: err?.message});
    res.status(500).json({error: 'errore interno'});
  });

  return router;
}
