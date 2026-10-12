/**
 * I verdetti dell'AI sulle difformita', nel repo perche' li veda il team.
 *
 * Un verdetto che dice "non e' stile" (contenuto, buco di TGen, limite del
 * motore) silenzia la difformita' solo finche' le misure restano quelle del
 * giudizio: se cambiano, il caso si riapre. Senza questa condizione un
 * "contenuto" di ieri nasconderebbe un difetto di stile introdotto oggi.
 */
import {existsSync, readFileSync} from 'node:fs';
import {deltaE} from './misure.js';

export const VERDETTI = ['stile', 'contenuto', 'buco-tgen', 'mancanza', 'motore'];
const SILENZIANO = new Set(['contenuto', 'buco-tgen', 'motore']);
// tolleranze oltre cui le misure "sono cambiate"
const TOLLERANZA = {dE: 5, presenza: 0.15, diffusione: 0.15};
// e quelle che non sono differenze semplici: il rapporto dei simboli si
// confronta in scala logaritmica, i pixel del residuo in proporzione, il
// colore locale in dE (un colore diverso con lo stesso dE e' un altro difetto)
const RAPPORTO = Math.log(1.5), PIXEL = 0.5, COLORE = 5;

export const leggi = percorso => (existsSync(percorso) ? JSON.parse(readFileSync(percorso, 'utf8')) : {});

export function registra(registro, {id, verdetto, motivo, giro, misure}) {
  if (!VERDETTI.includes(verdetto)) throw new Error(`verdetto "${verdetto}" sconosciuto: ${VERDETTI.join(', ')}`);
  return {...registro, [id]: {verdetto, motivo, giro, misure, data: new Date().toISOString().slice(0, 10)}};
}

const entrambi = (ora, allora, k) => ora[k] != null && allora[k] != null;
const cambiate = (ora, allora) => Object.entries(TOLLERANZA)
  .some(([k, t]) => entrambi(ora, allora, k) && Math.abs(ora[k] - allora[k]) > t)
  || (entrambi(ora, allora, 'rapporto')
    && Math.abs(Math.log(Math.max(1e-6, ora.rapporto)) - Math.log(Math.max(1e-6, allora.rapporto))) > RAPPORTO)
  || (entrambi(ora, allora, 'pixel') && Math.abs(ora.pixel - allora.pixel) / Math.max(1, allora.pixel) > PIXEL)
  || (entrambi(ora, allora, 'locale') && deltaE(ora.locale, allora.locale) > COLORE);

export function stato(d, registro) {
  const v = registro[d.id];
  if (!v) return 'aperta';
  if (!SILENZIANO.has(v.verdetto)) return 'da-correggere';
  return cambiate(d.misure, v.misure) ? 'riaperta' : 'giudicata';
}

export const bloccante = st => st !== 'giudicata';
