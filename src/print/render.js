/**
 * Un frame di mappa, disegnato con maplibre-native: il cuore di
 * `pipeline/render-png.mjs` estratto in una funzione, cosi' serve sia lo script
 * (frame quadrati di tile) sia la stampa (una pagina rettangolare).
 *
 * Lo stile arriva GIA' adattato (`adattaStile(localizza(...))`): qui non si
 * decide niente su di esso, salvo tagliarlo in due meta' attorno
 * all'ombreggiatura, che non e' un layer ma si calcola in mezzo.
 *
 * ZOOM. `zoom` e' quello a 256 px, cartografico, lo stesso di `fitBounds`, di
 * `PIXEL_Z0` e di OpenLayers: a zoom z il mondo e' largo 256 * 2^z pixel
 * dell'immagine. maplibre-native conta invece tile da 512 px css e un pixel
 * ratio `r`: il mondo e' largo 512 * 2^zm * r pixel dell'immagine. Uguagliando,
 * zm = zoom + log2(0,5 / r). Con il pixel ratio del repo (0,5, vedi
 * `stile-nativo.js`) zm = zoom e le tile caricate sono quelle del livello
 * giusto; con altri ratio zm si sposta, e con esso il livello delle tile
 * (il compromesso per la stampa e' del Task 7).
 *
 * ERRORI. `mbgl.on('message')` e' un gestore di PROCESSO: non dice a quale
 * mappa appartiene un messaggio. Si correlano quindi a ogni chiamata due cose:
 *  - gli errori delle richieste di risorse, che passano dalla callback della
 *    mappa di QUELLA chiamata: attribuzione esatta;
 *  - lo stile, validato in anticipo con lo Style Spec: una layer di tipo
 *    sconosciuto per maplibre-native e' solo un WARNING e il frame uscirebbe
 *    senza quel layer, come se fosse a posto;
 *  - i messaggi `ERROR` residui del processo (render fallito, simboli, ...),
 *    attribuiti a TUTTE le chiamate in corso. Limite: con due rendering in
 *    parallelo un errore di uno puo' far fallire anche l'altro (falso
 *    positivo, mai un frame incompleto restituito come buono). I "Failed to
 *    load ..." non si contano: sono gia' attribuiti esattamente dalla callback.
 *    Un messaggio arrivato dopo la fine dell'ultimo render non e' piu'
 *    attribuibile.
 */
import mbgl from '@maplibre/maplibre-gl-native';
import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import {componi} from '../raster/ombra.js';
import {PIXEL_RATIO} from '../raster/stile-nativo.js';

const vuoto = Buffer.alloc(0);
// un errore di rete transitorio (connessione chiusa dal server) si riprova
const prendi = (url, prove = 3) => fetch(url).catch(e => (prove > 1
  ? new Promise(ok => setTimeout(ok, 200)).then(() => prendi(url, prove - 1)) : Promise.reject(e)));

/** Chiamate in corso: ciascuna raccoglie i propri errori. */
const active = new Set();
/**
 * Messaggi delle richieste fallite, gia' attribuite dalla callback: il "Failed to load ..."
 * di maplibre che li contiene e' lo stesso errore e non si conta due volte. Un "Failed to
 * load tile" con la richiesta andata a buon fine (200 corrotto) non c'e' qui, e si conta.
 */
const failedRequests = new Set();
const noteFailure = msg => {
  if (failedRequests.size > 500) failedRequests.delete(failedRequests.keys().next().value);
  failedRequests.add(msg);
};
let listening = false;
const listen = () => {
  if (listening) return;
  listening = true;
  mbgl.on('message', m => {
    if (m.severity !== 'ERROR') return;
    if (/^Failed to load/.test(m.text) && [...failedRequests].some(f => m.text.includes(f))) return;
    for (const c of active) c.errors.push(`${m.class}: ${m.text}`);
  });
};
// solo le tile possono mancare (fuori copertura): sprite, glifi, stile e sorgenti mancanti sono un errore
const MAY_BE_EMPTY = new Set([mbgl.Resource.Tile]);

/**
 * La coppia di mappe sotto/sopra l'ombreggiatura (si taglia al primo layer
 * `contour*`). `ctx.current` e' il contesto della chiamata in corso. Il pixel
 * ratio e' della mappa, non della vista: si fissa qui. Le mappe si possono
 * riusare fra chiamate SEQUENZIALI: una seconda chiamata concorrente rifiuta (`ctx.busy`).
 */
export function createMaps(style, ratio = PIXEL_RATIO) {
  const problems = validateStyleMin(style);
  if (problems.length) throw new Error(`stile non valido: ${problems.slice(0, 3).map(e => e.message).join('; ')}`);
  listen();
  const ctx = {current: null, busy: false};
  const iOmbra = style.layers.findIndex(l => l.id.startsWith('contour'));
  const cut = iOmbra < 0 ? style.layers.length : iOmbra;
  const sotto = {...style, layers: style.layers.slice(0, cut)};
  const sopra = {...style, layers: style.layers.slice(cut).filter(l => l.type !== 'background')};
  const richiesta = (req, cb) => {
    const fail = e => { noteFailure(e.message); ctx.current?.errors.push(e.message); cb(e); };
    prendi(req.url).then(async r => {
      // fuori copertura il server risponde 204 o 404: tile vuota, non errore; per le altre risorse si'
      if ((r.status === 204 || r.status === 404) && MAY_BE_EMPTY.has(req.kind)) return cb(null, {data: vuoto});
      if (!r.ok) return fail(new Error(`${r.status} ${req.url}`));
      cb(null, {data: Buffer.from(await r.arrayBuffer())});
    }).catch(fail);
  };
  const newMap = s => {
    const m = new mbgl.Map({request: richiesta, ratio});
    m.load(s);
    return m;
  };
  const mSotto = newMap(sotto), mSopra = newMap(sopra);
  return {mSotto, mSopra, ctx, hasSplit: iOmbra >= 0, ratio, release: () => { mSotto.release(); mSopra.release(); }};
}

const disegna = (m, vista) => new Promise((ok, ko) => m.render(vista, (e, b) => (e ? ko(e) : ok(b))));

/**
 * Disegna un frame `width` x `height` pixel centrato su `center` ([lon, lat]) a `zoom` (256 px).
 * `shade`, se c'e', e' `async ({zoom, center, width, height}) => ({f, sh}) | null`: la fascia
 * e i grigi dell'ombra gia' calcolati per quel frame. `maps` riusa una coppia gia' creata.
 * Restituisce l'RGB grezzo (width*height*3); se qualcosa va storto, rifiuta.
 */
export async function renderFrame({style, center, zoom, width, height, ratio = PIXEL_RATIO, shade = null, maps = null}) {
  const own = !maps;
  maps ??= createMaps(style, ratio);
  if (maps.ratio !== ratio) throw new Error(`le mappe sono state create con ratio ${maps.ratio}, non ${ratio}`);
  if (shade && !maps.hasSplit) {
    if (own) maps.release();
    throw new Error('nessun layer contour: non so dove mettere l\'ombreggiatura');
  }
  if (maps.ctx.busy) throw new Error('le mappe sono occupate da un altro frame: due render concorrenti sulla stessa coppia non sono validi');
  const call = {errors: []};
  active.add(call);
  maps.ctx.busy = true;
  maps.ctx.current = call;
  try {
    const vista = {zoom: zoom + Math.log2(PIXEL_RATIO / ratio), center, width: width / ratio, height: height / ratio, bearing: 0, pitch: 0};
    const a = await disegna(maps.mSotto, vista);
    const b = await disegna(maps.mSopra, vista);
    // i messaggi del processo arrivano dopo la callback del render
    await new Promise(ok => setImmediate(ok));
    if (call.errors.length) throw new Error(`maplibre-native: ${call.errors.slice(0, 3).join('; ')}`);
    const s = shade ? await shade({zoom, center, width, height}) : null;
    return componi(a, b, s?.sh ?? null, s?.f ?? null, width, height);
  } finally {
    active.delete(call);
    maps.ctx.current = null;
    maps.ctx.busy = false;
    if (own) maps.release();
  }
}
