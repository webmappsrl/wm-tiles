import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {describe, expect, it} from 'vitest';
import {compareTile, diffPixels, hashTiles, NOISE_MAX_PIXELS} from '../tools/png-identity.mjs';

// hashTiles rende davvero con maplibre-native: serve il server acceso (npm run dev)
const BASE = process.env.WM_BASE ?? 'http://localhost:8080';
const TILE = '14/8668/5972';

// immagine sintetica 16x16 RGB, con `edits` = [[pixel, canale, nuovo valore]]
const W = 16;
const image = (edits = []) => {
  const data = Buffer.alloc(W * W * 3, 100);
  for (const [p, c, v] of edits) data[p * 3 + c] = v;
  return {data, width: W, height: W, channels: 3};
};
const png = img => sharp(img.data, {raw: {width: img.width, height: img.height, channels: 3}}).png().toBuffer();
const refOf = img => ({hash: createHash('sha256').update(img.data).digest('hex'), width: img.width, height: img.height});

describe('png-identity', () => {
  it('hashTiles rende la tile e restituisce lo sha256 dei pixel', async () => {
    const a = await hashTiles([TILE], BASE);
    expect(a.get(TILE)).toMatch(/^[0-9a-f]{64}$/);
  }, 120000);

  it('un server spento da un errore, non un hash vuoto', async () => {
    await expect(hashTiles([TILE], 'http://localhost:1')).rejects.toThrow();
  }, 60000);

  it('diffPixels conta i pixel e il delta massimo', () => {
    expect(diffPixels(image(), image([[3, 0, 101], [3, 1, 97]]))).toEqual({pixels: 1, maxDelta: 3});
    expect(diffPixels(image(), {...image(), width: 8})).toBeNull();
  });

  it('compareTile: resa identica, rumore (1 pixel, 1 livello) accettato', async () => {
    const ref = image();
    expect((await compareTile('t', refOf(ref), ref, await png(ref))).ok).toBe(true);
    const noisy = image([[5, 2, 101]]);
    expect((await compareTile('t', refOf(ref), ref, await png(noisy))).ok).toBe(true);
  });

  it('compareTile: un pixel di 40 livelli e troppi pixel sono differenze vere', async () => {
    const ref = image();
    const big = image([[5, 0, 140]]);
    const r1 = await compareTile('t', refOf(ref), ref, await png(big));
    expect(r1.ok).toBe(false);
    const many = image(Array.from({length: NOISE_MAX_PIXELS + 1}, (_, p) => [p, 0, 101]));
    expect((await compareTile('t', refOf(ref), ref, await png(many))).ok).toBe(false);
  });

  it('compareTile: dimensioni diverse falliscono subito con un messaggio chiaro', async () => {
    const ref = image();
    const r = await compareTile('t', refOf(ref), ref, await png({...image(), width: 8, height: 8, data: Buffer.alloc(8 * 8 * 3, 100)}));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/dimensioni diverse/);
  });
});
