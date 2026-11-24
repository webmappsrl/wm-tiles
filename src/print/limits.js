/**
 * I tetti del servizio di stampa, tutti in un posto e tutti in NUMERO (R9):
 * quanti rendering insieme, quanto possono durare, quanti al minuto per token,
 * quanto puo' pesare la richiesta e quanto grande puo' essere la pagina.
 *
 * «Ragionevole» non e' un tetto: un numero sbagliato si corregge, un numero
 * assente diventa il default di qualcun altro — per il corpo sarebbe quello di
 * Express, 100 kB, che una mappa d'insieme con N tracce supera (R9).
 *
 * Lo slot si libera SEMPRE, in un `finally`: uno slot perso per un'eccezione o
 * per un rendering che non finisce e' un servizio che dopo N richieste risponde
 * 503 per sempre, con il processo vivo e il controllo di salute superato (R16).
 *
 * I contatori sono DUE, e misurano cose diverse:
 * - `inUse` e' lo slot, cioe' chi sta ancora aspettando una risposta;
 * - `inFlight` e' il rendering VERO, che alla scadenza continua a girare: non
 *   c'e' modo di annullare una `render()` di maplibre-native.
 * Con il solo `inUse` una fila di richieste scadute accumulava rendering senza
 * tetto (otto vivi insieme con due slot, misurati dalla review): a ~925 MB di
 * RSS per un A4 a 300 dpi bastano tre scadenze per superare il tetto di memoria
 * del container, e R7 («chi trova il servizio pieno riceve 503») diventa falsa
 * proprio quando R16 scatta. Finche' i rendering abbandonati non rientrano, il
 * servizio risponde 503.
 */
import {LIMITS} from './schema.js';

// ----------------------------------------------------------------- i numeri

/**
 * **I numeri vengono dallo schema** (`openapi.json`, Task 12): qui si danno
 * loro il nome con cui il codice li usa, non un secondo valore. Due copie dello
 * stesso tetto — una nel documento che si manda allo shard, una nel codice che
 * lo applica — divergono, e a crederci sarebbe chi scrive il chiamante.
 */

/** Rendering in parallelo. Un A4 a 300 dpi costa ~925 MB di RSS (misura del Task 1). */
export const MAX_SLOTS = LIMITS.maxSlots;
/** Tempo massimo di un rendering. Oltre, lo slot si libera e la richiesta fallisce (R16). */
export const RENDER_TIMEOUT_MS = LIMITS.renderTimeoutMs;
/** Quanto far aspettare chi trova gli slot pieni: il chiamante e' un job Horizon e riprova. */
export const RETRY_AFTER_SECONDS = LIMITS.retryAfterSeconds;
/**
 * Quanto far aspettare chi ha visto scadere il rendering. NON e' il tempo
 * massimo del rendering: quello dice quanto si e' aspettato, non quando ha senso
 * riprovare, e rimandare il job esattamente a `RENDER_TIMEOUT_MS` lo fa tornare
 * mentre il rendering abbandonato e' ancora in volo e il servizio e' al peggio.
 */
export const RETRY_AFTER_TIMEOUT_SECONDS = LIMITS.retryAfterTimeoutSeconds;
/** Richieste al minuto per token, quando il file dei token non ne dichiara uno. */
export const DEFAULT_RPM = LIMITS.defaultRpm;
/** La finestra su cui si conta il limite al minuto. */
export const RATE_WINDOW_MS = LIMITS.rateWindowMs;

/** Corpo della richiesta: 2 MiB, circa 60.000 coordinate. Mai il default di Express. */
export const MAX_BODY_BYTES = LIMITS.maxBodyBytes;
/** Pixel della pagina. Un A4 a 300 dpi ne fa 8,7 milioni; il tetto lascia margine fino a ~350 dpi. */
export const MAX_PIXELS = LIMITS.maxPixels;
/** Lato massimo in pixel: un A4 a 300 dpi e' 2480 x 3508. */
export const MAX_SIDE = LIMITS.maxSide;
export const MIN_DPI = LIMITS.minDpi;
export const MAX_DPI = LIMITS.maxDpi;
/** Feature e coordinate della FeatureCollection: una mappa d'insieme sta ampiamente sotto. */
export const MAX_FEATURES = LIMITS.maxFeatures;
export const MAX_COORDINATES = LIMITS.maxCoordinates;
/** Zoom: oltre non esistono dati, e il DEM si ferma prima. */
export const MAX_ZOOM = LIMITS.maxZoom;
export const DEFAULT_MAX_ZOOM = LIMITS.defaultMaxZoom;
/** Margine attorno all'inquadratura, in millimetri di carta, quando non viene chiesto. */
export const DEFAULT_PADDING_MM = LIMITS.defaultPaddingMm;
/** Spessore del tratto di una traccia (simplestyle-spec), in pixel css. */
export const MAX_STROKE_WIDTH = LIMITS.maxStrokeWidth;

// ----------------------------------------------------------------- gli errori

/** Slot tutti occupati: 503 con Retry-After, nessuna coda interna (R7). */
export class SlotsBusyError extends Error {
  constructor(retryAfterSeconds = RETRY_AFTER_SECONDS) {
    super('tutti i rendering disponibili sono occupati');
    this.name = 'SlotsBusyError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Il rendering ha superato il tempo massimo: 504 (R16). */
export class RenderTimeoutError extends Error {
  constructor(ms) {
    super(`il rendering ha superato il tempo massimo di ${ms} ms`);
    this.name = 'RenderTimeoutError';
    this.timeoutMs = ms;
  }
}

/** Troppe richieste per quel token: 429 con Retry-After (R8). */
export class RateLimitError extends Error {
  constructor(retryAfterSeconds) {
    super('limite di richieste al minuto superato per questo token');
    this.name = 'RateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// ----------------------------------------------------------------- il contatore

/**
 * Gli slot, il tempo massimo e il limite al minuto per chiave (il token).
 *
 * `now` si inietta per i test; le chiavi non vengono mai scritte nei log.
 */
export function createLimits({
  slots = MAX_SLOTS,
  renderTimeoutMs = RENDER_TIMEOUT_MS,
  windowMs = RATE_WINDOW_MS,
  retryAfterSeconds = RETRY_AFTER_SECONDS,
  now = () => Date.now(),
} = {}) {
  let inUse = 0;
  /** rendering VERI ancora in corso, compresi quelli abbandonati alla scadenza */
  let inFlight = 0;
  /** chiave -> istanti delle richieste accettate nella finestra */
  const hits = new Map();

  return {
    slots,
    renderTimeoutMs,
    freeSlots: () => slots - inUse,
    /** Quanti rendering stanno davvero girando: lo misurano i test di R7/R16. */
    inFlight: () => inFlight,

    /**
     * Conta una richiesta per `key` e lancia `RateLimitError` se supera `rpm`.
     * Si chiama PRIMA di prendere lo slot: il limite vale sulle richieste, non
     * sui rendering riusciti.
     */
    checkRate(key, rpm = DEFAULT_RPM) {
      const t = now();
      const recent = (hits.get(key) ?? []).filter(x => t - x < windowMs);
      if (recent.length >= rpm) {
        hits.set(key, recent);
        const wait = Math.ceil((windowMs - (t - recent[0])) / 1000);
        throw new RateLimitError(Math.max(1, wait));
      }
      recent.push(t);
      hits.set(key, recent);
      // le chiavi che non chiamano piu' non devono restare in memoria per sempre
      if (hits.size > 1000) for (const [k, v] of hits) if (!v.some(x => t - x < windowMs)) hits.delete(k);
    },

    /**
     * Esegue `fn` dentro uno slot e con il tempo massimo. Lo slot si libera in un
     * `finally`, quindi anche se `fn` lancia o non finisce mai: in quel secondo
     * caso il rendering resta in volo (non c'e' modo di annullare una render()
     * di maplibre-native) ma non occupa piu' lo slot.
     *
     * Il posto occupato lo tiene allora `inFlight`, che cala solo quando il
     * rendering abbandonato si risolve o fallisce davvero: finche' resta pieno,
     * chi arriva riceve `SlotsBusyError` e quindi 503, invece di far partire un
     * altro rendering sopra quelli che nessuno aspetta piu'.
     */
    async run(fn) {
      if (inUse >= slots || inFlight >= slots) throw new SlotsBusyError(retryAfterSeconds);
      inUse++;
      inFlight++;
      let timer = null;
      try {
        const work = Promise.resolve().then(fn);
        // il contatore dei rendering in volo cala QUI, non nel finally: il finally
        // corre alla scadenza, `work` no. Vale anche da rifiuto gestito, cosi' un
        // errore arrivato dopo il timeout non e' un unhandled rejection.
        work.then(() => { inFlight--; }, () => { inFlight--; });
        const deadline = new Promise((_, ko) => {
          timer = setTimeout(() => ko(new RenderTimeoutError(renderTimeoutMs)), renderTimeoutMs);
        });
        return await Promise.race([work, deadline]);
      } finally {
        if (timer) clearTimeout(timer);
        inUse--;
      }
    },
  };
}
