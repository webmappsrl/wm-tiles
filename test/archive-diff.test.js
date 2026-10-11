import {describe, expect, it} from 'vitest';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {diffArchivio, hashTile} from '../src/archive/diff.js';
import {currentVersion} from '../src/archive/store.js';

/**
 * Lavora sugli archivi locali in data/, che non sono nel repo: senza dati i
 * test si saltano invece di fallire, come per il filtro.
 */
const ARCHIVES = 'data/archives';
const v = currentVersion(ARCHIVES);
const osm = v && join(ARCHIVES, v, 'osm.pmtiles');
const conDati = osm && existsSync(osm) ? describe : describe.skip;

conDati('diff fra archivi', () => {
  it('un archivio confrontato con se stesso non ha tile cambiate', async () => {
    const d = await diffArchivio(osm, osm);
    expect(d.totale).toBeGreaterThan(1000);
    expect(d.cambiate).toEqual([]);
  });

  it('enumera ogni tile: anche quelle che condividono i dati con altre', async () => {
    const {hash, maxZoom} = await hashTile(osm);
    // niente Math.max(...z): con centinaia di migliaia di tile supera il
    // limite di argomenti di una chiamata
    const zMax = [...hash.keys()].reduce((m, k) => Math.max(m, Number(k.split('/')[0])), 0);
    expect(zMax).toBe(maxZoom);
    // i dati duplicati (mare, bosco uniforme) sono meno delle tile
    expect(new Set(hash.values()).size).toBeLessThan(hash.size);
  });

  it('senza archivio vecchio sono cambiate tutte', async () => {
    const d = await diffArchivio('data/non-esiste.pmtiles', osm);
    expect(d.nuovoArchivio).toBe(true);
    expect(d.cambiate.length).toBe(d.totale);
  });
}, 60000);
