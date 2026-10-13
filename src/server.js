import express from 'express';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync, gzipSync} from 'node:zlib';
import {
  archiveMeta,
  currentVersion,
  getTile,
  isValidVersion,
  listVersions,
  readProvenance,
} from './archive/store.js';
import {filterLayers, layerNames} from './tiles/filter.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const PORT = Number(process.env.PORT ?? 8080);
// In produzione 127.0.0.1: da fuori si entra dal reverse proxy (infra/pubblica-dominio.sh)
const HOST = process.env.HOST;
// L'indirizzo pubblico, quando il server sta dietro una CDN (es. https://tiles.maphub.it)
const PUBLIC_URL = process.env.PUBLIC_URL?.replace(/\/$/, '') || undefined;
const ARCHIVE_DIR = process.env.ARCHIVE_DIR ?? join(ROOT, 'data/archives');
const MANIFEST_PATH = process.env.MANIFEST_PATH ?? join(ROOT, 'manifest/layers.v1.json');
const STYLE_PATH = process.env.STYLE_PATH ?? join(ROOT, 'style/webmapp.json');
const SETS_PATH = process.env.SETS_PATH ?? join(ROOT, 'data/sets.json');

const ATTRIBUTION = '© OpenMapTiles © OpenStreetMap contributors (ODbL)';
const ATTRIBUTION_DEM = '© DLR/ESA — Copernicus DEM GLO-30 | DTM 5m Regione Emilia-Romagna';
const ATTRIBUTION_LC = '© ESA WorldCover 2021';
const ATTRIBUTION_WM = '© Webmapp';
const ATTRIBUTION_IGM = '© IGM — DBSN';
const LEGACY_TILE_URL = 'https://api.webmapp.it/tiles/{z}/{x}/{y}.png';
export const ARCHIVES = ['osm', 'hillshade', 'contours', 'hiking', 'toponimi', 'rifugi', 'landcover', 'osmpoi', 'clc', 'roadslz', 'igm', 'power', 'parchi', 'extra', 'amenity'];

function log(level, msg, fields = {}) {
  const line = JSON.stringify({ts: new Date().toISOString(), level, msg, ...fields});
  if (level === 'error') console.error(line);
  else console.log(line);
}

// ---------------------------------------------------------------- manifest e set

function loadManifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
}

/** Identificatore del set: hash del contenuto, non auto-descrittivo, indipendente dall'ordine. */
/** Il nome di un'area della preview nell'indirizzo: l'etichetta senza
 * parentesi, in minuscolo, senza accenti, con i trattini. */
export const slugArea = s => s.toLowerCase().replace(/\(.*?\)/g, '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function setIdFor(groupIds) {
  const canonical = [...new Set(groupIds)].sort().join('\n');
  return createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

function layersForGroups(manifest, groupIds) {
  const byId = new Map(manifest.groups.map(g => [g.id, g]));
  const out = new Set();
  for (const id of groupIds) {
    const g = byId.get(id);
    if (!g) continue;
    for (const l of g.layers) out.add(l);
  }
  return [...out];
}

function loadSetRegistry(manifest) {
  const registry = new Map();
  registry.set(setIdFor(manifest.defaultSet), manifest.defaultSet);
  if (existsSync(SETS_PATH)) {
    const raw = JSON.parse(readFileSync(SETS_PATH, 'utf8'));
    for (const groups of Object.values(raw)) registry.set(setIdFor(groups), groups);
  }
  return registry;
}

function resolveSet(manifest, setId, registry) {
  const groups = registry.get(setId);
  if (!groups) {
    log('warn', 'set fallback', {setId, reason: 'unknown set', fallbackTo: 'defaultSet'});
    return {
      setId: setIdFor(manifest.defaultSet),
      groups: manifest.defaultSet,
      layers: layersForGroups(manifest, manifest.defaultSet),
      fallback: true,
    };
  }
  return {setId, groups, layers: layersForGroups(manifest, groups), fallback: false};
}

// ---------------------------------------------------------------- style

/**
 * `tileSize: 256` su OGNI sorgente vettoriale: senza questo il prototipo
 * mostra il livello sbagliato.
 *
 * OpenLayers costruisce le sorgenti vettoriali su una griglia da 512 px,
 * quindi a vista z13 chiede le tile z12, a z14 le z13 e cosi' via: un
 * livello di dettaglio in meno del riferimento raster, che e' a 256 px.
 * L'effetto non da' errori e si presenta come "mancano dei dati": i
 * torrenti, che lo schema OpenMapTiles introduce a z13, comparivano solo
 * dalla vista z14 — e allo stesso modo mancavano strade, curve e POI di un
 * livello. Dichiarando 256 i due lati chiedono lo stesso livello.
 *
 * Vale anche per map-core: il connettore deve dichiararlo, o la mappa
 * dell'app mostrera' meno dettaglio delle tiles raster che sostituisce.
 */
/** Data di modifica dell'indice dello sprite, per l'URL versionato. */
/**
 * Versioni delle quote e delle curve di livello, nel percorso come per lo
 * sprite. Hanno una cache di un anno: con un indirizzo fisso, dopo una
 * rigenerazione browser e CloudFront continuavano a servire quelle vecchie
 * (13 ottobre 2026, la cucitura corretta del DEM non arrivava). La versione e'
 * il momento di modifica dei dati: la cartella del terrain e l'archivio delle
 * curve vengono sostituiti, non riscritti, a ogni rigenerazione.
 */
const versioneDi = p => { try { return String(Math.floor(statSync(p).mtimeMs)); } catch { return '0'; } };
const demVer = () => versioneDi(join(ROOT, 'data/dem/terrain'));
const curveVer = () => versioneDi(join(ROOT, 'data/archives/dem/contours.pmtiles'));

let spriteVer = null;
function spriteVersione() {
  if (spriteVer !== null) return spriteVer;
  try {
    spriteVer = String(Math.floor(statSync(join(ROOT, 'style/sprite/webmapp.json')).mtimeMs));
  } catch { spriteVer = '0'; }
  return spriteVer;
}

/**
 * Livello massimo effettivamente generato per il DEM, letto dalle cartelle.
 * Tenerlo a mano si e' rivelato fragile: dopo aver rigenerato il terrain fino
 * a z16 la dichiarazione era rimasta a 14, e l'ombreggiatura mostrava righe
 * pixelate a z15 e z16 senza che nulla segnalasse l'incoerenza.
 */
let demMaxCache = null;
function demMaxZoom() {
  if (demMaxCache !== null) return demMaxCache;
  const dir = join(ROOT, 'data/dem/terrain');
  let max = 8;
  try {
    for (const nome of readdirSync(dir)) {
      const z = Number(nome);
      if (Number.isInteger(z) && z > max) max = z;
    }
  } catch { /* nessun terrain: resta il minimo */ }
  demMaxCache = max;
  return max;
}

function buildStyle(manifest, resolved, version, base) {
  const style = JSON.parse(readFileSync(STYLE_PATH, 'utf8'));

  style.sources = {
    // Passi, sorgenti, fontane e grotte estratti da OSM: lo schema
    // OpenMapTiles li filtra via, ma nel riferimento sono presenti.
    osmpoi: {
      type: 'vector',
      tileSize: 256,
      tiles: [`${base}/t/${version}/${resolved.setId}/osmpoi/{z}/{x}/{y}.pbf`],
      minzoom: 11,
      maxzoom: 14,
      attribution: ATTRIBUTION,
    },
    // Icone dei punti di interesse come amenity-points di TGen: chiese,
    // biblioteche, cinema, golf, parcheggi... Livello d'ingresso nel dato,
    // fino a z16 (pipeline/build-amenity.py).
    amenity: {
      type: 'vector',
      tileSize: 256,
      tiles: [`${base}/t/${version}/${resolved.setId}/amenity/{z}/{x}/{y}.pbf`],
      minzoom: 10,
      maxzoom: 16,
      attribution: ATTRIBUTION,
    },
    // Parchi nazionali e riserve naturali selezionati come TGen
    // (boundary=national_park OR leisure=nature_reserve), da z8.
    parchi: {
      type: 'vector',
      tileSize: 256,
      tiles: [`${base}/t/${version}/${resolved.setId}/parchi/{z}/{x}/{y}.pbf`],
      minzoom: 4,
      maxzoom: 14,
      attribution: ATTRIBUTION,
    },
    // Cio' che TGen disegna e OpenMapTiles non porta: dighe, frangiflutti, aree
    // stradali, filari, barriere, marine, nomi di ferrovie, edifici e ponti...
    // da z10 a z16 secondo il gruppo (pipeline/build-extra.sh).
    extra: {
      type: 'vector',
      tileSize: 256,
      tiles: [`${base}/t/${version}/${resolved.setId}/extra/{z}/{x}/{y}.pbf`],
      minzoom: 10,
      maxzoom: 14,
      attribution: ATTRIBUTION,
    },
    // Linee elettriche, tralicci e pali: OpenMapTiles non li porta, TGen li
    // disegna da z14 (power.mss).
    power: {
      type: 'vector',
      tileSize: 256,
      tiles: [`${base}/t/${version}/${resolved.setId}/power/{z}/{x}/{y}.pbf`],
      minzoom: 14,
      maxzoom: 14,
      attribution: ATTRIBUTION,
    },
    // Edifici dell'IGM (DBSN): TGen li disegna da z14 con la stessa regola
    // degli edifici OSM (`#buildings, #igm_edifc, #igm_edi_min` in
    // buildings.mss), sopra di essi.
    igm: {
      type: 'vector',
      tileSize: 256,
      tiles: [`${base}/t/${version}/${resolved.setId}/igm/{z}/{x}/{y}.pbf`],
      minzoom: 14,
      maxzoom: 14,
      attribution: ATTRIBUTION_IGM,
    },
    toponimi: {
      type: 'vector',
      tileSize: 256,
      tiles: [`${base}/t/${version}/${resolved.setId}/toponimi/{z}/{x}/{y}.pbf`],
      minzoom: 9,
      maxzoom: 14,
      attribution: ATTRIBUTION_WM,
    },
    rifugi: {
      type: 'vector',
      tileSize: 256,
      tiles: [`${base}/t/${version}/${resolved.setId}/rifugi/{z}/{x}/{y}.pbf`],
      minzoom: 10,
      maxzoom: 14,
      attribution: ATTRIBUTION_WM,
    },
    hiking: {
      type: 'vector',
      tileSize: 256,
      tiles: [`${base}/t/${version}/${resolved.setId}/hiking/{z}/{x}/{y}.pbf`],
      minzoom: 10,
      maxzoom: 14,
      attribution: ATTRIBUTION,
    },
    // Corine Land Cover: la fonte dell'uso suolo per z7-13, come in
    // project.mml (clc minzoom 7 maxzoom 13). I dati regionali ad alta
    // risoluzione entrano solo da z14 (minzoom 14 su tutti i layer uso*).
    clc: {
      type: 'vector',
      tileSize: 256,
      tiles: [`${base}/t/${version}/${resolved.setId}/clc/{z}/{x}/{y}.pbf`],
      minzoom: 7,
      maxzoom: 13,
      attribution: ATTRIBUTION_LC,
    },
    // Uso suolo VETTORIALE: i colori li decide lo stile, nitido a ogni scala.
    landcover: {
      type: 'vector',
      tileSize: 256,
      tiles: [`${base}/t/${version}/${resolved.setId}/landcover/{z}/{x}/{y}.pbf`],
      minzoom: 8,
      maxzoom: 14,
      attribution: ATTRIBUTION_LC,
    },
    // Il maxzoom deve seguire i livelli GENERATI: dichiararne uno piu' basso
    // fa ingrandire le tile dell'ultimo livello disponibile, e sul DEM
    // l'ingrandimento non sfoca — mostra i gradini della codifica come righe
    // pixelate nell'ombreggiatura.
    terrain: {
      type: 'raster-dem',
      tiles: [`${base}/dem/v${demVer()}/terrain/{z}/{x}/{y}.png`],
      tileSize: 256,
      minzoom: 8,
      maxzoom: demMaxZoom(),
      encoding: 'terrarium',
      attribution: ATTRIBUTION_DEM,
    },
    // Strade dei livelli bassi: lo schema OpenMapTiles a z10 porta 9 strade
    // sull'area, il riferimento ne disegna ~300. Archivio a parte, estratto
    // dal PBF, che copre solo le fasce dove serve.
    roadslz: {
      type: 'vector',
      tileSize: 256,
      tiles: [`${base}/t/${version}/${resolved.setId}/roadslz/{z}/{x}/{y}.pbf`],
      minzoom: 8,
      // le strade arrivano a z11, i cartellini a z12: a z12 le tile hanno solo quelli
      maxzoom: 12,
      attribution: ATTRIBUTION,
    },
    contours: {
      type: 'vector',
      tileSize: 256,
      tiles: [`${base}/t/dem-v${curveVer()}/${resolved.setId}/contours/{z}/{x}/{y}.pbf`],
      minzoom: 10,
      // L'archivio arriva a z15: dichiarando 14 si usavano tile z14
      // sovraingrandite e le curve risultavano meno fitte del riferimento.
      maxzoom: 15,
      attribution: ATTRIBUTION_DEM,
    },
    openmaptiles: {
      type: 'vector',
      tileSize: 256,
      tiles: [`${base}/t/${version}/${resolved.setId}/osm/{z}/{x}/{y}.pbf`],
      minzoom: 0,
      maxzoom: 14,
      attribution: ATTRIBUTION,
    },
  };

  /**
   * Nell'URL dello sprite entra la sua data di modifica.
   *
   * Cambiare l'header `Cache-Control` non basta: una risposta gia' in cache
   * con `max-age` lungo resta valida per il browser, che non la rivalida
   * finche' non scade. Un URL nuovo e' l'unico modo per raggiungere chi ha
   * gia' la copia vecchia — ed e' successo davvero: gli scudi stradali erano
   * invisibili perche' il browser usava un atlante senza quelle icone.
   *
   * La versione sta nel PERCORSO e non in un parametro: lo Style Spec accoda
   * `.json` e `.png` all'URL dichiarato, e un `?v=1` diventerebbe `?v=1.json`.
   */
  style.sprite = String(style.sprite ?? '')
    .replace('{BASE}', base)
    .replace('/sprite/', `/sprite/v${spriteVersione()}/`) || undefined;
  style.glyphs = String(style.glyphs ?? '').replace('{BASE}', base) || undefined;

  style.metadata = {
    ...(style.metadata ?? {}),
    'wm:version': version,
    'wm:set': resolved.setId,
    'wm:setFallback': resolved.fallback,
    'wm:groups': manifest.groups,
  };

  return style;
}

// ---------------------------------------------------------------- app

export function createApp() {
  const app = express();
  // In produzione il server sta dietro Caddy, che termina HTTPS. Senza fidarsi
  // del suo X-Forwarded-Proto `req.protocol` resta `http`: lo stile punta a
  // tile http:// e una pagina https le blocca come contenuto misto, mappa
  // vuota. Solo dal loopback, cosi' nessun client esterno puo' falsarlo.
  app.set('trust proxy', 'loopback');
  const manifest = loadManifest();
  const sets = loadSetRegistry(manifest);

  app.get('/health', (_req, res) => res.json({status: 'ok'}));

  app.get('/version', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    const current = currentVersion(ARCHIVE_DIR);
    if (!current) {
      res.status(503).json({error: 'nessun archivio pubblicato', archiveDir: ARCHIVE_DIR});
      return;
    }
    res.json({
      current,
      retained: listVersions(ARCHIVE_DIR),
      provenance: readProvenance(ARCHIVE_DIR, current),
      archives: {
        osm: await archiveMeta(ARCHIVE_DIR, current, 'osm'),
        hillshade: await archiveMeta(ARCHIVE_DIR, 'dem', 'hillshade'),
        contours: await archiveMeta(ARCHIVE_DIR, 'dem', 'contours'),
      },
    });
  });

  app.get('/manifest', (_req, res) => {
    res.set('Cache-Control', 'no-cache, must-revalidate');
    res.json(manifest);
  });

  app.get('/sets/:set', (req, res) => res.json(resolveSet(manifest, req.params.set, sets)));

  app.get('/style.json', (req, res) => {
    const version = currentVersion(ARCHIVE_DIR);
    if (!version) {
      res.status(503).json({error: 'nessun archivio pubblicato'});
      return;
    }
    const requested = typeof req.query.set === 'string' ? req.query.set : setIdFor(manifest.defaultSet);
    const resolved = resolveSet(manifest, requested, sets);
    // Dietro CloudFront il server riceve l'Host dell'origine, non quello pubblico:
    // costruendo gli URL dalla richiesta, lo stile manderebbe i client
    // direttamente all'origine, scavalcando la cache. PUBLIC_URL lo fissa.
    const base = PUBLIC_URL ?? `${req.protocol}://${req.get('host')}`;
    // Lo stile porta la versione dell'archivio nelle URL delle tile: se venisse
    // cachato, dopo un nuovo build il client continuerebbe a chiedere tile di una
    // versione che non e' piu' la corrente e riceverebbe 204 — mappa vuota senza
    // alcun errore. Va rivalidato sempre; le tile, che sono immutabili per
    // costruzione, restano cacheabili per un anno.
    res.set({'Cache-Control': 'no-cache, must-revalidate', 'Access-Control-Allow-Origin': '*'});
    res.json(buildStyle(manifest, resolved, version, base));
  });

  // Namespace riservato alle tiles verificate: la forma di URL e' fissata da ora.
  app.get('/p/:version/:set/:archive/:z/:x/:y.pbf', (_req, res) => {
    res.status(501).json({error: 'verified namespace non implementato in questo ciclo'});
  });

  app.get('/t/:version/:set/:archive/:z/:x/:y.:ext', async (req, res) => {
    const {set, archive, ext} = req.params;
    // dem-v<n>: la versione delle curve nell'indirizzo, solo per la cache
    const version = /^dem-v\d+$/.test(req.params.version) ? 'dem' : req.params.version;
    const z = Number(req.params.z);
    const x = Number(req.params.x);
    const y = Number(req.params.y);

    if (![z, x, y].every(Number.isInteger)) {
      res.status(400).json({error: 'coordinate non valide'});
      return;
    }
    if (!ARCHIVES.includes(archive)) {
      res.status(400).json({error: `archivio non riconosciuto: ${archive}`});
      return;
    }
    if (!isValidVersion(ARCHIVE_DIR, version)) {
      res.status(404).json({error: `versione non disponibile: ${version}`});
      return;
    }
    if (z < 0 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) {
      res.status(400).json({error: 'coordinate fuori dalla griglia'});
      return;
    }

    const raw = await getTile(ARCHIVE_DIR, version, archive, z, x, y);
    if (!raw) {
      res.status(204).end();
      return;
    }

    const common = {
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
      'X-Attribution': ATTRIBUTION,
      'X-Tile-Version': version,
    };

    // L'hillshade e' raster: non ha layer da filtrare.
    if (archive === 'hillshade' || ext === 'png') {
      res.set({...common, 'Content-Type': 'image/png'});
      res.status(200).send(Buffer.from(raw));
      return;
    }

    const resolved = resolveSet(manifest, set, sets);
    const isGzip = raw.length > 1 && raw[0] === 0x1f && raw[1] === 0x8b;
    const plain = isGzip ? new Uint8Array(gunzipSync(raw)) : raw;

    const t0 = performance.now();
    const filtered = filterLayers(plain, resolved.layers);
    const filterMs = performance.now() - t0;

    res.set({
      ...common,
      'Content-Type': 'application/vnd.mapbox-vector-tile',
      'Content-Encoding': 'gzip',
      'X-Tile-Set': resolved.setId,
      'X-Filter-Ms': filterMs.toFixed(3),
      ...(resolved.fallback ? {'X-Tile-Set-Fallback': '1'} : {}),
    });
    res.status(200).send(gzipSync(Buffer.from(filtered)));
  });

  /** Diagnostica: quali layer contiene realmente una tile, prima e dopo il filtro. */
  app.get('/inspect/:version/:set/:archive/:z/:x/:y', async (req, res) => {
    const {version, set, archive} = req.params;
    const [z, x, y] = [req.params.z, req.params.x, req.params.y].map(Number);
    const raw = await getTile(ARCHIVE_DIR, version, archive, z, x, y);
    if (!raw) {
      res.status(404).json({error: 'tile assente'});
      return;
    }
    const isGzip = raw.length > 1 && raw[0] === 0x1f && raw[1] === 0x8b;
    const plain = isGzip ? new Uint8Array(gunzipSync(raw)) : raw;
    const resolved = resolveSet(manifest, set, sets);
    const filtered = filterLayers(plain, resolved.layers);
    res.json({
      version,
      set: resolved.setId,
      groups: resolved.groups,
      fallback: resolved.fallback,
      bytes: {stored: raw.length, plain: plain.length, filtered: filtered.length},
      layers: {
        inTile: layerNames(plain),
        allowed: resolved.layers,
        served: layerNames(filtered),
        removed: layerNames(plain).filter(n => !resolved.layers.includes(n)),
      },
    });
  });

  app.get('/preview/config.json', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      version: currentVersion(ARCHIVE_DIR),
      groups: manifest.groups,
      defaultSet: setIdFor(manifest.defaultSet),
      sets: [...sets.entries()].map(([setId, groups]) => ({setId, groups})),
      areas: (manifest.previewAreas ?? []).map(a => ({...a, slug: slugArea(a.label)})),
      legacyTileUrl: LEGACY_TILE_URL,
      pngTileUrl: '/png/{z}/{x}/{y}.png',
      styleUrl: '/style.json',
    });
  });

  // I PNG prodotti da pipeline/render-png.mjs, per vederli nella preview al
  // posto del riferimento. `no-cache`: si rigenerano sotto lo stesso percorso,
  // e una copia vecchia nel browser farebbe credere che il render non cambi.
  app.use('/png', express.static(join(ROOT, 'data/png'), {
    setHeaders: r => r.set('Cache-Control', 'no-cache'),
  }));

  // Un indirizzo per ogni area della preview, da mandare a chi deve guardare
  // un caso d'uso: /preview/appennino-tosco-emiliano apre gia' su quell'area.
  // Vale l'id o il nome dell'area (slugArea); la preview riscrive l'indirizzo
  // con quel nome quando si cambia area dal menu.
  app.get('/preview/:area', (req, res, next) => {
    const a = (manifest.previewAreas ?? []).find(x => x.id === req.params.area || slugArea(x.label) === req.params.area);
    if (!a) return next();
    res.redirect(302, `/preview/?area=${encodeURIComponent(a.id)}`);
  });

  // alla radice non c'e' nulla da servire: si va alla preview
  app.get('/', (req, res) => res.redirect(302, '/preview/'));
  app.use('/preview', express.static(join(HERE, 'preview/public'), {etag: true, maxAge: 0, cacheControl: true, setHeaders: r => r.set('Cache-Control', 'no-cache, must-revalidate')}));

  // Uso suolo (ESA WorldCover 10 m) reso come tile raster colorate.
  app.use(['/dem/terrain', '/dem/:ver/terrain'], express.static(join(ROOT, 'data/dem/terrain'), {
    maxAge: '365d',
    setHeaders: r => r.set('Access-Control-Allow-Origin', '*'),
  }));

  app.use('/dem/base', express.static(join(ROOT, 'data/dem/base'), {
    maxAge: '365d',
    setHeaders: r => r.set('Access-Control-Allow-Origin', '*'),
  }));

  app.use('/dem/landcover', express.static(join(ROOT, 'data/dem/landcover'), {
    maxAge: '365d',
    setHeaders: r => r.set('Access-Control-Allow-Origin', '*'),
  }));

  // Rilievo dell'area demo: tiles raster prodotte da gdal2tiles.
  // In produzione diventeranno un archivio PMTiles (o un COG servito
  // dinamicamente): qui sono una directory perche' l'area e' piccola.
  // Pendenza: nero con alpha proporzionale alla pendenza, l'approssimazione
  // di `comp-op: overlay` di #slope10m in webmapp.mss.
  app.use('/dem/slope', express.static(join(ROOT, 'data/dem/slope'), {
    maxAge: '365d',
    setHeaders: r => r.set('Access-Control-Allow-Origin', '*'),
  }));

  // Hillshade moltiplicativo: nero con alpha = intensita' dell'ombra, cosi'
  // il sovrapposto normale di MapLibre equivale al `comp-op: multiply` di Mapnik.
  app.use('/dem/hillshade-mul', express.static(join(ROOT, 'data/dem/hillshade-mul'), {
    maxAge: '365d',
    setHeaders: r => r.set('Access-Control-Allow-Origin', '*'),
  }));

  app.use('/dem/hillshade', express.static(join(ROOT, 'data/dem/hillshade'), {
    maxAge: '365d',
    setHeaders: r => r.set('Access-Control-Allow-Origin', '*'),
  }));

  /**
   * Sprite: atlas PNG + indice JSON, in 1x e 2x.
   *
   * `no-cache` come per lo style.json, e per la stessa ragione: lo sprite
   * cambia ogni volta che si aggiunge o si ricolora un'icona, e un browser
   * che ne tiene una copia vecchia non trova i simboli nuovi — li salta in
   * silenzio, senza errori. Gli scudi stradali sono rimasti invisibili
   * esattamente per questo, mentre in un browser pulito comparivano.
   *
   * `no-cache` non significa "non memorizzare": il browser conserva la copia
   * ma la rivalida con ETag, quindi di norma riceve un 304 e non riscarica
   * l'atlante.
   */
  // il segmento /v<mtime>/ e' solo un'etichetta per la cache: si scarta
  app.use(/^\/sprite\/v\d+\//, express.static(join(ROOT, 'style/sprite'), {
    setHeaders: r => {
      r.set('Cache-Control', 'no-cache, must-revalidate');
      r.set('Access-Control-Allow-Origin', '*');
    },
  }));
  app.use('/sprite',
    // Il segmento /v<mtime>/ e' solo un'etichetta per la cache: si toglie
    // dal percorso prima di cercare il file. Serve un middleware perche' una
    // route con espressione regolare non riscrive il percorso per
    // express.static.
    (req, _res, next) => { req.url = req.url.replace(/^\/v\d+\//, '/'); next(); },
    express.static(join(ROOT, 'style/sprite'), {
      setHeaders: r => {
        r.set('Cache-Control', 'no-cache, must-revalidate');
        r.set('Access-Control-Allow-Origin', '*');
      },
    }));

  // Glifi generati in locale: nessuna dipendenza da CDN esterni, e sono gli
  // stessi che finiranno nella cache offline nel ciclo successivo.
  app.use('/glyphs', express.static(join(ROOT, 'style/glyphs'), {
    maxAge: '365d',
    setHeaders: r => r.set('Access-Control-Allow-Origin', '*'),
  }));

  return app;
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('server.js');
if (invokedDirectly) {
  createApp().listen(PORT, HOST, () => {
    log('info', 'server in ascolto', {port: PORT, archiveDir: ARCHIVE_DIR});
    console.log(`\n  preview:  http://localhost:${PORT}/preview`);
    console.log(`  versione: http://localhost:${PORT}/version\n`);
  });
}
