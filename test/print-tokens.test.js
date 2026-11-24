import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {MIN_TOKEN_LENGTH, loadTokens} from '../src/print/tokens.js';
import {DEFAULT_RPM} from '../src/print/limits.js';

/**
 * Il file dei token decide chi puo' chiamare l'unica rotta in SCRITTURA del
 * server (R8), quindi i suoi rami vanno tutti coperti: il percorso assente e il
 * file che non c'e' devono dare un endpoint CHIUSO (Map vuota, 401 a tutti),
 * mentre un file che c'e' ma non si capisce deve FERMARE l'avvio — un deploy con
 * un token malformato e' un errore di deploy, non un servizio senza token.
 *
 * E il messaggio non deve mai riportare il token: finirebbe nei log di avvio (R11).
 */

const dir = mkdtempSync(join(tmpdir(), 'wm-print-tokens-'));
let n = 0;
/** Scrive un file di token e restituisce il percorso. */
const file = content => {
  const path = join(dir, `tokens-${n++}.json`);
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
  return path;
};

const SECRET = 'token-segretissimo-0123456789abcdef';

describe('loadTokens', () => {
  it('senza percorso la mappa e\' vuota: l\'endpoint e\' chiuso, non aperto', () => {
    expect(loadTokens(undefined).size).toBe(0);
    expect(loadTokens('').size).toBe(0);
  });

  it('con un file che non esiste la mappa e\' vuota, senza lanciare', () => {
    expect(loadTokens(join(dir, 'questo-file-non-esiste.json')).size).toBe(0);
  });

  it('un file che non e\' JSON ferma l\'avvio, e il messaggio non riporta il contenuto', () => {
    const path = file(`{"${SECRET}": {"shard": "maphub"`);
    expect(() => loadTokens(path)).toThrow(/non e' JSON valido/);
    try {
      loadTokens(path);
    } catch (e) {
      expect(e.message).not.toContain(SECRET);
      expect(e.message).toContain(path); // il percorso si', il contenuto no
    }
  });

  it('un JSON che non e\' un oggetto di token ferma l\'avvio', () => {
    for (const content of ['[]', '"stringa"', 'null', '42']) {
      expect(() => loadTokens(file(content))).toThrow(/deve contenere un oggetto/);
    }
  });

  it(`un token piu' short di ${MIN_TOKEN_LENGTH} caratteri ferma l'avvio`, () => {
    const short = 'troppo-short';
    expect(short.length).toBeLessThan(MIN_TOKEN_LENGTH);
    const path = file({[short]: {shard: 'maphub'}});
    expect(() => loadTokens(path)).toThrow(/almeno 24 caratteri/);
  });

  it('un token senza shard ferma l\'avvio', () => {
    for (const value of [{}, {rpm: 10}, {shard: ''}, {shard: 7}, null, 'maphub']) {
      expect(() => loadTokens(file({[SECRET]: value}))).toThrow(/manca il campo shard/);
    }
  });

  it('un rpm che non e\' un intero positivo ferma l\'avvio', () => {
    // NaN e Infinity non servono: JSON non li sa scrivere, diventano `null` e
    // `null` vale «non dichiarato», cioe' DEFAULT_RPM
    for (const rpm of [0, -1, 1.5, '30', true, []]) {
      expect(() => loadTokens(file({[SECRET]: {shard: 'maphub', rpm}}))).toThrow(/rpm deve essere un intero positivo/);
    }
  });

  it('l\'errore cita la POSIZIONE del token, mai il token (R11)', () => {
    const good = 'primo-token-good-0123456789abcd';
    const path = file({[good]: {shard: 'uno'}, [SECRET]: {shard: 'due', rpm: 0}});
    try {
      loadTokens(path);
      throw new Error('doveva lanciare');
    } catch (e) {
      expect(e.message).toContain('token numero 2');
      expect(e.message).not.toContain(SECRET);
      expect(e.message).not.toContain(good);
      // nemmeno un pezzo: un segreto troncato resta un segreto
      expect(e.message).not.toContain(SECRET.slice(0, 8));
    }
  });

  it('un file valido da\' shard e rpm, con DEFAULT_RPM quando manca', () => {
    const other = 'secondo-token-good-0123456789ab';
    const tokens = loadTokens(file({
      [SECRET]: {shard: 'maphub', rpm: 12},
      [other]: {shard: 'sentieri-sardegna'},
    }));
    expect(tokens.size).toBe(2);
    expect(tokens.get(SECRET)).toEqual({shard: 'maphub', rpm: 12});
    expect(tokens.get(other)).toEqual({shard: 'sentieri-sardegna', rpm: DEFAULT_RPM});
    // niente altro passa: un campo in piu' nel file non diventa un campo in memoria
    expect(Object.keys(tokens.get(SECRET))).toEqual(['shard', 'rpm']);
  });
});
