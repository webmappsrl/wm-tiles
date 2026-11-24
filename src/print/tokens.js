/**
 * I token degli shard che possono chiedere una mappa da stampare (R8).
 *
 * Stanno in un file FUORI dal repo, che e' pubblico su GitHub: il percorso
 * arriva da `PRINT_TOKENS_PATH`, come `SETS_PATH` per i set dei layer. Senza
 * quel file il servizio parte lo stesso e risponde 401 a tutti: un deploy senza
 * token e' un endpoint chiuso, non un endpoint aperto.
 *
 * Il formato e' un oggetto JSON, un token per chiave:
 *
 *   {
 *     "<token segreto>": {"shard": "maphub", "rpm": 30},
 *     "<altro token>":   {"shard": "sentieri-sardegna"}
 *   }
 *
 * `shard` serve ai log (si registra CHI ha chiamato, mai cosa conteneva la
 * richiesta: R11); `rpm` e' il limite al minuto di quello shard, e senza vale
 * `DEFAULT_RPM`. Il token non finisce mai in un log, nemmeno troncato.
 */
import {readFileSync} from 'node:fs';
import {DEFAULT_RPM} from './limits.js';
import {LIMITS} from './schema.js';

/**
 * Un token piu' corto di cosi' non e' un segreto. Il numero lo dichiara lo
 * schema (`securitySchemes.shardToken.x-wm-min-token-length`), che e' anche cio'
 * che legge chi configura lo shard: qui non se ne tiene una seconda copia.
 */
export const MIN_TOKEN_LENGTH = LIMITS.minTokenLength;

/**
 * @param {string|undefined} path percorso del file dei token
 * @returns {Map<string, {shard: string, rpm: number}>} vuota se il percorso non
 *   e' dato o il file non c'e'; lancia se il file c'e' ma non si capisce — un
 *   file malformato e' un errore di deploy, non un servizio senza token.
 */
export function loadTokens(path) {
  if (!path) return new Map();
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return new Map();
    throw e;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // il messaggio non riporta il contenuto del file: dentro ci sono i segreti
    throw new Error(`il file dei token non e' JSON valido: ${path}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`il file dei token deve contenere un oggetto {token: {shard, rpm}}: ${path}`);
  }
  const out = new Map();
  let i = 0;
  for (const [token, value] of Object.entries(parsed)) {
    i++;
    // gli errori citano la POSIZIONE, non il token: un messaggio che riporta un
    // segreto finisce nei log di avvio
    if (typeof token !== 'string' || token.length < MIN_TOKEN_LENGTH) {
      throw new Error(`token numero ${i}: deve essere lungo almeno ${MIN_TOKEN_LENGTH} caratteri`);
    }
    if (!value || typeof value !== 'object' || typeof value.shard !== 'string' || !value.shard) {
      throw new Error(`token numero ${i}: manca il campo shard`);
    }
    const rpm = value.rpm ?? DEFAULT_RPM;
    if (typeof rpm !== 'number' || !Number.isInteger(rpm) || rpm <= 0) {
      throw new Error(`token numero ${i}: rpm deve essere un intero positivo`);
    }
    out.set(token, {shard: value.shard, rpm});
  }
  return out;
}
