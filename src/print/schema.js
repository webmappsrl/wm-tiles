/**
 * Lo schema OpenAPI **come validazione**, non come documentazione accanto al
 * codice (Task 12).
 *
 * `openapi.json` e' la fonte: la rotta compila con Ajv lo schema
 * `PrintMapRequest` che sta li' dentro, e `limits.js` legge da li' anche i
 * numeri. Una seconda copia delle stesse regole in prosa diverge — in questo
 * repo e' gia' successo due volte (il CLAUDE.md che dichiarava PNG «identici
 * byte per byte» mentre `tools/png-identity.mjs` lo smentiva, il
 * `docs/README.md` che dava il renderer raster per non fatto) — e qui a
 * crederci sarebbe lo shard che scrive il chiamante.
 *
 * **Ajv non parla mai al chiamante.** I suoi messaggi contengono i dati
 * ricevuti (`data/geometry/features/0/...`, e in certi casi il valore stesso):
 * R11 vieta che un valore arrivato da fuori torni indietro, perche' dagli shard
 * arrivano anche tracce non pubblicate. Qui l'errore di Ajv si traduce nel
 * PERCORSO DEL CAMPO e in un messaggio scritto a mano, con dentro solo i numeri
 * e gli elenchi presi dallo schema. Il valore ricevuto si puo' GUARDARE — serve
 * per distinguere una `GeometryCollection` da un tipo inventato — ma non
 * riportare.
 *
 * Se un errore non ha una traduzione, il messaggio nomina solo il campo e il
 * fatto viene contato (`unmappedErrors`): e' un difetto nostro, e il test
 * `print-openapi` viola ogni vincolo dello schema uno per uno e pretende che il
 * conto resti a zero.
 */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import Ajv from 'ajv/dist/2020.js';

/** Il documento OpenAPI, cosi' com'e' nel repo: lo serve anche la rotta. */
export const openapi = JSON.parse(
  readFileSync(fileURLToPath(new URL('./openapi.json', import.meta.url)), 'utf8'));

const schemas = openapi.components.schemas;
const request = schemas.PrintMapRequest;

/**
 * I numeri del servizio, letti dallo schema. `limits.js` li ri-esporta con i
 * suoi nomi: cosi' il tetto che il documento dichiara e il tetto che il codice
 * applica sono lo stesso numero, non due numeri uguali.
 */
export const LIMITS = {
  ...openapi['x-wm-limits'],
  minDpi: schemas.Page.properties.dpi.minimum,
  maxDpi: schemas.Page.properties.dpi.maximum,
  maxFeatures: schemas.FeatureCollection.properties.features.maxItems,
  maxZoom: request.properties.maxZoom.maximum,
  defaultMaxZoom: request.properties.maxZoom.default,
  maxStrokeWidth: schemas.FeatureProperties.properties['stroke-width'].maximum,
  minTokenLength: openapi.components.securitySchemes.shardToken['x-wm-min-token-length'],
};

/** I formati di pagina dichiarati: `formats.js` ne tiene i millimetri. */
export const PAGE_FORMAT_IDS = schemas.Page.properties.format.enum;
/** Gli stili per nome. La mappa dei percorsi sta in `route.js`. */
export const STYLE_ID_VALUES = request.properties.styleId.enum;
/** I tipi di geometria ammessi, nell'ordine in cui il messaggio d'errore li elenca. */
export const GEOMETRY_TYPE_VALUES = schemas.Geometry.properties.type.enum;
/** I campi ammessi nel corpo e in `page`, nell'ordine del documento. */
export const BODY_FIELD_NAMES = Object.keys(request.properties);
export const PAGE_FIELD_NAMES = Object.keys(schemas.Page.properties);

/**
 * Quanto puo' essere annidata la lista delle coordinate. Non e' scritto due
 * volte: e' la LUNGHEZZA della catena `CoordinatesDepth*` dello schema, e il
 * test pretende che coincida con `x-wm-limits.maxCoordDepth`.
 */
export const COORD_DEPTH = Object.keys(schemas).filter(k => /^CoordinatesDepth\d+$/.test(k)).length;

/**
 * Lo schema e' la fonte dei tetti, quindi un vincolo che sparisce dal documento
 * non diventa un tetto piu' largo: diventa `undefined`, cioe' NESSUN tetto. E
 * Ajv gira con `strict: false` — deve, il documento non e' uno schema — percio'
 * una parola chiave scritta male (`maxItem`, `maximun`) viene ignorata in
 * silenzio e nessun test se ne accorge: la review del 24 novembre 2026 ha tolto
 * `maxItems: 500` e ha visto 75 test verdi con 600 feature accettate.
 *
 * Qui il processo si ferma rumorosamente all'import, come fa il confronto fra
 * `STYLE_IDS` e `STYLE_ID_VALUES` in `route.js`. E' la classe di difetti che il
 * CLAUDE.md chiama «cose che sembrano configurate e non lo sono».
 */
for (const [nome, valore] of Object.entries(LIMITS)) {
  if (!Number.isFinite(valore)) {
    throw new Error(`openapi.json: il vincolo «${nome}» manca o non e' un numero (vale ${valore}): ` +
      'un tetto assente non e\' un tetto piu\' largo, e Ajv con strict:false non lo segnala');
  }
}
if (COORD_DEPTH !== LIMITS.maxCoordDepth) {
  throw new Error(`openapi.json: la catena CoordinatesDepth* e' lunga ${COORD_DEPTH} ` +
    `ma x-wm-limits.maxCoordDepth dichiara ${LIMITS.maxCoordDepth}`);
}
for (const [nome, chiaveDefault, ammessi] of [
  ['styleId', request.properties.styleId.default, STYLE_ID_VALUES],
  ['page.orientation', schemas.Page.properties.orientation.default, schemas.Page.properties.orientation.enum],
]) {
  if (chiaveDefault !== undefined && !ammessi.includes(chiaveDefault)) {
    throw new Error(`openapi.json: il valore di serie di «${nome}» non e' fra quelli ammessi`);
  }
}
if (request.properties.styleId.default === undefined) {
  throw new Error("openapi.json: manca il valore di serie di «styleId»: senza, una richiesta " +
    'che lo omette — il secondo esempio del documento — chiede uno stile inesistente e finisce in 502');
}

/**
 * Richiesta non valida: diventa un 400 che nomina il campo e mai il suo valore.
 *
 * E' un FILTRO, non un'etichetta: solo il messaggio di questa classe esce nella
 * risposta. Qualunque altra eccezione — un difetto nostro — torna al gestore
 * degli errori e diventa un 500 generico, con il dettaglio solo nel log.
 */
export class BadRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BadRequestError';
  }
}

const ajv = new Ajv({
  // il documento e' un OpenAPI, non uno schema: `openapi`, `paths`, `info` e le
  // estensioni `x-wm-*` non sono parole chiave e Ajv deve ignorarle
  strict: false,
  // un errore solo basta, ed e' anche la difesa piu' semplice: meno errori, meno
  // occasioni di far uscire qualcosa che arriva dal chiamante
  allErrors: false,
  // i valori di serie NON si scrivono nel corpo ricevuto: li applica
  // `parseRequest`, che deve poter distinguere «assente» da «uguale al default»
  useDefaults: false,
});
ajv.addSchema(openapi, 'wm-print');
const validate = ajv.getSchema('wm-print#/components/schemas/PrintMapRequest');

// ------------------------------------------------------------------ i messaggi

const elenco = xs => xs.join(', ');

/**
 * I messaggi, per percorso del campo. La chiave e' il percorso con gli indici
 * normalizzati a `#`; il valore e' una funzione che riceve l'errore di Ajv e il
 * percorso leggibile (`geometry.features[0].properties.stroke`).
 *
 * Il messaggio e' lo STESSO di prima della sostituzione, parola per parola: i
 * test della rotta e la parita' con la finta sono la rete di questo task, e un
 * messaggio riscritto non sarebbe una validazione piu' giusta ma solo una
 * garanzia persa.
 */
const MESSAGES = new Map(Object.entries({
  '': e => (e.keyword === 'additionalProperties'
    ? `campo sconosciuto nel corpo (ammessi: ${elenco(BODY_FIELD_NAMES)})`
    : 'il corpo deve essere un oggetto JSON'),

  '/geometry': () => 'geometry deve essere una FeatureCollection GeoJSON',
  '/geometry/type': () => 'geometry deve essere una FeatureCollection GeoJSON',
  '/geometry/features': e => {
    if (e.keyword === 'minItems') return 'geometry.features e\' vuoto: non c\'e\' niente da inquadrare';
    if (e.keyword === 'maxItems') return `geometry.features supera il massimo di ${LIMITS.maxFeatures} feature`;
    return 'geometry deve essere una FeatureCollection GeoJSON';
  },
  '/geometry/features/#': (e, path) => `${path} deve essere una Feature GeoJSON con una geometria`,
  '/geometry/features/#/type': (e, path) => `${feature(path)} deve essere una Feature GeoJSON con una geometria`,
  '/geometry/features/#/geometry': (e, path) => `${feature(path)} deve essere una Feature GeoJSON con una geometria`,
  '/geometry/features/#/geometry/type': (e, path, data) => (data === 'GeometryCollection'
    // il valore si guarda per scegliere il messaggio, non per riportarlo: la
    // parola «GeometryCollection» e' vocabolario dell'interfaccia, come i tipi ammessi
    ? `${path.replace(/\.type$/, '')}: GeometryCollection non e' ammessa, usa una Feature per geometria`
    : `${path} non e' un tipo ammesso (${elenco(GEOMETRY_TYPE_VALUES)})`),
  '/geometry/features/#/properties': (e, path) => `${path} deve essere un oggetto`,
  '/geometry/features/#/properties/stroke': (e, path) =>
    `${path} deve essere un colore esadecimale (#rgb o #rrggbb)`,
  '/geometry/features/#/properties/stroke-width': (e, path) =>
    `${path} deve essere un numero fra 0 e ${LIMITS.maxStrokeWidth}`,

  '/page': e => (e.keyword === 'additionalProperties'
    ? `campo sconosciuto in page (ammessi: ${elenco(PAGE_FIELD_NAMES)})`
    : 'page deve essere un oggetto {format, orientation, dpi}'),
  '/page/format': () => `page.format non valido (ammessi: ${elenco(PAGE_FORMAT_IDS)})`,
  '/page/orientation': () =>
    `page.orientation non valido (ammessi: ${elenco(schemas.Page.properties.orientation.enum)})`,
  '/page/dpi': () => `page.dpi deve essere un intero fra ${LIMITS.minDpi} e ${LIMITS.maxDpi}`,

  '/styleId': () => `styleId non valido (ammessi: ${elenco(STYLE_ID_VALUES)})`,
  '/set': () => 'set non valido: sono 12 cifre esadecimali',
  '/padding': () => 'padding deve essere un numero non negativo di pixel',
  '/maxZoom': () => `maxZoom deve essere un numero fra 0 e ${LIMITS.maxZoom}`,
  '/mapInfo': () => 'mapInfo deve essere true o false',
}));

/** `geometry.features[0].geometry.type` -> `geometry.features[0]`. */
const feature = path => path.replace(/^(geometry\.features\[\d+\]).*$/, '$1');

/** Il percorso di Ajv (`/geometry/features/0/properties`) in forma leggibile. */
function readable(instancePath, missing) {
  const parts = instancePath.split('/').filter(Boolean).concat(missing ? [missing] : []);
  return parts.reduce((out, p) => (/^\d+$/.test(p) ? `${out}[${p}]` : out ? `${out}.${p}` : p), '');
}

/** Lo stesso percorso con gli indici normalizzati: la chiave della tabella. */
const keyOf = (instancePath, missing) =>
  instancePath.replace(/\/\d+(?=\/|$)/g, '/#') + (missing ? `/${missing}` : '');

/** Il valore nel corpo a quel percorso: serve a SCEGLIERE il messaggio, mai a riportarlo. */
function valueAt(body, instancePath) {
  let node = body;
  for (const p of instancePath.split('/').filter(Boolean)) {
    if (node === null || typeof node !== 'object') return undefined;
    node = node[/^\d+$/.test(p) ? Number(p) : p];
  }
  return node;
}

/** Quanti errori non hanno trovato una traduzione: il test pretende zero. */
let unmapped = 0;
export const unmappedErrors = () => unmapped;

/**
 * Da un errore di Ajv al messaggio per il chiamante.
 *
 * Due casi particolari, entrambi per come Ajv riporta gli `anyOf`:
 * - un errore sotto `coordinates` puo' essere solo la profondita', perche' lo
 *   schema la' dentro non vincola altro: la catena accetta numeri, stringhe e
 *   oggetti a qualunque livello e rifiuta solo un array oltre l'ottavo. Ajv pero'
 *   segnala anche l'`anyOf` di ogni livello attraversato, quindi non si guarda
 *   la profondita' dell'errore ma la si dichiara;
 * - per `required` il campo mancante non e' nel percorso ma nei parametri.
 */
function message(err, body) {
  const missing = err.keyword === 'required' ? err.params.missingProperty : null;
  const path = readable(err.instancePath, missing);
  const coord = /^geometry\.features\[\d+\]\.geometry\.coordinates/.exec(path);
  if (coord) return `${coord[0]} e' annidato oltre ${COORD_DEPTH} livelli`;
  const build = MESSAGES.get(keyOf(err.instancePath, missing));
  if (build) return build(err, path, valueAt(body, err.instancePath));
  unmapped++;
  // non si ripete mai il messaggio di Ajv, che contiene i dati ricevuti
  return `${path || 'il corpo'} non e' valido`;
}

/**
 * Valida il corpo contro lo schema del documento OpenAPI. Non lo modifica e non
 * applica i valori di serie: li applica `parseRequest`, che deve distinguere
 * «assente» da «uguale al default».
 *
 * @throws {BadRequestError} con un messaggio che nomina il campo, mai il valore
 */
export function validateBody(body) {
  if (validate(body)) return;
  // con `allErrors: false` gli errori sono piu' d'uno solo per gli `anyOf` delle
  // coordinate: si prende il piu' PROFONDO, cioe' quello sul campo vero e non
  // sull'`anyOf` che lo contiene
  const err = validate.errors.reduce((a, b) => (b.instancePath.length > a.instancePath.length ? b : a));
  throw new BadRequestError(message(err, body));
}
