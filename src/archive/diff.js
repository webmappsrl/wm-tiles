import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {PMTiles, tileIdToZxy} from 'pmtiles';
import {FileSource} from './store.js';

/**
 * Confronto tile per tile fra due archivi PMTiles.
 *
 * Funziona perche' planetiler e' deterministico: due giri sullo stesso PBF
 * danno tile identiche byte per byte (verificato su 7.491 tile). Quindi una
 * tile con byte diversi e' una tile con dati diversi. Non vale il contrario
 * in senso stretto — puo' essere cambiato un attributo che lo stile non
 * disegna — ma l'errore va nel verso sicuro: si rifa' un PNG in piu', mai
 * uno in meno.
 *
 * Si confrontano i byte come stanno nell'archivio, compressi. Un archivio
 * prodotto da uno strumento con gzip non deterministico darebbe solo falsi
 * positivi, non tile perse.
 */

/** Hash di ogni tile dell'archivio, chiave `z/x/y`. Il contenuto si legge una volta per offset: le tile duplicate (mare, bosco uniforme) condividono i dati. */
export async function hashTile(path) {
  const source = new FileSource(path);
  const p = new PMTiles(source);
  const header = await p.getHeader();
  const perOffset = new Map();
  const out = new Map();

  const visita = async (offset, length) => {
    const voci = await p.cache.getDirectory(source, offset, length, header);
    for (const e of voci) {
      if (e.runLength === 0) {
        // directory foglia
        await visita(header.leafDirectoryOffset + e.offset, e.length);
        continue;
      }
      let h = perOffset.get(e.offset);
      if (!h) {
        const {data} = await source.getBytes(header.tileDataOffset + e.offset, e.length);
        h = createHash('sha1').update(new Uint8Array(data)).digest('hex');
        perOffset.set(e.offset, h);
      }
      for (let k = 0; k < e.runLength; k++) {
        const [z, x, y] = tileIdToZxy(e.tileId + k);
        out.set(`${z}/${x}/${y}`, h);
      }
    }
  };
  await visita(header.rootDirectoryOffset, header.rootDirectoryLength);
  return {hash: out, minZoom: header.minZoom, maxZoom: header.maxZoom};
}

/**
 * Tile cambiate fra due archivi: diverse, aggiunte o tolte. Una tile tolta
 * conta quanto una cambiata — il PNG vecchio mostrerebbe ancora cio' che
 * non c'e' piu'. Se il vecchio archivio manca, sono cambiate tutte.
 */
export async function diffArchivio(vecchio, nuovo) {
  const b = await hashTile(nuovo);
  const a = vecchio && existsSync(vecchio) ? await hashTile(vecchio) : {hash: new Map()};
  const cambiate = [];
  for (const [k, h] of b.hash) if (a.hash.get(k) !== h) cambiate.push(k);
  for (const k of a.hash.keys()) if (!b.hash.has(k)) cambiate.push(k);
  return {
    cambiate: cambiate.map(k => {
      const [z, x, y] = k.split('/').map(Number);
      return {z, x, y};
    }),
    totale: b.hash.size,
    maxZoom: b.maxZoom,
    nuovoArchivio: a.hash.size === 0,
  };
}

/** Confronta gli archivi omonimi di due cartelle di versione. */
export async function diffVersioni(dirVecchia, dirNuova, archivi) {
  const out = {};
  for (const nome of archivi) {
    const nuovo = join(dirNuova, `${nome}.pmtiles`);
    if (!existsSync(nuovo)) continue;
    out[nome] = await diffArchivio(join(dirVecchia, `${nome}.pmtiles`), nuovo);
  }
  return out;
}
