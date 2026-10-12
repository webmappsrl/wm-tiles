import {afterEach, describe, expect, it, vi} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {scaricaTgen} from '../src/revisione/tgen.js';

/**
 * Review 9: un 404 e' contenuto (TGen non ha la tile), un 5xx o un errore di
 * rete no. Trattarli allo stesso modo cambiava il campione da un giro
 * all'altro, e un errore di rete faceva cadere il giro.
 */
const risposta = status => ({ok: status === 200, status, arrayBuffer: async () => new ArrayBuffer(4)});
afterEach(() => vi.unstubAllGlobals());

describe('scaricaTgen', () => {
  it('404: null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => risposta(404)));
    expect(await scaricaTgen('9/1/1', mkdtempSync(join(tmpdir(), 'tg-')))).toBeNull();
  });
  it('503 poi 200: riprova e scrive', async () => {
    const f = vi.fn().mockResolvedValueOnce(risposta(503)).mockResolvedValueOnce(risposta(200));
    vi.stubGlobal('fetch', f);
    expect(await scaricaTgen('9/1/2', mkdtempSync(join(tmpdir(), 'tg-')))).toMatch(/9-1-2\.png$/);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('errori che non passano: eccezione, non null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => risposta(500)));
    await expect(scaricaTgen('9/1/3', mkdtempSync(join(tmpdir(), 'tg-')))).rejects.toThrow(/500/);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); }));
    await expect(scaricaTgen('9/1/4', mkdtempSync(join(tmpdir(), 'tg-')))).rejects.toThrow(/ECONNRESET/);
  });
});
