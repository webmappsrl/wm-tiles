/**
 * L'implementazione FINTA di `POST /v1/print/map` (R13): una pagina uniforme con
 * sopra scritte le sue dimensioni, per lo sviluppo locale e per i test degli
 * shard, senza maplibre-native, senza DEM e senza il server delle tile acceso.
 *
 * **La finta CONDIVIDE la validazione del servizio vero, non la imita.** Importa
 * `parseRequest` e `fitBounds` dai moduli di produzione e il router vero da
 * `route.js`: una finta che accetta tutto fa passare i test degli shard e lascia
 * scoprire i difetti contro il servizio reale, cioe' in produzione. Di
 * conseguenza rifiuta esattamente quello che rifiuta la rotta — URL in qualsiasi
 * campo, `styleId` o `format` sconosciuti, `FeatureCollection` vuota,
 * antimeridiano, corpo oltre il tetto, `stroke`/`stroke-width` fuori scala,
 * coordinate annidate oltre il limite — con gli stessi messaggi.
 *
 * Due modi di usarla, documentati in `docs/howto/stampa-mappe.md`:
 * - `fakePrint(body)` per un test in JavaScript: restituisce il PNG o lancia;
 * - `node src/print/fake.js` per uno shard PHP: alza un server HTTP con la
 *   stessa rotta, gli stessi codici di stato e gli stessi header del vero.
 *
 * Il secondo modo non reimplementa niente: monta `printRouter` sostituendo solo
 * il rendering e lo stile, quindi token, limite al minuto, slot, tempo massimo e
 * header del corredo sono quelli di produzione.
 *
 * **Una differenza resta, ed e' nel verso prudente: il tetto del corpo.**
 * `fakePrint(body)` riceve un oggetto gia' deserializzato e puo' solo
 * ri-serializzarlo minificato, quindi il suo tetto e' un limite INFERIORE —
 * un corpo indentato che qui passa prende `413` sul filo (misurata una stessa
 * richiesta: 748.840 byte compatta, 5.069.090 indentata). `fakePrintApp()` non
 * ha il problema: li' il 413 lo da' `express.json` del router vero.
 *
 * Il token NON e' nel codice: il repo e' pubblico. Arriva da
 * `PRINT_FAKE_TOKEN` e, se manca, se ne genera uno a caso a ogni avvio e lo si
 * stampa — lo stesso gesto del servizio vero, dove il token sta in un file fuori
 * dal repo (`src/print/tokens.js`). Vale anche qui la lunghezza minima di
 * `loadTokens`: un token di sei caratteri che funziona contro la finta e fa
 * fallire l'avvio del servizio vero e' un difetto scoperto in deploy.
 */
import {randomBytes} from 'node:crypto';
import {realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import express from 'express';
import sharp from 'sharp';
import {fitBounds} from './fit.js';
import {DEFAULT_RPM, MAX_BODY_BYTES} from './limits.js';
import {drawMapInfo} from './map-info.js';
import {parseRequest, printRouter} from './route.js';
import {MIN_TOKEN_LENGTH} from './tokens.js';

/** Lo shard che la finta dichiara nei log: chi legge deve vedere che e' finta. */
export const FAKE_SHARD = 'fake';

/** Il grigio della pagina finta: chiaro, cosi' il corredo nero si legge. */
const PAPER = 232;

const escapeXml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Il frame della finta: carta uniforme, una cornice, due diagonali e le
 * dimensioni scritte al centro. Ha la firma di `renderFrame` (Task 8), quindi va
 * anche dentro `printRouter` al posto del rendering vero.
 *
 * Le diagonali servono a non scambiarla per una mappa: una pagina grigia senza
 * segni, in una scheda, sembra un rendering riuscito e vuoto.
 */
export async function fakeFrame({width, height, zoom}) {
  const size = Math.max(8, Math.round(Math.min(width, height) / 16));
  const lines = [
    'PAGINA FINTA',
    `${width} x ${height} px`,
    Number.isFinite(zoom) ? `z ${zoom.toFixed(2)}` : 'z ?',
  ];
  const y0 = height / 2 - ((lines.length - 1) * size * 1.3) / 2;
  const text = lines.map((l, i) => `<text x="${width / 2}" y="${y0 + i * size * 1.3}" `
    + `font-family="sans-serif" font-size="${i === 0 ? size : size * 0.72}" font-weight="bold" `
    + `fill="#8a8a8a" text-anchor="middle" dominant-baseline="middle">${escapeXml(l)}</text>`).join('');
  const stroke = Math.max(1, Math.round(Math.min(width, height) / 400));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<g stroke="#bdbdbd" stroke-width="${stroke}" fill="none">`
    + `<rect x="${stroke / 2}" y="${stroke / 2}" width="${width - stroke}" height="${height - stroke}"/>`
    + `<path d="M0 0 L${width} ${height} M${width} 0 L0 ${height}"/></g>${text}</svg>`;

  // `removeAlpha` e' obbligatorio: la composizione di un SVG aggiunge il canale
  // alfa, e un frame a 4 canali non ha i pixel che la rotta si aspetta (R17).
  const {data} = await sharp(Buffer.alloc(width * height * 3, PAPER),
    {raw: {width, height, channels: 3}})
    .composite([{input: Buffer.from(svg), top: 0, left: 0}])
    .removeAlpha().raw().toBuffer({resolveWithObject: true});
  return data;
}

/**
 * La finta come funzione: stessa validazione, stesso formato di uscita.
 *
 * **Il tetto del corpo qui e' un limite INFERIORE.** Il servizio vero conta i
 * byte che arrivano sul filo (`express.json({limit})`), questa funzione riceve
 * un oggetto gia' deserializzato e puo' solo ri-serializzarlo MINIFICATO:
 * misurata una stessa richiesta, 748.840 byte compatta e 5.069.090 indentata.
 * Un corpo indentato che qui passa prende quindi `413` sul filo. Chi vuole la
 * misura vera usa `fakePrintApp()`, dove il 413 lo da' `express.json` del
 * router vero, cioe' lo stesso codice della produzione. La funzione non accetta
 * il testo crudo apposta: sarebbe una terza via d'ingresso che nessuno userebbe.
 *
 * @param {object} body il corpo della richiesta, gia' come oggetto
 * @returns {Promise<Buffer>} il PNG della pagina
 * @throws se la richiesta non e' valida, con il messaggio del servizio vero
 */
export async function fakePrint(body) {
  // `express.json` e' in modo strict: al livello piu' esterno accetta solo un
  // oggetto o una lista, e su `null`, `"ciao"` o `7` risponde 400 con questo
  // messaggio. Senza questa riga la finta ne dava uno suo (R13: stessi messaggi).
  if (body === null || typeof body !== 'object') {
    throw new Error('corpo non valido: atteso JSON');
  }
  // il tetto del corpo nel servizio vero lo applica `express.json`, che qui non
  // c'e': senza questo controllo la finta accetterebbe una richiesta che il
  // servizio rifiuta con 413 (R9). E' un limite inferiore, vedi sopra.
  const bytes = Buffer.byteLength(JSON.stringify(body));
  if (bytes > MAX_BODY_BYTES) {
    throw new Error(`il corpo supera la dimensione massima di ${MAX_BODY_BYTES} byte`);
  }

  const r = parseRequest(body);
  const view = fitBounds(r.geometry,
    {width: r.width, height: r.height, padding: r.padding, maxZoom: r.maxZoom});

  const rgb = await fakeFrame({width: r.width, height: r.height, zoom: view.zoom});
  return r.mapInfo
    ? drawMapInfo(rgb, {width: r.width, height: r.height, dpi: r.dpi,
      zoom: view.zoom, center: view.center})
    : sharp(rgb, {raw: {width: r.width, height: r.height, channels: 3}}).png().toBuffer();
}

/**
 * Lo stile minimo che la finta dichiara. Non serve a disegnare — il frame e'
 * gia' pronto — ma `printRouter` lo chiede e lo adatta, quindi deve essere uno
 * stile valido e senza sorgenti: nessuna richiesta in rete.
 */
const fakeStyle = async () => ({
  version: 8,
  sources: {},
  layers: [{id: 'bg', type: 'background', paint: {'background-color': '#ffffff'}}],
});

/**
 * La finta come server HTTP, per gli shard che non sono in JavaScript.
 *
 * E' il router VERO con il rendering sostituito: codici di stato, header,
 * token, limite al minuto e slot sono quelli di produzione.
 *
 * @param {object} options
 *   - `token`: il token che il server accetta; se manca se ne genera uno. Vale
 *     il minimo di `loadTokens` (`MIN_TOKEN_LENGTH`): un token piu' corto
 *     funzionerebbe contro la finta e farebbe FALLIRE L'AVVIO del servizio
 *     vero, cioe' il difetto si scoprirebbe in deploy.
 *   - `rpm`: il limite al minuto di quel token; di serie e' `DEFAULT_RPM`,
 *     quello della produzione, cosi' uno shard che supera il limite se ne
 *     accorge qui. `PRINT_FAKE_RPM` lo alza per una suite che fa molte
 *     richieste di fila.
 * @returns {import('express').Express & {token: string}} l'app Express con il
 *   token attaccato come proprieta': `const app = fakePrintApp(); app.token`.
 *   NON e' `{app, token}` — una destrutturazione darebbe `undefined`.
 */
export function fakePrintApp({token = randomBytes(24).toString('hex'), rpm = DEFAULT_RPM} = {}) {
  if (typeof token !== 'string' || token.length < MIN_TOKEN_LENGTH) {
    // il messaggio non riporta il token, come in `loadTokens`
    throw new Error(`il token della finta deve essere lungo almeno ${MIN_TOKEN_LENGTH} caratteri`);
  }
  if (typeof rpm !== 'number' || !Number.isInteger(rpm) || rpm <= 0) {
    throw new Error('rpm deve essere un intero positivo');
  }
  const app = express();
  app.use('/v1/print', printRouter({
    tokens: new Map([[token, {shard: FAKE_SHARD, rpm}]]),
    renderFrame: fakeFrame,
    getStyle: fakeStyle,
    shadeFactory: null,
  }));
  // stesso percorso e stessa forma del servizio vero (`src/server.js`), con in
  // piu' `fake: true`: lo shard punta il suo controllo di salute qui senza
  // cambiare codice, e chi legge la risposta vede che e' la finta
  app.get('/health', (req, res) => res.json({status: 'ok', fake: true}));
  app.token = token;
  return app;
}

/**
 * Questo file e' stato lanciato come programma? Il confronto e' su percorsi
 * **risolti anche nei symlink**, mai su `file://${process.argv[1]}`: quella
 * forma e' falsa se il percorso contiene uno spazio (uno dei due lo
 * percent-codifica, l'altro no) e il processo uscirebbe 0 senza output e senza
 * server — ed e' il punto d'ingresso documentato per i dev degli shard.
 *
 * `realpathSync` su ENTRAMBI i lati perche' `resolve` da solo non basta:
 * lanciando un symlink al file, Node risolve il realpath del modulo (quindi
 * `import.meta.url` e' il percorso vero) ma lascia `argv[1]` com'e' stato
 * scritto. Verificato: con la sola `resolve` — la forma di
 * `tools/png-identity.mjs` — la finta lanciata da un symlink non parte.
 */
function lanciatoComeProgramma() {
  if (!process.argv[1]) return false;
  const vero = p => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p); // il percorso non esiste piu': meglio un confronto che un'eccezione
    }
  };
  return vero(process.argv[1]) === vero(fileURLToPath(import.meta.url));
}

/** `node src/print/fake.js` alza la finta e stampa il token da usare. */
if (lanciatoComeProgramma()) {
  const port = Number(process.env.PRINT_FAKE_PORT ?? 8099);
  let app;
  try {
    app = fakePrintApp({
      token: process.env.PRINT_FAKE_TOKEN,
      ...(process.env.PRINT_FAKE_RPM ? {rpm: Number(process.env.PRINT_FAKE_RPM)} : {}),
    });
  } catch (e) {
    // un avvio che non parte lo deve DIRE, con una riga leggibile e non con uno
    // stack: e' la variabile d'ambiente di chi sta configurando lo shard
    console.error(`print finta: ${e.message}`);
    process.exit(1);
  }
  app.listen(port, () => {
    console.log(JSON.stringify({ts: new Date().toISOString(), level: 'info',
      msg: 'print finta in ascolto', port, endpoint: '/v1/print/map'}));
    // il token si stampa perche' e' usa e getta e vive solo in questo processo;
    // quello del servizio vero non si stampa mai (src/print/tokens.js)
    if (!process.env.PRINT_FAKE_TOKEN) {
      console.log(`token di questa esecuzione (cambia a ogni avvio): ${app.token}`);
    }
  });
}
