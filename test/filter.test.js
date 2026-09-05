import {describe, expect, it} from 'vitest';
import {readFileSync, existsSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {filterLayers, layerNames} from '../src/tiles/filter.js';
import {currentVersion, getTile} from '../src/archive/store.js';

const ARCHIVES = 'data/archives';

/**
 * Il filtro e' il controllo di accesso del sistema: questi test verificano
 * l'ASSENZA dei layer non abilitati, non solo la presenza di quelli attesi.
 * Un filtro che "dimentica" di rimuovere un layer non produce nessun errore
 * visibile — produce un'esposizione silenziosa.
 */

const FIXTURE = 'test/fixtures/tile.mvt';

/** La fixture si estrae dall'archivio locale al primo run. */
async function loadTile() {
  if (existsSync(FIXTURE)) return new Uint8Array(readFileSync(FIXTURE));
  const v = currentVersion(ARCHIVES);
  if (!v) return null;
  // cerca una tile densa: piu' layer = test piu' significativo
  let best = null;
  for (let x = 8655; x < 8670; x++) {
    for (let y = 5935; y < 5950; y++) {
      const t = await getTile(ARCHIVES, v, 'osm', 14, x, y);
      if (!t) continue;
      const plain = t[0] === 0x1f && t[1] === 0x8b ? new Uint8Array(gunzipSync(t)) : t;
      const n = layerNames(plain).length;
      if (!best || n > best.n) best = {n, plain};
    }
  }
  if (!best) return null;
  const {mkdirSync, writeFileSync} = await import('node:fs');
  mkdirSync('test/fixtures', {recursive: true});
  writeFileSync(FIXTURE, best.plain);
  return best.plain;
}

const tile = await loadTile();

describe.skipIf(!tile)('layerNames', () => {
  it('elenca i layer presenti nella tile', () => {
    const names = layerNames(tile);
    expect(names.length).toBeGreaterThan(1);
  });

  it('su input vuoto restituisce lista vuota', () => {
    expect(layerNames(new Uint8Array(0))).toEqual([]);
  });
});

describe.skipIf(!tile)('filterLayers — controllo di accesso', () => {
  it('mantiene solo i layer consentiti', () => {
    const out = filterLayers(tile, ['water']);
    expect(layerNames(out)).toEqual(layerNames(tile).includes('water') ? ['water'] : []);
  });

  it('RIMUOVE ogni layer non consentito dal protobuf', () => {
    const all = layerNames(tile);
    const allowed = [all[0]];
    const removed = all.slice(1);
    expect(removed.length).toBeGreaterThan(0);
    const served = layerNames(filterLayers(tile, allowed));
    for (const name of removed) {
      expect(served, `il layer ${name} deve essere assente`).not.toContain(name);
    }
  });

  it('il nome di un layer rimosso non compare nei byte serviti', () => {
    const all = layerNames(tile);
    const removed = all.slice(1);
    const out = Buffer.from(filterLayers(tile, [all[0]])).toString('latin1');
    for (const name of removed) {
      expect(out.includes(name), `la stringa "${name}" non deve comparire nei byte`).toBe(false);
    }
  });

  it('e lossless sui layer mantenuti: byte identici all originale', () => {
    const all = filterLayers(tile, layerNames(tile));
    expect(Buffer.from(all).equals(Buffer.from(tile))).toBe(true);
  });

  it('un insieme vuoto produce una tile vuota, non un errore', () => {
    const out = filterLayers(tile, []);
    expect(layerNames(out)).toEqual([]);
    expect(out.byteLength).toBe(0);
  });

  it('layer consentiti ma assenti non aggiungono nulla', () => {
    const first = layerNames(tile)[0];
    expect(layerNames(filterLayers(tile, [first, 'layer-inesistente']))).toEqual([first]);
  });

  it('non modifica la tile in ingresso', () => {
    const copy = new Uint8Array(tile);
    filterLayers(tile, [layerNames(tile)[0]]);
    expect(Buffer.from(tile).equals(Buffer.from(copy))).toBe(true);
  });

  it('su input vuoto restituisce vuoto senza lanciare', () => {
    expect(filterLayers(new Uint8Array(0), ['water']).byteLength).toBe(0);
  });

  it('resta sotto il budget di latenza dichiarato (0,5 ms per tile)', () => {
    const allowed = layerNames(tile).slice(0, 3);
    const N = 500;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) filterLayers(tile, allowed);
    const ms = (performance.now() - t0) / N;
    expect(ms, `media misurata ${ms.toFixed(4)} ms`).toBeLessThan(0.5);
  });
});
