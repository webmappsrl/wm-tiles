import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {open} from 'node:fs/promises';
import {join} from 'node:path';
import {PMTiles} from 'pmtiles';

const VERSION_RE = /^\d{8}-\d{4}$/;
export const DEM_VERSION = 'dem';

/** Sorgente PMTiles su filesystem locale: range-request tradotte in letture posizionali. */
export class FileSource {
  constructor(path) {
    this.path = path;
  }

  getKey() {
    return this.path;
  }

  async getBytes(offset, length) {
    const fh = await open(this.path, 'r');
    try {
      const buf = Buffer.alloc(length);
      await fh.read(buf, 0, length, offset);
      return {data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)};
    } finally {
      await fh.close();
    }
  }
}

const handles = new Map();

function handle(archiveDir, version, archive) {
  const path = join(archiveDir, version, `${archive}.pmtiles`);
  const cached = handles.get(path);
  if (cached) return cached;
  if (!existsSync(path)) return null;
  const p = new PMTiles(new FileSource(path));
  handles.set(path, p);
  return p;
}

export function listVersions(archiveDir) {
  if (!existsSync(archiveDir)) return [];
  return readdirSync(archiveDir, {withFileTypes: true})
    .filter(e => e.isDirectory() && VERSION_RE.test(e.name))
    .map(e => e.name)
    .sort()
    .reverse();
}

export function currentVersion(archiveDir) {
  return listVersions(archiveDir)[0] ?? null;
}

export function isValidVersion(archiveDir, version) {
  return version === DEM_VERSION || listVersions(archiveDir).includes(version);
}

export function readProvenance(archiveDir, version) {
  const path = join(archiveDir, version, 'provenance.json');
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Metadati dell'archivio PMTiles: bounds, zoom disponibili, nomi dei layer. */
export async function archiveMeta(archiveDir, version, archive) {
  const p = handle(archiveDir, version, archive);
  if (!p) return null;
  const header = await p.getHeader();
  let vectorLayers = [];
  try {
    const md = await p.getMetadata();
    vectorLayers = (md?.vector_layers ?? []).map(l => l.id);
  } catch {
    /* metadati assenti o non leggibili: non e' un errore fatale */
  }
  return {
    minZoom: header.minZoom,
    maxZoom: header.maxZoom,
    bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
    center: [header.centerLon, header.centerLat, header.centerZoom],
    tileType: header.tileType,
    vectorLayers,
  };
}

export async function getTile(archiveDir, version, archive, z, x, y) {
  const p = handle(archiveDir, version, archive);
  if (!p) return null;
  const res = await p.getZxy(z, x, y);
  if (!res) return null;
  return new Uint8Array(res.data);
}
