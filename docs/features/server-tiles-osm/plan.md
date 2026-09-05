# wm-tiles — Piano di implementazione (primo ciclo: backend + preview)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produrre e servire la cartografia Webmapp in forma vettoriale da OpenStreetMap + DEM, con filtro dei livelli per set, output raster derivato dallo stesso stile, e una pagina di preview con cui validare la parita' visiva rispetto alle PNG attuali.

**Architecture:** Una pipeline batch (planetiler + GDAL) produce archivi PMTiles immutabili e versionati su object storage non pubblico. Un servizio Node/TypeScript stateless legge gli archivi via range-request, rimuove dal protobuf i layer non abilitati per il set richiesto e serve `.pbf`; lo stesso servizio rende `.png` dallo stesso stile e ospita la pagina di preview. La CDN sta davanti al servizio, non davanti allo storage.

**Tech Stack:** Node.js 22 + TypeScript, Vitest, Express, `pmtiles`, `pbf`, MapLibre GL JS (preview), `@maplibre/maplibre-gl-native` (raster, con fallback `tileserver-gl`), planetiler (Java), GDAL, tippecanoe, Docker Compose.

**Spec:** `docs/features/server-tiles-osm/overview.md`

## Global Constraints

- **Nessun ticket Orchestrator.** Scope dei commit: `feat(server-tiles-osm): ...`, `fix(server-tiles-osm): ...`, `refactor(server-tiles-osm): ...`.
- **Nessun commit automatico.** I passi di commit in questo piano sono istruzioni per il developer. Non eseguire `git commit`, `git add`, `git push` senza conferma esplicita per ciascun commit.
- **Branch:** `feature/server-tiles-osm` in `wm-tiles`. Creare prima di modificare qualsiasi file.
- **Zoom:** generazione `z0-z14`. Nessun livello oltre z14 viene generato; z15+ sono overzoom lato renderer.
- **Schema:** OpenMapTiles (fornito da planetiler), estratto **Italia**.
- **La versione dell'archivio e il set sono SEMPRE nel path** di ogni URL di tile: `/{namespace}/{version}/{set}/{z}/{x}/{y}.{ext}`. Mai in header, mai in query string, mai dedotti da token: la CDN deve poter cachare per URL senza `Vary`.
- **Due namespace dal primo giorno:** `/t/` (pubblico, cacheabile) e `/p/` (destinato alle tiles verificate, in questo ciclo risponde `501 Not Implemented`). Nessun altro namespace di tile.
- **Il set non e' auto-descrittivo:** e' un hash del contenuto dell'insieme dei gruppi, risolto server-side. Non deve mai essere possibile ricostruire l'insieme leggendo il path.
- **Un solo punto di applicazione del filtro** in tutto il codice: `src/tiles/filter.ts`. Nessun altro modulo seleziona layer.
- **L'archivio PMTiles non e' pubblicamente accessibile.** Il servizio e' l'unico lettore autorizzato. In sviluppo locale l'archivio sta su filesystem non servito staticamente.
- **Ogni fallback emette un log strutturato a livello `warn`** con il motivo. Nessun fallback silenzioso.
- **Attribuzione:** ogni output porta `© OpenStreetMap contributors (ODbL)` e, dove il rilievo e' presente, l'attribuzione Tinitaly/INGV. Vale anche per gli output raster.
- **Node 22, TypeScript strict, ESM.** Nessun `any` implicito.
- **Test:** Vitest. Ogni task chiude con test verdi eseguiti, non assunti.

---

## File Structure

```
wm-tiles/
├── docker-compose.yml              # servizio + volume archivi
├── Dockerfile                      # runtime Node del servizio
├── package.json / tsconfig.json / vitest.config.ts
├── .env.example
├── pipeline/
│   ├── Dockerfile.planetiler       # planetiler + GDAL + tippecanoe
│   ├── build-osm.sh                # estratto OSM -> pmtiles + provenienza
│   ├── build-hillshade.sh          # DEM -> hillshade pmtiles (una volta)
│   ├── build-contours.sh           # DEM -> contours pmtiles (una volta)
│   ├── publish.sh                  # pubblicazione atomica + versione
│   └── mirror.sh                   # mirroring degli input
├── style/
│   ├── webmapp.json                # stile base (artefatto versionato)
│   ├── sprite/                     # icone
│   └── glyphs/                     # font PBF
├── manifest/
│   └── layers.v1.json              # manifest dei gruppi (contratto pubblico)
├── src/
│   ├── server.ts                   # composizione app Express, avvio
│   ├── config.ts                   # env, path archivi, ritenzione
│   ├── archive/
│   │   ├── store.ts                # apertura PMTiles, cache handle, getTile
│   │   └── versions.ts             # elenco versioni, versione corrente, ritenzione
│   ├── manifest/
│   │   ├── schema.ts               # tipi + validazione del manifest
│   │   └── registry.ts             # gruppi -> layer tecnici, classe, attributi
│   ├── sets/
│   │   └── resolve.ts              # hash del set, risoluzione, fallback
│   ├── tiles/
│   │   ├── filter.ts               # UNICO punto di filtro sul protobuf
│   │   └── routes.ts               # /t/ e /p/, .pbf
│   ├── raster/
│   │   ├── render.ts               # rendering dallo stile
│   │   ├── cache.ts                # cache persistente su disco
│   │   └── routes.ts               # .png
│   ├── preview/
│   │   ├── routes.ts               # pagina di preview
│   │   └── public/                 # HTML/JS della preview (MapLibre)
│   └── obs/
│       ├── log.ts                  # log strutturato
│       └── metrics.ts              # metriche + /metrics
└── test/
    ├── fixtures/                   # pmtiles minimo + tile MVT di riferimento
    └── ...                         # test per modulo
```

Ogni modulo ha una responsabilita' sola. `tiles/filter.ts` e' deliberatamente isolato e minimale: e' un controllo di accesso, e deve restare leggibile per intero in una schermata.

---

## Task 1: Scaffolding del servizio

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`
- Create: `src/server.ts`, `src/config.ts`, `src/obs/log.ts`
- Create: `Dockerfile`, `docker-compose.yml`
- Test: `test/health.test.ts`

**Interfaces:**
- Consumes: niente (primo task)
- Produces: `createApp(): express.Express` da `src/server.ts`; `loadConfig(env: NodeJS.ProcessEnv): Config` e il tipo `Config` da `src/config.ts`; `log: { info(msg: string, fields?: Record<string, unknown>): void; warn(...): void; error(...): void }` da `src/obs/log.ts`

- [ ] **Step 1: Creare il branch**

```bash
cd /Users/bongiu/Documents/wm-tiles
git checkout -b feature/server-tiles-osm
```

- [ ] **Step 2: Inizializzare il progetto Node**

```bash
npm init -y
npm pkg set type=module
npm pkg set engines.node=">=22"
npm install express
npm install -D typescript tsx vitest supertest @types/express @types/node @types/supertest
npx tsc --init
```

- [ ] **Step 3: Configurare TypeScript strict ESM**

Scrivere `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "outDir": "dist",
    "rootDir": ".",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src", "test"]
}
```

Scrivere `vitest.config.ts`:

```typescript
import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
```

Aggiungere gli script in `package.json`:

```bash
npm pkg set scripts.dev="tsx watch src/server.ts"
npm pkg set scripts.build="tsc"
npm pkg set scripts.test="vitest run"
npm pkg set scripts.test:watch="vitest"
```

- [ ] **Step 4: Scrivere il test che fallisce**

`test/health.test.ts`:

```typescript
import {describe, expect, it} from 'vitest';
import request from 'supertest';
import {createApp} from '../src/server.js';

describe('GET /health', () => {
  it('risponde 200 con status ok', async () => {
    const res = await request(createApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
```

- [ ] **Step 5: Eseguire il test e verificare che fallisca**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/server.js'`

- [ ] **Step 6: Implementare log, config e app**

`src/obs/log.ts`:

```typescript
type Fields = Record<string, unknown>;

function emit(level: 'info' | 'warn' | 'error', msg: string, fields?: Fields): void {
  const line = JSON.stringify({ts: new Date().toISOString(), level, msg, ...fields});
  if (level === 'error') console.error(line);
  else console.log(line);
}

export const log = {
  info: (msg: string, fields?: Fields) => emit('info', msg, fields),
  warn: (msg: string, fields?: Fields) => emit('warn', msg, fields),
  error: (msg: string, fields?: Fields) => emit('error', msg, fields),
};
```

`src/config.ts`:

```typescript
export interface Config {
  port: number;
  archiveDir: string;
  rasterCacheDir: string;
  retainedVersions: number;
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  return {
    port: Number(env.PORT ?? 8080),
    archiveDir: env.ARCHIVE_DIR ?? './data/archives',
    rasterCacheDir: env.RASTER_CACHE_DIR ?? './data/raster-cache',
    retainedVersions: Number(env.RETAINED_VERSIONS ?? 3),
  };
}
```

`src/server.ts`:

```typescript
import express from 'express';
import {loadConfig} from './config.js';
import {log} from './obs/log.js';

export function createApp(): express.Express {
  const app = express();
  app.get('/health', (_req, res) => {
    res.json({status: 'ok'});
  });
  return app;
}

const isMain = process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js');
if (isMain) {
  const cfg = loadConfig(process.env);
  createApp().listen(cfg.port, () => log.info('server listening', {port: cfg.port}));
}
```

- [ ] **Step 7: Eseguire il test e verificare che passi**

Run: `npm test`
Expected: PASS — 1 test

- [ ] **Step 8: Creare Dockerfile e docker-compose**

`Dockerfile`:

```dockerfile
FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 8080
CMD ["npx", "tsx", "src/server.ts"]
```

`docker-compose.yml`:

```yaml
services:
  wm-tiles:
    build: .
    ports:
      - "${WM_TILES_PORT:-8080}:8080"
    environment:
      ARCHIVE_DIR: /data/archives
      RASTER_CACHE_DIR: /data/raster-cache
    volumes:
      - ./:/app
      - tiles-data:/data
volumes:
  tiles-data:
```

`.env.example`:

```
WM_TILES_PORT=8080
ARCHIVE_DIR=./data/archives
RASTER_CACHE_DIR=./data/raster-cache
RETAINED_VERSIONS=3
```

`.gitignore`:

```
node_modules/
dist/
data/
.env
```

- [ ] **Step 9: Verificare che il container risponda**

Run:
```bash
docker compose up -d --build
curl -s localhost:8080/health
docker compose down
```
Expected: `{"status":"ok"}`

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore .env.example Dockerfile docker-compose.yml src test
git commit -m "feat(server-tiles-osm): scaffolding servizio Node/TS con health endpoint"
```

---

## Task 2: Pipeline OSM su estratto ridotto

Si parte da un estratto piccolo (non l'Italia) per avere un archivio reale in minuti invece che in ore. L'Italia arriva in Task 14, quando la pipeline e' gia' validata.

**Files:**
- Create: `pipeline/Dockerfile.planetiler`, `pipeline/build-osm.sh`
- Create: `test/pipeline/provenance.test.ts`

**Interfaces:**
- Consumes: niente
- Produces: un archivio `data/archives/<version>/osm.pmtiles` e il file di provenienza `data/archives/<version>/provenance.json` con forma `{archive: 'osm', version: string, generator: {name: string, version: string}, sources: [{name: string, url: string, sha256: string, retrievedAt: string}], maxzoom: number, createdAt: string}`. La `version` e' una stringa `YYYYMMDD-HHMM`.

- [ ] **Step 1: Scrivere il Dockerfile della pipeline**

`pipeline/Dockerfile.planetiler`:

```dockerfile
FROM eclipse-temurin:21-jre-jammy

ARG PLANETILER_VERSION=0.8.3
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates gdal-bin python3-gdal tippecanoe jq \
    && rm -rf /var/lib/apt/lists/*

RUN curl -sSL -o /opt/planetiler.jar \
      https://github.com/onthegomap/planetiler/releases/download/v${PLANETILER_VERSION}/planetiler.jar
ENV PLANETILER_JAR=/opt/planetiler.jar
ENV PLANETILER_VERSION=${PLANETILER_VERSION}

WORKDIR /work
```

Nota: se `tippecanoe` non e' disponibile nei pacchetti della distribuzione in uso, compilarlo da sorgente in questo stesso Dockerfile. Serve in Task 11.

- [ ] **Step 2: Scrivere lo script di build**

`pipeline/build-osm.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Uso: build-osm.sh <area> <out-dir>
#   area: nome geofabrik (es. "monaco" per lo sviluppo, "italy" in produzione)
AREA="${1:?area richiesta}"
OUT_DIR="${2:?out-dir richiesta}"
MAXZOOM=14

VERSION="$(date -u +%Y%m%d-%H%M)"
WORK="${OUT_DIR}/.tmp-${VERSION}"
DEST="${OUT_DIR}/${VERSION}"
mkdir -p "$WORK"

echo "== build osm: area=${AREA} maxzoom=${MAXZOOM} version=${VERSION}"

java -Xmx4g -jar "$PLANETILER_JAR" \
  --download \
  --area="$AREA" \
  --maxzoom="$MAXZOOM" \
  --output="${WORK}/osm.pmtiles" \
  --force

# Provenienza: l'estratto scaricato da planetiler resta in ./data/sources
SRC_PBF="$(find ./data/sources -name "${AREA}*.osm.pbf" | head -1)"
SRC_SHA="$(sha256sum "$SRC_PBF" | cut -d' ' -f1)"

jq -n \
  --arg version "$VERSION" \
  --arg gen "$PLANETILER_VERSION" \
  --arg src "$(basename "$SRC_PBF")" \
  --arg sha "$SRC_SHA" \
  --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson maxzoom "$MAXZOOM" \
  '{archive:"osm", version:$version,
    generator:{name:"planetiler", version:$gen},
    sources:[{name:$src, url:"https://download.geofabrik.de/", sha256:$sha, retrievedAt:$now}],
    maxzoom:$maxzoom, createdAt:$now,
    attribution:"© OpenStreetMap contributors (ODbL)"}' \
  > "${WORK}/provenance.json"

# Promozione atomica: la directory di versione appare completa o non appare
mv "$WORK" "$DEST"
echo "== pubblicato ${DEST}"
```

```bash
chmod +x pipeline/build-osm.sh
```

- [ ] **Step 3: Eseguire la pipeline sull'estratto piccolo**

Run:
```bash
docker build -f pipeline/Dockerfile.planetiler -t wm-tiles-pipeline pipeline/
mkdir -p data/archives
docker run --rm -v "$PWD/data:/work/data" -v "$PWD/pipeline:/work/pipeline" \
  wm-tiles-pipeline bash pipeline/build-osm.sh monaco /work/data/archives
ls data/archives/*/
```
Expected: una directory `YYYYMMDD-HHMM/` contenente `osm.pmtiles` e `provenance.json`

- [ ] **Step 4: Scrivere il test sulla provenienza**

`test/pipeline/provenance.test.ts`:

```typescript
import {describe, expect, it} from 'vitest';
import {readdirSync, readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';

const ARCHIVES = 'data/archives';

describe('archivio prodotto dalla pipeline', () => {
  it('ha una directory di versione con osm.pmtiles e provenance.json', () => {
    const versions = readdirSync(ARCHIVES).filter(d => /^\d{8}-\d{4}$/.test(d));
    expect(versions.length).toBeGreaterThan(0);
    const dir = join(ARCHIVES, versions[0]!);
    expect(existsSync(join(dir, 'osm.pmtiles'))).toBe(true);
    expect(existsSync(join(dir, 'provenance.json'))).toBe(true);
  });

  it('la provenienza dichiara generatore, sorgente con sha256, maxzoom 14 e attribuzione ODbL', () => {
    const versions = readdirSync(ARCHIVES).filter(d => /^\d{8}-\d{4}$/.test(d));
    const p = JSON.parse(readFileSync(join(ARCHIVES, versions[0]!, 'provenance.json'), 'utf8'));
    expect(p.generator.name).toBe('planetiler');
    expect(p.generator.version).toMatch(/\d+\.\d+/);
    expect(p.sources[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(p.maxzoom).toBe(14);
    expect(p.attribution).toContain('OpenStreetMap');
  });
});
```

- [ ] **Step 5: Eseguire i test**

Run: `npm test`
Expected: PASS — i test sulla provenienza passano sull'archivio appena generato

- [ ] **Step 6: Commit**

```bash
git add pipeline test/pipeline
git commit -m "feat(server-tiles-osm): pipeline planetiler con provenienza e promozione atomica"
```

---

## Task 3: Lettura degli archivi e versione corrente

**Files:**
- Create: `src/archive/store.ts`, `src/archive/versions.ts`
- Modify: `src/server.ts` (aggiungere la rotta `/version`)
- Test: `test/archive/versions.test.ts`, `test/archive/store.test.ts`

**Interfaces:**
- Consumes: `Config` da `src/config.ts`; gli archivi prodotti dal Task 2
- Produces:
  - `listVersions(archiveDir: string): string[]` — versioni presenti, ordine decrescente
  - `currentVersion(archiveDir: string): string | null`
  - `readProvenance(archiveDir: string, version: string): Provenance` e il tipo `Provenance`
  - `getTile(archiveDir: string, version: string, archive: 'osm' | 'hillshade' | 'contours', z: number, x: number, y: number): Promise<Uint8Array | null>`

- [ ] **Step 1: Installare la libreria PMTiles**

```bash
npm install pmtiles
```

- [ ] **Step 2: Scrivere i test che falliscono**

`test/archive/versions.test.ts`:

```typescript
import {describe, expect, it} from 'vitest';
import {currentVersion, listVersions, readProvenance} from '../../src/archive/versions.js';

const DIR = 'data/archives';

describe('versioni degli archivi', () => {
  it('elenca le versioni in ordine decrescente', () => {
    const v = listVersions(DIR);
    expect(v.length).toBeGreaterThan(0);
    expect([...v].sort().reverse()).toEqual(v);
  });

  it('la versione corrente e la piu recente', () => {
    expect(currentVersion(DIR)).toBe(listVersions(DIR)[0]);
  });

  it('legge la provenienza della versione corrente', () => {
    const p = readProvenance(DIR, currentVersion(DIR)!);
    expect(p.maxzoom).toBe(14);
  });

  it('ignora directory che non sono versioni', () => {
    expect(listVersions(DIR).every(v => /^\d{8}-\d{4}$/.test(v))).toBe(true);
  });
});
```

`test/archive/store.test.ts`:

```typescript
import {describe, expect, it} from 'vitest';
import {getTile} from '../../src/archive/store.js';
import {currentVersion} from '../../src/archive/versions.js';

const DIR = 'data/archives';

describe('getTile', () => {
  it('restituisce byte per una tile esistente a z0', async () => {
    const tile = await getTile(DIR, currentVersion(DIR)!, 'osm', 0, 0, 0);
    expect(tile).not.toBeNull();
    expect(tile!.byteLength).toBeGreaterThan(0);
  });

  it('restituisce null per una tile fuori dai dati', async () => {
    const tile = await getTile(DIR, currentVersion(DIR)!, 'osm', 14, 0, 0);
    expect(tile).toBeNull();
  });

  it('restituisce null per un archivio inesistente senza lanciare', async () => {
    const tile = await getTile(DIR, currentVersion(DIR)!, 'hillshade', 0, 0, 0);
    expect(tile).toBeNull();
  });
});
```

- [ ] **Step 3: Eseguire i test e verificare che falliscano**

Run: `npm test`
Expected: FAIL — moduli `src/archive/*` non trovati

- [ ] **Step 4: Implementare `versions.ts`**

```typescript
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

const VERSION_RE = /^\d{8}-\d{4}$/;

export interface Provenance {
  archive: string;
  version: string;
  generator: {name: string; version: string};
  sources: {name: string; url: string; sha256: string; retrievedAt: string}[];
  maxzoom: number;
  createdAt: string;
  attribution: string;
}

export function listVersions(archiveDir: string): string[] {
  if (!existsSync(archiveDir)) return [];
  return readdirSync(archiveDir, {withFileTypes: true})
    .filter(e => e.isDirectory() && VERSION_RE.test(e.name))
    .map(e => e.name)
    .sort()
    .reverse();
}

export function currentVersion(archiveDir: string): string | null {
  return listVersions(archiveDir)[0] ?? null;
}

export function readProvenance(archiveDir: string, version: string): Provenance {
  const raw = readFileSync(join(archiveDir, version, 'provenance.json'), 'utf8');
  return JSON.parse(raw) as Provenance;
}
```

- [ ] **Step 5: Implementare `store.ts`**

L'handle PMTiles va tenuto in cache: riaprirlo per ogni tile rifarebbe la lettura dell'header e dell'indice ad ogni richiesta.

```typescript
import {existsSync} from 'node:fs';
import {open} from 'node:fs/promises';
import {join} from 'node:path';
import {PMTiles, Source, RangeResponse} from 'pmtiles';
import {log} from '../obs/log.js';

export type ArchiveName = 'osm' | 'hillshade' | 'contours';

class FileSource implements Source {
  constructor(private readonly path: string) {}

  getKey(): string {
    return this.path;
  }

  async getBytes(offset: number, length: number): Promise<RangeResponse> {
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

const handles = new Map<string, PMTiles>();

function handle(archiveDir: string, version: string, archive: ArchiveName): PMTiles | null {
  const path = join(archiveDir, version, `${archive}.pmtiles`);
  const key = path;
  const cached = handles.get(key);
  if (cached) return cached;
  if (!existsSync(path)) return null;
  const p = new PMTiles(new FileSource(path));
  handles.set(key, p);
  return p;
}

export async function getTile(
  archiveDir: string,
  version: string,
  archive: ArchiveName,
  z: number,
  x: number,
  y: number,
): Promise<Uint8Array | null> {
  const p = handle(archiveDir, version, archive);
  if (!p) {
    log.warn('archive not found', {version, archive});
    return null;
  }
  const res = await p.getZxy(z, x, y);
  if (!res) return null;
  return new Uint8Array(res.data);
}
```

- [ ] **Step 6: Aggiungere la rotta `/version` in `src/server.ts`**

```typescript
import express from 'express';
import {loadConfig} from './config.js';
import {currentVersion, listVersions, readProvenance} from './archive/versions.js';
import {log} from './obs/log.js';

export function createApp(): express.Express {
  const cfg = loadConfig(process.env);
  const app = express();

  app.get('/health', (_req, res) => {
    res.json({status: 'ok'});
  });

  app.get('/version', (_req, res) => {
    const current = currentVersion(cfg.archiveDir);
    if (!current) {
      res.status(503).json({error: 'no archive published'});
      return;
    }
    res.json({
      current,
      retained: listVersions(cfg.archiveDir),
      provenance: readProvenance(cfg.archiveDir, current),
    });
  });

  return app;
}

const isMain = process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js');
if (isMain) {
  const cfg = loadConfig(process.env);
  createApp().listen(cfg.port, () => log.info('server listening', {port: cfg.port}));
}
```

- [ ] **Step 7: Aggiungere il test della rotta**

Aggiungere in `test/health.test.ts`:

```typescript
describe('GET /version', () => {
  it('annuncia la versione corrente e le versioni conservate', async () => {
    const res = await request(createApp()).get('/version');
    expect(res.status).toBe(200);
    expect(res.body.current).toMatch(/^\d{8}-\d{4}$/);
    expect(res.body.retained).toContain(res.body.current);
    expect(res.body.provenance.attribution).toContain('OpenStreetMap');
  });
});
```

- [ ] **Step 8: Eseguire i test**

Run: `npm test`
Expected: PASS — tutti

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/archive src/server.ts test
git commit -m "feat(server-tiles-osm): lettura archivi PMTiles e annuncio della versione"
```

---

## Task 4: Manifest dei gruppi di livelli

Il manifest e' il contratto pubblico verso gli shard e il frontend. E' un artefatto versionato nel repo, non generato: cambia solo per decisione esplicita.

**Files:**
- Create: `manifest/layers.v1.json`, `src/manifest/schema.ts`, `src/manifest/registry.ts`
- Modify: `src/server.ts` (rotta `/manifest`)
- Test: `test/manifest/registry.test.ts`

**Interfaces:**
- Consumes: niente
- Produces:
  - tipi `LayerGroup {id: string; label: Record<string, string>; layers: string[]; class: 'public' | 'protected'; attributes: string[]; minzoom: number; maxzoom: number}` e `Manifest {version: number; groups: LayerGroup[]; defaultSet: string[]}`
  - `loadManifest(path: string): Manifest`
  - `groupsById(m: Manifest): Map<string, LayerGroup>`
  - `layersForGroups(m: Manifest, groupIds: string[]): string[]`
  - `validateManifest(raw: unknown): Manifest` — lancia `Error` con messaggio esplicito se non valido

- [ ] **Step 1: Scrivere il manifest iniziale**

I gruppi sono provvisori: verranno raffinati in Task 9 guardando la preview. Le etichette sono in italiano e inglese (lingue dei repo Webmapp). I nomi dei layer tecnici sono quelli dello schema OpenMapTiles prodotto da planetiler.

`manifest/layers.v1.json`:

```json
{
  "version": 1,
  "groups": [
    {
      "id": "base",
      "label": {"it": "Sfondo", "en": "Base"},
      "layers": ["water", "waterway", "landcover", "landuse", "park", "boundary"],
      "class": "public",
      "attributes": ["class", "subclass", "name"],
      "minzoom": 0,
      "maxzoom": 14
    },
    {
      "id": "roads",
      "label": {"it": "Strade", "en": "Roads"},
      "layers": ["transportation", "transportation_name", "aeroway"],
      "class": "public",
      "attributes": ["class", "subclass", "name", "surface", "brunnel"],
      "minzoom": 4,
      "maxzoom": 14
    },
    {
      "id": "paths",
      "label": {"it": "Sentieri", "en": "Paths"},
      "layers": ["transportation"],
      "class": "public",
      "attributes": ["class", "subclass", "name", "surface"],
      "minzoom": 11,
      "maxzoom": 14
    },
    {
      "id": "buildings",
      "label": {"it": "Edifici", "en": "Buildings"},
      "layers": ["building"],
      "class": "public",
      "attributes": ["render_height"],
      "minzoom": 13,
      "maxzoom": 14
    },
    {
      "id": "places",
      "label": {"it": "Localita", "en": "Places"},
      "layers": ["place"],
      "class": "public",
      "attributes": ["class", "name", "rank"],
      "minzoom": 0,
      "maxzoom": 14
    },
    {
      "id": "poi",
      "label": {"it": "Punti di interesse", "en": "Points of interest"},
      "layers": ["poi"],
      "class": "public",
      "attributes": ["class", "subclass", "name", "rank"],
      "minzoom": 12,
      "maxzoom": 14
    },
    {
      "id": "hillshade",
      "label": {"it": "Ombreggiatura", "en": "Hillshade"},
      "layers": [],
      "class": "public",
      "attributes": [],
      "minzoom": 5,
      "maxzoom": 12
    },
    {
      "id": "contours",
      "label": {"it": "Curve di livello", "en": "Contour lines"},
      "layers": ["contour"],
      "class": "public",
      "attributes": ["elevation", "index"],
      "minzoom": 11,
      "maxzoom": 14
    }
  ],
  "defaultSet": ["base", "roads", "paths", "buildings", "places", "poi", "hillshade", "contours"]
}
```

Nota su `paths`: condivide il layer tecnico `transportation` con `roads`. Il filtro opera per layer, quindi due gruppi che condividono un layer non sono separabili. Questo e' un difetto noto del manifest v1 ed e' registrato come tale in Task 9, dove va risolto separando i sentieri in un layer proprio nello schema di generazione. Fino ad allora `paths` non e' abilitabile indipendentemente da `roads`.

- [ ] **Step 2: Scrivere i test che falliscono**

`test/manifest/registry.test.ts`:

```typescript
import {describe, expect, it} from 'vitest';
import {groupsById, layersForGroups, loadManifest, validateManifest} from '../../src/manifest/registry.js';

const m = loadManifest('manifest/layers.v1.json');

describe('manifest', () => {
  it('dichiara la versione del contratto', () => {
    expect(m.version).toBe(1);
  });

  it('ogni gruppo ha etichetta it e en', () => {
    for (const g of m.groups) {
      expect(g.label.it, `gruppo ${g.id}`).toBeTruthy();
      expect(g.label.en, `gruppo ${g.id}`).toBeTruthy();
    }
  });

  it('ogni gruppo dichiara una classe pubblico o protetto', () => {
    for (const g of m.groups) {
      expect(['public', 'protected']).toContain(g.class);
    }
  });

  it('oggi non esistono gruppi protetti', () => {
    expect(m.groups.filter(g => g.class === 'protected')).toHaveLength(0);
  });

  it('il defaultSet referenzia solo gruppi esistenti', () => {
    const ids = groupsById(m);
    for (const id of m.defaultSet) {
      expect(ids.has(id), `gruppo ${id} del defaultSet`).toBe(true);
    }
  });

  it('risolve i gruppi nei layer tecnici, senza duplicati', () => {
    const layers = layersForGroups(m, ['base', 'buildings']);
    expect(layers).toContain('water');
    expect(layers).toContain('building');
    expect(new Set(layers).size).toBe(layers.length);
  });

  it('ignora gruppi inesistenti nella risoluzione', () => {
    expect(layersForGroups(m, ['non-esiste'])).toEqual([]);
  });

  it('rifiuta un manifest senza version', () => {
    expect(() => validateManifest({groups: [], defaultSet: []})).toThrow(/version/);
  });

  it('rifiuta un gruppo senza etichetta it', () => {
    expect(() =>
      validateManifest({
        version: 1,
        defaultSet: [],
        groups: [{id: 'x', label: {en: 'X'}, layers: [], class: 'public', attributes: [], minzoom: 0, maxzoom: 14}],
      }),
    ).toThrow(/label/);
  });
});
```

- [ ] **Step 3: Eseguire i test e verificare che falliscano**

Run: `npm test`
Expected: FAIL — `src/manifest/registry.js` non trovato

- [ ] **Step 4: Implementare `schema.ts`**

```typescript
export type LayerClass = 'public' | 'protected';

export interface LayerGroup {
  id: string;
  label: Record<string, string>;
  layers: string[];
  class: LayerClass;
  attributes: string[];
  minzoom: number;
  maxzoom: number;
}

export interface Manifest {
  version: number;
  groups: LayerGroup[];
  defaultSet: string[];
}

const REQUIRED_LOCALES = ['it', 'en'] as const;

export function validateManifest(raw: unknown): Manifest {
  if (typeof raw !== 'object' || raw === null) throw new Error('manifest: non e un oggetto');
  const m = raw as Partial<Manifest>;
  if (typeof m.version !== 'number') throw new Error('manifest: version mancante o non numerica');
  if (!Array.isArray(m.groups)) throw new Error('manifest: groups mancante');
  if (!Array.isArray(m.defaultSet)) throw new Error('manifest: defaultSet mancante');

  const seen = new Set<string>();
  for (const g of m.groups) {
    if (!g.id) throw new Error('manifest: gruppo senza id');
    if (seen.has(g.id)) throw new Error(`manifest: gruppo duplicato ${g.id}`);
    seen.add(g.id);
    for (const loc of REQUIRED_LOCALES) {
      if (!g.label?.[loc]) throw new Error(`manifest: gruppo ${g.id} senza label.${loc}`);
    }
    if (g.class !== 'public' && g.class !== 'protected') {
      throw new Error(`manifest: gruppo ${g.id} con class non valida`);
    }
    if (!Array.isArray(g.layers)) throw new Error(`manifest: gruppo ${g.id} senza layers`);
    if (!Array.isArray(g.attributes)) throw new Error(`manifest: gruppo ${g.id} senza attributes`);
  }

  for (const id of m.defaultSet) {
    if (!seen.has(id)) throw new Error(`manifest: defaultSet referenzia il gruppo inesistente ${id}`);
  }

  return m as Manifest;
}
```

- [ ] **Step 5: Implementare `registry.ts`**

```typescript
import {readFileSync} from 'node:fs';
import {LayerGroup, Manifest, validateManifest} from './schema.js';

export type {LayerGroup, Manifest};
export {validateManifest};

export function loadManifest(path: string): Manifest {
  return validateManifest(JSON.parse(readFileSync(path, 'utf8')));
}

export function groupsById(m: Manifest): Map<string, LayerGroup> {
  return new Map(m.groups.map(g => [g.id, g]));
}

export function layersForGroups(m: Manifest, groupIds: string[]): string[] {
  const byId = groupsById(m);
  const out = new Set<string>();
  for (const id of groupIds) {
    const g = byId.get(id);
    if (!g) continue;
    for (const l of g.layers) out.add(l);
  }
  return [...out];
}
```

- [ ] **Step 6: Esporre il manifest su `/manifest`**

Aggiungere in `src/server.ts`, dentro `createApp()`:

```typescript
  const manifest = loadManifest('manifest/layers.v1.json');

  app.get('/manifest', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json(manifest);
  });
```

con l'import `import {loadManifest} from './manifest/registry.js';`

- [ ] **Step 7: Eseguire i test**

Run: `npm test`
Expected: PASS — tutti

- [ ] **Step 8: Commit**

```bash
git add manifest src/manifest src/server.ts test/manifest
git commit -m "feat(server-tiles-osm): manifest versionato dei gruppi di livelli"
```

---

## Task 5: Risoluzione del set di livelli

Il set e' un identificatore **non auto-descrittivo** derivato dal contenuto dell'insieme dei gruppi. In questo ciclo non esiste una fonte esterna che registri i set (arrivera' dagli shard nel ciclo successivo): i set validi sono quelli calcolabili dai gruppi del manifest, piu' un registro locale su file per gli esperimenti nella preview.

**Files:**
- Create: `src/sets/resolve.ts`
- Create: `data/sets.example.json` (esempio, non versionato il file reale)
- Modify: `src/server.ts` (rotta `/sets/:set`)
- Test: `test/sets/resolve.test.ts`

**Interfaces:**
- Consumes: `Manifest`, `groupsById`, `layersForGroups` da `src/manifest/registry.js`
- Produces:
  - `setIdFor(groupIds: string[]): string` — hash stabile, 12 caratteri esadecimali, indipendente dall'ordine
  - `resolveSet(m: Manifest, setId: string, registry: SetRegistry): ResolvedSet` dove `ResolvedSet = {setId: string; groups: string[]; layers: string[]; fallback: boolean}`
  - `SetRegistry = Map<string, string[]>`
  - `loadSetRegistry(path: string, m: Manifest): SetRegistry` — include sempre il set del `defaultSet`

- [ ] **Step 1: Scrivere i test che falliscono**

`test/sets/resolve.test.ts`:

```typescript
import {describe, expect, it, vi} from 'vitest';
import {loadManifest} from '../../src/manifest/registry.js';
import {resolveSet, setIdFor, SetRegistry} from '../../src/sets/resolve.js';
import {log} from '../../src/obs/log.js';

const m = loadManifest('manifest/layers.v1.json');
const registry: SetRegistry = new Map([
  [setIdFor(m.defaultSet), m.defaultSet],
  [setIdFor(['base', 'roads']), ['base', 'roads']],
]);

describe('setIdFor', () => {
  it('e stabile per lo stesso insieme', () => {
    expect(setIdFor(['base', 'roads'])).toBe(setIdFor(['base', 'roads']));
  });

  it('non dipende dall ordine', () => {
    expect(setIdFor(['roads', 'base'])).toBe(setIdFor(['base', 'roads']));
  });

  it('cambia se l insieme cambia', () => {
    expect(setIdFor(['base'])).not.toBe(setIdFor(['base', 'roads']));
  });

  it('non e auto-descrittivo: non contiene i nomi dei gruppi', () => {
    const id = setIdFor(['base', 'roads', 'poi']);
    expect(id).toMatch(/^[0-9a-f]{12}$/);
    for (const g of ['base', 'roads', 'poi']) {
      expect(id).not.toContain(g);
    }
  });
});

describe('resolveSet', () => {
  it('risolve un set noto nei suoi layer', () => {
    const r = resolveSet(m, setIdFor(['base', 'roads']), registry);
    expect(r.fallback).toBe(false);
    expect(r.groups).toEqual(['base', 'roads']);
    expect(r.layers).toContain('water');
    expect(r.layers).toContain('transportation');
  });

  it('un set sconosciuto cade sul defaultSet marcando il fallback', () => {
    const r = resolveSet(m, 'ffffffffffff', registry);
    expect(r.fallback).toBe(true);
    expect(r.groups).toEqual(m.defaultSet);
  });

  it('il fallback emette un warn osservabile', () => {
    const spy = vi.spyOn(log, 'warn');
    resolveSet(m, 'ffffffffffff', registry);
    expect(spy).toHaveBeenCalledWith('set fallback', expect.objectContaining({setId: 'ffffffffffff'}));
    spy.mockRestore();
  });

  it('il set di default e sempre risolvibile', () => {
    const r = resolveSet(m, setIdFor(m.defaultSet), registry);
    expect(r.fallback).toBe(false);
  });
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `npm test`
Expected: FAIL — `src/sets/resolve.js` non trovato

- [ ] **Step 3: Implementare `resolve.ts`**

```typescript
import {createHash} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {Manifest, layersForGroups} from '../manifest/registry.js';
import {log} from '../obs/log.js';

export type SetRegistry = Map<string, string[]>;

export interface ResolvedSet {
  setId: string;
  groups: string[];
  layers: string[];
  fallback: boolean;
}

export function setIdFor(groupIds: string[]): string {
  const canonical = [...new Set(groupIds)].sort().join('\n');
  return createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

export function loadSetRegistry(path: string, m: Manifest): SetRegistry {
  const registry: SetRegistry = new Map();
  registry.set(setIdFor(m.defaultSet), m.defaultSet);
  if (existsSync(path)) {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string[]>;
    for (const groups of Object.values(raw)) {
      registry.set(setIdFor(groups), groups);
    }
  }
  return registry;
}

export function resolveSet(m: Manifest, setId: string, registry: SetRegistry): ResolvedSet {
  const groups = registry.get(setId);
  if (!groups) {
    log.warn('set fallback', {setId, reason: 'unknown set', fallbackTo: 'defaultSet'});
    return {
      setId: setIdFor(m.defaultSet),
      groups: m.defaultSet,
      layers: layersForGroups(m, m.defaultSet),
      fallback: true,
    };
  }
  return {setId, groups, layers: layersForGroups(m, groups), fallback: false};
}
```

- [ ] **Step 4: Creare l'esempio di registro dei set**

`data/sets.example.json`:

```json
{
  "solo-sfondo-e-strade": ["base", "roads"],
  "senza-rilievo": ["base", "roads", "paths", "buildings", "places", "poi"],
  "minimo": ["base"]
}
```

Documentare in `.env.example`: `SETS_FILE=./data/sets.json`, e aggiungere `SETS_FILE` a `loadConfig` con default `./data/sets.json`.

- [ ] **Step 5: Aggiungere la rotta di ispezione `/sets/:set`**

Serve alla diagnostica: dato un identificatore opaco, dire quali gruppi contiene. Aggiungere in `createApp()`:

```typescript
  const setRegistry = loadSetRegistry(cfg.setsFile, manifest);

  app.get('/sets/:set', (req, res) => {
    const resolved = resolveSet(manifest, req.params.set, setRegistry);
    res.json(resolved);
  });
```

- [ ] **Step 6: Eseguire i test**

Run: `npm test`
Expected: PASS — tutti

- [ ] **Step 7: Commit**

```bash
git add src/sets src/config.ts src/server.ts data/sets.example.json .env.example test/sets
git commit -m "feat(server-tiles-osm): risoluzione del set di livelli con fallback osservabile"
```

---

## Task 6: Filtro dei livelli sul protobuf

**Questo e' il controllo di accesso del sistema.** Va trattato come tale: i test verificano l'**assenza** dei layer non abilitati, non solo la presenza di quelli attesi. Il filtro opera sui byte del protobuf senza decodificare le geometrie: una tile MVT e' `Tile { repeated Layer layers = 3 }` e un `Layer` ha `name` come campo 1. Si estrae solo il nome, e i byte del sotto-messaggio vengono copiati o scartati integralmente — quindi il risultato e' lossless per costruzione, e il costo e' proporzionale al numero di layer, non al numero di geometrie.

**Files:**
- Create: `src/tiles/filter.ts`
- Test: `test/tiles/filter.test.ts`

**Interfaces:**
- Consumes: niente (funzione pura su byte)
- Produces:
  - `layerNames(tile: Uint8Array): string[]`
  - `filterLayers(tile: Uint8Array, allowed: readonly string[]): Uint8Array`

- [ ] **Step 1: Preparare la fixture**

Estrarre una tile reale dall'archivio generato in Task 2 e salvarla come fixture, in modo che i test non dipendano dalla pipeline.

```bash
mkdir -p test/fixtures
cat > /tmp/dump-fixture.ts <<'TS'
import {writeFileSync} from 'node:fs';
import {getTile} from './src/archive/store.js';
import {currentVersion} from './src/archive/versions.js';

const dir = 'data/archives';
const v = currentVersion(dir)!;
// z9 e' un buon compromesso: contiene piu layer ma resta piccola
for (const [z, x, y] of [[9, 268, 182], [0, 0, 0]] as const) {
  const t = await getTile(dir, v, 'osm', z, x, y);
  if (t) {
    writeFileSync(`test/fixtures/tile-${z}-${x}-${y}.mvt`, t);
    console.log('scritta', z, x, y, t.byteLength, 'byte');
  } else {
    console.log('vuota', z, x, y);
  }
}
TS
npx tsx /tmp/dump-fixture.ts
ls -la test/fixtures/
```

Se nessuna delle coordinate produce una tile (dipende dall'area dell'estratto), individuarne una valida ispezionando l'header PMTiles con `npx pmtiles show data/archives/<version>/osm.pmtiles` e ripetere.

Nota: se i byte cominciano con `1f 8b` la tile e' compressa gzip. In quel caso decomprimerla prima di salvare la fixture (`zlib.gunzipSync`), perche' `filterLayers` lavora su MVT non compresso; la de/ricompressione e' responsabilita' delle rotte (Task 7).

- [ ] **Step 2: Scrivere i test che falliscono**

`test/tiles/filter.test.ts`:

```typescript
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {filterLayers, layerNames} from '../../src/tiles/filter.js';

const tile = new Uint8Array(readFileSync('test/fixtures/tile-9-268-182.mvt'));

describe('layerNames', () => {
  it('elenca i layer presenti nella tile', () => {
    const names = layerNames(tile);
    expect(names.length).toBeGreaterThan(1);
    expect(names).toContain('water');
  });
});

describe('filterLayers', () => {
  it('mantiene solo i layer consentiti', () => {
    const out = filterLayers(tile, ['water']);
    expect(layerNames(out)).toEqual(['water']);
  });

  it('RIMUOVE i layer non consentiti — nessuna traccia nel protobuf', () => {
    const removed = layerNames(tile).filter(n => n !== 'water');
    expect(removed.length).toBeGreaterThan(0);
    const out = filterLayers(tile, ['water']);
    const remaining = layerNames(out);
    for (const name of removed) {
      expect(remaining, `il layer ${name} deve essere assente`).not.toContain(name);
    }
  });

  it('il nome di un layer rimosso non appare nei byte di output', () => {
    const removed = layerNames(tile).filter(n => n !== 'water');
    const out = filterLayers(tile, ['water']);
    const text = Buffer.from(out).toString('latin1');
    for (const name of removed) {
      expect(text.includes(name), `la stringa ${name} non deve comparire nei byte`).toBe(false);
    }
  });

  it('e lossless sui layer mantenuti: i byte del layer sono identici', () => {
    const all = filterLayers(tile, layerNames(tile));
    expect(Buffer.from(all).equals(Buffer.from(tile))).toBe(true);
  });

  it('un insieme vuoto produce una tile vuota, non un errore', () => {
    const out = filterLayers(tile, []);
    expect(layerNames(out)).toEqual([]);
    expect(out.byteLength).toBe(0);
  });

  it('layer consentiti ma assenti non aggiungono nulla', () => {
    const out = filterLayers(tile, ['water', 'layer-inesistente']);
    expect(layerNames(out)).toEqual(['water']);
  });

  it('non modifica la tile in ingresso', () => {
    const copy = new Uint8Array(tile);
    filterLayers(tile, ['water']);
    expect(Buffer.from(tile).equals(Buffer.from(copy))).toBe(true);
  });

  it('su input vuoto restituisce vuoto', () => {
    expect(filterLayers(new Uint8Array(0), ['water']).byteLength).toBe(0);
    expect(layerNames(new Uint8Array(0))).toEqual([]);
  });
});
```

- [ ] **Step 3: Eseguire i test e verificare che falliscano**

Run: `npm test -- test/tiles/filter.test.ts`
Expected: FAIL — `src/tiles/filter.js` non trovato

- [ ] **Step 4: Implementare `filter.ts`**

```typescript
/**
 * Filtro dei layer di una tile MVT operando sui byte del protobuf.
 *
 * UNICO punto di applicazione del filtro dei livelli in tutto il sistema.
 * Non introdurre altrove selezioni di layer: due punti di applicazione
 * producono prima o poi due comportamenti diversi e un'esposizione silenziosa.
 *
 * Struttura MVT (Mapbox Vector Tile spec 2.1):
 *   Tile  { repeated Layer layers = 3; }
 *   Layer { required string name = 1; ... }
 *
 * Il sotto-messaggio di ogni layer viene copiato o scartato integralmente:
 * le geometrie non vengono mai decodificate, quindi il risultato e' lossless
 * e il costo e' proporzionale al numero di layer, non di feature.
 */

const FIELD_LAYERS = 3;
const FIELD_LAYER_NAME = 1;
const WIRE_LENGTH_DELIMITED = 2;

interface Varint {
  value: number;
  next: number;
}

function readVarint(buf: Uint8Array, pos: number): Varint {
  let value = 0;
  let shift = 0;
  let p = pos;
  while (p < buf.length) {
    const b = buf[p]!;
    value += (b & 0x7f) * Math.pow(2, shift);
    p++;
    if ((b & 0x80) === 0) return {value, next: p};
    shift += 7;
    if (shift > 63) throw new Error('mvt: varint troppo lungo');
  }
  throw new Error('mvt: varint troncato');
}

function readLayerName(buf: Uint8Array, start: number, end: number): string | null {
  let p = start;
  while (p < end) {
    const key = readVarint(buf, p);
    const field = key.value >>> 3;
    const wire = key.value & 0x07;
    p = key.next;
    if (field === FIELD_LAYER_NAME && wire === WIRE_LENGTH_DELIMITED) {
      const len = readVarint(buf, p);
      const from = len.next;
      return Buffer.from(buf.subarray(from, from + len.value)).toString('utf8');
    }
    p = skipField(buf, p, wire);
  }
  return null;
}

function skipField(buf: Uint8Array, pos: number, wire: number): number {
  switch (wire) {
    case 0:
      return readVarint(buf, pos).next;
    case 1:
      return pos + 8;
    case 2: {
      const len = readVarint(buf, pos);
      return len.next + len.value;
    }
    case 5:
      return pos + 4;
    default:
      throw new Error(`mvt: wire type non supportato ${wire}`);
  }
}

/** Elenca i nomi dei layer presenti nella tile. */
export function layerNames(tile: Uint8Array): string[] {
  const names: string[] = [];
  let p = 0;
  while (p < tile.length) {
    const key = readVarint(tile, p);
    const field = key.value >>> 3;
    const wire = key.value & 0x07;
    p = key.next;
    if (field === FIELD_LAYERS && wire === WIRE_LENGTH_DELIMITED) {
      const len = readVarint(tile, p);
      const from = len.next;
      const to = from + len.value;
      const name = readLayerName(tile, from, to);
      if (name !== null) names.push(name);
      p = to;
    } else {
      p = skipField(tile, p, wire);
    }
  }
  return names;
}

/**
 * Restituisce una nuova tile contenente solo i layer il cui nome e' in `allowed`.
 * I byte dei layer mantenuti sono copiati senza alcuna trasformazione.
 */
export function filterLayers(tile: Uint8Array, allowed: readonly string[]): Uint8Array {
  if (tile.length === 0) return new Uint8Array(0);
  const allow = new Set(allowed);
  const chunks: Uint8Array[] = [];
  let p = 0;
  while (p < tile.length) {
    const keyStart = p;
    const key = readVarint(tile, p);
    const field = key.value >>> 3;
    const wire = key.value & 0x07;
    p = key.next;
    if (field === FIELD_LAYERS && wire === WIRE_LENGTH_DELIMITED) {
      const len = readVarint(tile, p);
      const from = len.next;
      const to = from + len.value;
      const name = readLayerName(tile, from, to);
      if (name !== null && allow.has(name)) {
        chunks.push(tile.subarray(keyStart, to));
      }
      p = to;
    } else {
      // Campi top-level diversi da `layers`: conservati per non alterare la tile.
      const end = skipField(tile, p, wire);
      chunks.push(tile.subarray(keyStart, end));
      p = end;
    }
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}
```

- [ ] **Step 5: Eseguire i test e verificare che passino**

Run: `npm test -- test/tiles/filter.test.ts`
Expected: PASS — 9 test, incluso quello che verifica l'assenza dei nomi nei byte

- [ ] **Step 6: Misurare il costo del filtro**

Il requisito dice "costo nell'ordine dei millisecondi": va misurato, non assunto.

```bash
cat > /tmp/bench-filter.ts <<'TS'
import {readFileSync} from 'node:fs';
import {filterLayers, layerNames} from './src/tiles/filter.js';

const tile = new Uint8Array(readFileSync('test/fixtures/tile-9-268-182.mvt'));
const allowed = layerNames(tile).slice(0, 3);
const N = 2000;
const t0 = performance.now();
for (let i = 0; i < N; i++) filterLayers(tile, allowed);
const t1 = performance.now();
console.log(`tile ${tile.byteLength} byte, ${layerNames(tile).length} layer`);
console.log(`media ${((t1 - t0) / N).toFixed(3)} ms per tile`);
TS
npx tsx /tmp/bench-filter.ts
```

Registrare il numero ottenuto in `docs/features/server-tiles-osm/notes.md` sotto "Decisioni". Se la media supera 1 ms su una tile z9, indagare prima di procedere: significa che il parser sta facendo piu' lavoro del previsto.

- [ ] **Step 7: Commit**

```bash
git add src/tiles/filter.ts test/tiles test/fixtures
git commit -m "feat(server-tiles-osm): filtro dei layer sul protobuf, lossless e senza decodifica geometrie"
```

---

## Task 7: Rotte delle tile vettoriali

**Files:**
- Create: `src/tiles/routes.ts`
- Modify: `src/server.ts` (montare le rotte)
- Test: `test/tiles/routes.test.ts`

**Interfaces:**
- Consumes: `getTile` (`src/archive/store.js`), `filterLayers` (`src/tiles/filter.js`), `resolveSet`/`setIdFor`/`loadSetRegistry` (`src/sets/resolve.js`), `Manifest`, `Config`
- Produces: `tileRoutes(deps: {cfg: Config; manifest: Manifest; sets: SetRegistry}): express.Router`, che monta:
  - `GET /t/:version/:set/:archive/:z/:x/:y.pbf` — namespace pubblico
  - `GET /p/:version/:set/:archive/:z/:x/:y.pbf` — namespace verificato, `501` in questo ciclo

- [ ] **Step 1: Scrivere i test che falliscono**

`test/tiles/routes.test.ts`:

```typescript
import {describe, expect, it} from 'vitest';
import request from 'supertest';
import {gunzipSync} from 'node:zlib';
import {createApp} from '../../src/server.js';
import {loadManifest} from '../../src/manifest/registry.js';
import {setIdFor} from '../../src/sets/resolve.js';
import {currentVersion} from '../../src/archive/versions.js';
import {layerNames} from '../../src/tiles/filter.js';

const app = createApp();
const m = loadManifest('manifest/layers.v1.json');
const V = currentVersion('data/archives')!;
const FULL = setIdFor(m.defaultSet);
const Z = 9, X = 268, Y = 182;

describe('GET /t/:version/:set/osm/:z/:x/:y.pbf', () => {
  it('serve una tile con content-type protobuf', async () => {
    const res = await request(app).get(`/t/${V}/${FULL}/osm/${Z}/${X}/${Y}.pbf`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/vnd.mapbox-vector-tile');
  });

  it('imposta cache immutabile: versione e set sono nel path', async () => {
    const res = await request(app).get(`/t/${V}/${FULL}/osm/${Z}/${X}/${Y}.pbf`);
    expect(res.headers['cache-control']).toContain('immutable');
    expect(res.headers['vary']).toBeUndefined();
  });

  it('espone CORS per webapp e WebView', async () => {
    const res = await request(app).get(`/t/${V}/${FULL}/osm/${Z}/${X}/${Y}.pbf`);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('dichiara l attribuzione ODbL in un header', async () => {
    const res = await request(app).get(`/t/${V}/${FULL}/osm/${Z}/${X}/${Y}.pbf`);
    expect(res.headers['x-attribution']).toContain('OpenStreetMap');
  });

  it('un set ridotto serve solo i layer di quei gruppi', async () => {
    const only = setIdFor(['base']);
    const res = await request(app)
      .get(`/t/${V}/${only}/osm/${Z}/${X}/${Y}.pbf`)
      .buffer()
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    const body = res.body as Buffer;
    const raw = body[0] === 0x1f && body[1] === 0x8b ? gunzipSync(body) : body;
    const names = layerNames(new Uint8Array(raw));
    expect(names).toContain('water');
    expect(names).not.toContain('building');
    expect(names).not.toContain('poi');
  });

  it('risponde 404 per una tile assente nei dati', async () => {
    const res = await request(app).get(`/t/${V}/${FULL}/osm/14/0/0.pbf`);
    expect(res.status).toBe(404);
  });

  it('risponde 400 per uno zoom oltre il massimo generato', async () => {
    const res = await request(app).get(`/t/${V}/${FULL}/osm/20/1/1.pbf`);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('maxzoom');
  });

  it('risponde 400 per coordinate non numeriche', async () => {
    const res = await request(app).get(`/t/${V}/${FULL}/osm/a/b/c.pbf`);
    expect(res.status).toBe(400);
  });

  it('risponde 404 per una versione inesistente', async () => {
    const res = await request(app).get(`/t/19990101-0000/${FULL}/osm/${Z}/${X}/${Y}.pbf`);
    expect(res.status).toBe(404);
  });

  it('risponde 400 per un archivio non riconosciuto', async () => {
    const res = await request(app).get(`/t/${V}/${FULL}/qualcosa/${Z}/${X}/${Y}.pbf`);
    expect(res.status).toBe(400);
  });
});

describe('namespace /p/ (tiles verificate)', () => {
  it('esiste e risponde 501: la forma di URL e fissata da ora', async () => {
    const res = await request(app).get(`/p/${V}/${FULL}/osm/${Z}/${X}/${Y}.pbf`);
    expect(res.status).toBe(501);
  });
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `npm test -- test/tiles/routes.test.ts`
Expected: FAIL — le rotte non esistono, 404 al posto dei codici attesi

- [ ] **Step 3: Implementare `routes.ts`**

```typescript
import express from 'express';
import {gunzipSync, gzipSync} from 'node:zlib';
import {ArchiveName, getTile} from '../archive/store.js';
import {listVersions, readProvenance} from '../archive/versions.js';
import {Config} from '../config.js';
import {Manifest} from '../manifest/registry.js';
import {SetRegistry, resolveSet} from '../sets/resolve.js';
import {filterLayers} from './filter.js';
import {log} from '../obs/log.js';

const ARCHIVES: ArchiveName[] = ['osm', 'hillshade', 'contours'];
const ATTRIBUTION = '© OpenStreetMap contributors (ODbL); DEM Tinitaly © INGV';

const GZIP_MAGIC = [0x1f, 0x8b];

function isGzip(b: Uint8Array): boolean {
  return b.length > 1 && b[0] === GZIP_MAGIC[0] && b[1] === GZIP_MAGIC[1];
}

export interface TileDeps {
  cfg: Config;
  manifest: Manifest;
  sets: SetRegistry;
}

export function tileRoutes(deps: TileDeps): express.Router {
  const router = express.Router();
  const {cfg, manifest, sets} = deps;

  router.get('/p/:version/:set/:archive/:z/:x/:y.pbf', (_req, res) => {
    res.status(501).json({error: 'verified namespace not implemented in this cycle'});
  });

  router.get('/t/:version/:set/:archive/:z/:x/:y.pbf', async (req, res) => {
    const {version, set, archive} = req.params;
    const z = Number(req.params.z);
    const x = Number(req.params.x);
    const y = Number(req.params.y);

    if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) {
      res.status(400).json({error: 'coordinate non valide'});
      return;
    }
    if (!ARCHIVES.includes(archive as ArchiveName)) {
      res.status(400).json({error: `archivio non riconosciuto: ${archive}`});
      return;
    }
    if (!listVersions(cfg.archiveDir).includes(version)) {
      res.status(404).json({error: `versione non disponibile: ${version}`});
      return;
    }

    const {maxzoom} = readProvenance(cfg.archiveDir, version);
    if (z > maxzoom) {
      res.status(400).json({error: `zoom ${z} oltre il maxzoom generato (${maxzoom}); usare l'overzoom lato client`});
      return;
    }
    if (z < 0 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) {
      res.status(400).json({error: 'coordinate fuori dalla griglia'});
      return;
    }

    const raw = await getTile(cfg.archiveDir, version, archive as ArchiveName, z, x, y);
    if (!raw) {
      res.status(404).end();
      return;
    }

    const resolved = resolveSet(manifest, set, sets);
    const plain = isGzip(raw) ? new Uint8Array(gunzipSync(raw)) : raw;
    const filtered = filterLayers(plain, resolved.layers);

    res.set({
      'Content-Type': 'application/vnd.mapbox-vector-tile',
      'Content-Encoding': 'gzip',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
      'X-Attribution': ATTRIBUTION,
      'X-Tile-Version': version,
      'X-Tile-Set': resolved.setId,
    });
    if (resolved.fallback) res.set('X-Tile-Set-Fallback', '1');

    log.info('tile served', {
      archive, version, set: resolved.setId, z, x, y,
      fallback: resolved.fallback, bytes: filtered.byteLength,
    });

    res.status(200).send(gzipSync(Buffer.from(filtered)));
  });

  return router;
}
```

Nota sulla tracciabilita': il `log.info('tile served', ...)` con `set` e `version` e' cio' che soddisfa il requisito "tracciabilita' di cio' che e' stato servito" — necessario per sapere quali set invalidare se il filtro sbagliasse. In Task 16 diventa campionato per non generare volumi ingestibili.

- [ ] **Step 4: Montare le rotte in `src/server.ts`**

Dentro `createApp()`, dopo la creazione di `setRegistry`:

```typescript
  app.use(tileRoutes({cfg, manifest, sets: setRegistry}));
```

con `import {tileRoutes} from './tiles/routes.js';`

- [ ] **Step 5: Eseguire i test**

Run: `npm test`
Expected: PASS — tutti, incluso il test che verifica l'assenza di `building` e `poi` nel set ridotto

- [ ] **Step 6: Verifica manuale end-to-end**

```bash
npm run dev &
V=$(curl -s localhost:8080/version | jq -r .current)
S=$(curl -s localhost:8080/manifest | jq -r '.defaultSet | @csv' >/dev/null; curl -s "localhost:8080/sets/$(node -e "
import('./src/sets/resolve.js').then(async m => {
  const r = await import('./src/manifest/registry.js');
  console.log(m.setIdFor(r.loadManifest('manifest/layers.v1.json').defaultSet));
});
")" | jq -r .setId)
curl -s -o /dev/null -w "%{http_code} %{size_download}B %{content_type}\n" \
  "localhost:8080/t/$V/$S/osm/9/268/182.pbf"
kill %1
```
Expected: `200`, dimensione non nulla, content-type `application/vnd.mapbox-vector-tile`

- [ ] **Step 7: Commit**

```bash
git add src/tiles/routes.ts src/server.ts test/tiles/routes.test.ts
git commit -m "feat(server-tiles-osm): rotte tile vettoriali con set nel path e namespace verificato riservato"
```

---

## Task 8: Pagina di preview con confronto affiancato

Arriva **prima** dello stile, deliberatamente: lo stile e' il lavoro piu' lungo e incerto del progetto e va fatto guardando. Con la preview in piedi, ogni iterazione di stile e' verificabile subito contro le PNG attuali.

**Files:**
- Create: `src/preview/routes.ts`, `src/preview/public/index.html`, `src/preview/public/preview.js`
- Modify: `src/server.ts`
- Test: `test/preview/routes.test.ts`

**Interfaces:**
- Consumes: `Config`, `Manifest`, `SetRegistry`, `currentVersion`
- Produces: `previewRoutes(deps: {cfg: Config; manifest: Manifest; sets: SetRegistry}): express.Router` che monta `GET /preview` e `GET /preview/config.json` (versione corrente, gruppi, set disponibili, zone campione)

- [ ] **Step 1: Scrivere il test che fallisce**

`test/preview/routes.test.ts`:

```typescript
import {describe, expect, it} from 'vitest';
import request from 'supertest';
import {createApp} from '../../src/server.js';

const app = createApp();

describe('preview', () => {
  it('serve la pagina HTML', async () => {
    const res = await request(app).get('/preview');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('maplibre');
  });

  it('espone la configurazione con versione, gruppi, set e zone campione', async () => {
    const res = await request(app).get('/preview/config.json');
    expect(res.status).toBe(200);
    expect(res.body.version).toMatch(/^\d{8}-\d{4}$/);
    expect(res.body.groups.length).toBeGreaterThan(0);
    expect(res.body.sets.length).toBeGreaterThan(0);
    expect(res.body.areas.map((a: {id: string}) => a.id)).toEqual(
      expect.arrayContaining(['montagna', 'citta', 'costa', 'pianura']),
    );
    expect(res.body.legacyTileUrl).toContain('api.webmapp.it/tiles');
  });
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `npm test -- test/preview`
Expected: FAIL — 404 su `/preview`

- [ ] **Step 3: Implementare `src/preview/routes.ts`**

```typescript
import express from 'express';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {currentVersion} from '../archive/versions.js';
import {Config} from '../config.js';
import {Manifest} from '../manifest/registry.js';
import {SetRegistry, setIdFor} from '../sets/resolve.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const LEGACY_TILE_URL = 'https://api.webmapp.it/tiles/{z}/{x}/{y}.png';

/** Zone di confronto: coprono i casi in cui lo stile si rompe piu facilmente. */
const AREAS = [
  {id: 'montagna', label: 'Montagna (Appennino)', center: [10.55, 44.05], zoom: 13},
  {id: 'citta', label: 'Citta (Firenze)', center: [11.2558, 43.7696], zoom: 14},
  {id: 'costa', label: 'Costa (Cinque Terre)', center: [9.7085, 44.1069], zoom: 13},
  {id: 'pianura', label: 'Pianura (Padana)', center: [10.9, 45.1], zoom: 12},
];

export interface PreviewDeps {
  cfg: Config;
  manifest: Manifest;
  sets: SetRegistry;
}

export function previewRoutes(deps: PreviewDeps): express.Router {
  const router = express.Router();
  const {cfg, manifest, sets} = deps;

  router.get('/preview/config.json', (_req, res) => {
    res.json({
      version: currentVersion(cfg.archiveDir),
      groups: manifest.groups.map(g => ({
        id: g.id,
        label: g.label,
        class: g.class,
        layers: g.layers,
        minzoom: g.minzoom,
        maxzoom: g.maxzoom,
      })),
      defaultSet: setIdFor(manifest.defaultSet),
      sets: [...sets.entries()].map(([setId, groups]) => ({setId, groups})),
      areas: AREAS,
      legacyTileUrl: LEGACY_TILE_URL,
      styleUrl: '/style.json',
    });
  });

  router.use('/preview', express.static(join(HERE, 'public')));

  return router;
}
```

- [ ] **Step 4: Implementare la pagina**

`src/preview/public/index.html`:

```html
<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <title>wm-tiles — preview</title>
  <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css">
  <style>
    html, body { margin: 0; height: 100%; font: 13px system-ui, sans-serif; }
    #bar { padding: 6px 10px; background: #222; color: #eee; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
    #bar select, #bar button { font: inherit; }
    #panes { display: flex; height: calc(100% - 40px); }
    .pane { flex: 1; position: relative; border-left: 1px solid #444; }
    .pane:first-child { border-left: 0; }
    .pane h2 { position: absolute; z-index: 2; top: 6px; left: 6px; margin: 0;
               font-size: 11px; font-weight: 600; background: rgba(0,0,0,.6);
               color: #fff; padding: 2px 6px; border-radius: 3px; }
    .map { position: absolute; inset: 0; }
    #groups { display: flex; gap: 8px; flex-wrap: wrap; }
    #groups label { background: #333; padding: 2px 6px; border-radius: 3px; }
    #meta { margin-left: auto; opacity: .7; font-variant-numeric: tabular-nums; }
  </style>
</head>
<body>
  <div id="bar">
    <span>area <select id="area"></select></span>
    <span>set <select id="set"></select></span>
    <span>destra <select id="right">
      <option value="legacy">PNG attuale</option>
      <option value="raster">PNG nuovo (raster)</option>
    </select></span>
    <span id="groups"></span>
    <span id="meta"></span>
  </div>
  <div id="panes">
    <div class="pane"><h2>vettoriale (nuovo)</h2><div class="map" id="left"></div></div>
    <div class="pane"><h2 id="rightTitle">PNG attuale</h2><div class="map" id="rightMap"></div></div>
  </div>
  <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
  <script type="module" src="preview.js"></script>
</body>
</html>
```

`src/preview/public/preview.js`:

```javascript
const cfg = await (await fetch('/preview/config.json')).json();

const el = id => document.getElementById(id);
const state = {
  set: new URLSearchParams(location.search).get('set') || cfg.defaultSet,
  right: 'legacy',
  hidden: new Set(),
};

for (const a of cfg.areas) {
  el('area').append(new Option(a.label, a.id));
}
for (const s of cfg.sets) {
  el('set').append(new Option(`${s.setId} — ${s.groups.join(', ')}`, s.setId));
}
el('set').value = state.set;

el('groups').innerHTML = cfg.groups
  .map(g => `<label><input type="checkbox" data-group="${g.id}" checked> ${g.label.it}</label>`)
  .join('');

const left = new maplibregl.Map({
  container: 'left',
  style: `${cfg.styleUrl}?set=${state.set}`,
  center: cfg.areas[0].center,
  zoom: cfg.areas[0].zoom,
  hash: false,
});

function rightStyle() {
  const url =
    state.right === 'legacy'
      ? cfg.legacyTileUrl
      : `/t/${cfg.version}/${state.set}/raster/{z}/{x}/{y}.png`;
  return {
    version: 8,
    sources: {cmp: {type: 'raster', tiles: [url], tileSize: 256, attribution: '© OpenStreetMap contributors'}},
    layers: [{id: 'cmp', type: 'raster', source: 'cmp'}],
  };
}

const right = new maplibregl.Map({
  container: 'rightMap',
  style: rightStyle(),
  center: cfg.areas[0].center,
  zoom: cfg.areas[0].zoom,
});

// Viste sincronizzate: il confronto ha senso solo se le due mappe guardano lo stesso punto.
let syncing = false;
function sync(from, to) {
  from.on('move', () => {
    if (syncing) return;
    syncing = true;
    to.jumpTo({center: from.getCenter(), zoom: from.getZoom(), bearing: from.getBearing(), pitch: 0});
    syncing = false;
    el('meta').textContent =
      `z${from.getZoom().toFixed(1)} · ${from.getCenter().lng.toFixed(4)},${from.getCenter().lat.toFixed(4)} · v${cfg.version} · set ${state.set}`;
  });
}
sync(left, right);
sync(right, left);

el('area').onchange = e => {
  const a = cfg.areas.find(x => x.id === e.target.value);
  left.jumpTo({center: a.center, zoom: a.zoom});
};

el('set').onchange = e => {
  state.set = e.target.value;
  left.setStyle(`${cfg.styleUrl}?set=${state.set}`);
  if (state.right === 'raster') right.setStyle(rightStyle());
};

el('right').onchange = e => {
  state.right = e.target.value;
  el('rightTitle').textContent = e.target.selectedOptions[0].textContent;
  right.setStyle(rightStyle());
};

// Spegnimento dei gruppi: agisce sulla VISIBILITA lato client, non sul filtro
// dei dati (che e' lato server, per set). Serve a isolare problemi di stile.
el('groups').onchange = e => {
  const group = e.target.dataset.group;
  if (!group) return;
  const g = cfg.groups.find(x => x.id === group);
  const visible = e.target.checked ? 'visible' : 'none';
  for (const layer of left.getStyle().layers) {
    if (g.layers.includes(layer['source-layer']) || layer.id.startsWith(group)) {
      left.setLayoutProperty(layer.id, 'visibility', visible);
    }
  }
};
```

- [ ] **Step 5: Montare le rotte**

In `createApp()`:

```typescript
  app.use(previewRoutes({cfg, manifest, sets: setRegistry}));
```

- [ ] **Step 6: Eseguire i test**

Run: `npm test -- test/preview`
Expected: PASS — 2 test

- [ ] **Step 7: Verifica visiva**

```bash
npm run dev
```
Aprire `http://localhost:8080/preview`. A questo punto il pannello destro (PNG attuale) mostra la cartografia esistente e quello sinistro e' ancora vuoto o grezzo: lo stile non esiste. E' il punto di partenza corretto — da qui in poi ogni modifica allo stile e' visibile immediatamente accanto al riferimento.

Nota: il pannello raster e lo `/style.json` arrivano nei task successivi; fino a Task 9 la preview serve per verificare il confronto e la sincronizzazione delle viste.

- [ ] **Step 8: Commit**

```bash
git add src/preview src/server.ts test/preview
git commit -m "feat(server-tiles-osm): pagina di preview con confronto affiancato alle PNG attuali"
```

---

## Task 9: Stile base servito e prima resa vettoriale

Obiettivo: la preview mostra qualcosa a sinistra. Lo stile e' ancora grezzo — la convergenza verso l'aspetto attuale e' Task 12, dopo il rilievo.

**Files:**
- Create: `style/webmapp.json`, `src/style/routes.ts`
- Modify: `src/server.ts`
- Test: `test/style/routes.test.ts`

**Interfaces:**
- Consumes: `Config`, `Manifest`, `SetRegistry`, `currentVersion`, `resolveSet`
- Produces: `styleRoutes(deps): express.Router` che monta `GET /style.json?set=<setId>` restituendo uno style MapLibre completo, con `sources` che puntano a `/t/{version}/{set}/osm/{z}/{x}/{y}.pbf`, `attribution` valorizzata e `metadata.wm:groups` con il manifest dei gruppi

- [ ] **Step 1: Scrivere lo stile base iniziale**

`style/webmapp.json` — struttura minima da cui iterare. I colori sono i valori campionati dalle PNG attuali (fondo beige, bosco verde salvia); il raffinamento e' Task 12.

```json
{
  "version": 8,
  "name": "Webmapp",
  "metadata": {"wm:cycle": 1},
  "sources": {},
  "sprite": "{BASE}/sprite/webmapp",
  "glyphs": "{BASE}/glyphs/{fontstack}/{range}.pbf",
  "layers": [
    {"id": "background", "type": "background", "paint": {"background-color": "#f4f0e6"}},
    {"id": "landcover-wood", "type": "fill", "source": "openmaptiles", "source-layer": "landcover",
     "filter": ["==", ["get", "class"], "wood"],
     "paint": {"fill-color": "#c8d5bb", "fill-opacity": 0.7}},
    {"id": "water", "type": "fill", "source": "openmaptiles", "source-layer": "water",
     "paint": {"fill-color": "#a9cfe3"}},
    {"id": "waterway", "type": "line", "source": "openmaptiles", "source-layer": "waterway",
     "paint": {"line-color": "#a9cfe3", "line-width": 1}},
    {"id": "road-casing", "type": "line", "source": "openmaptiles", "source-layer": "transportation",
     "minzoom": 6,
     "paint": {"line-color": "#c9c2b0", "line-width": ["interpolate", ["linear"], ["zoom"], 6, 1.5, 14, 6]}},
    {"id": "road-fill", "type": "line", "source": "openmaptiles", "source-layer": "transportation",
     "minzoom": 6,
     "paint": {"line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.6, 14, 4]}},
    {"id": "path", "type": "line", "source": "openmaptiles", "source-layer": "transportation",
     "minzoom": 12,
     "filter": ["in", ["get", "class"], ["literal", ["path", "track"]]],
     "paint": {"line-color": "#9b7653", "line-width": 1, "line-dasharray": [2, 1.5]}},
    {"id": "building", "type": "fill", "source": "openmaptiles", "source-layer": "building",
     "minzoom": 13, "paint": {"fill-color": "#e0d8c8", "fill-outline-color": "#cfc5b0"}},
    {"id": "place-label", "type": "symbol", "source": "openmaptiles", "source-layer": "place",
     "layout": {"text-field": ["get", "name"], "text-font": ["Noto Sans Regular"],
                "text-size": ["interpolate", ["linear"], ["zoom"], 6, 10, 14, 14]},
     "paint": {"text-color": "#4a4a44", "text-halo-color": "#f4f0e6", "text-halo-width": 1.5}}
  ]
}
```

- [ ] **Step 2: Scrivere i test che falliscono**

`test/style/routes.test.ts`:

```typescript
import {describe, expect, it} from 'vitest';
import request from 'supertest';
import {createApp} from '../../src/server.js';
import {loadManifest} from '../../src/manifest/registry.js';
import {setIdFor} from '../../src/sets/resolve.js';
import {currentVersion} from '../../src/archive/versions.js';

const app = createApp();
const m = loadManifest('manifest/layers.v1.json');
const V = currentVersion('data/archives')!;

describe('GET /style.json', () => {
  it('restituisce uno style valido con la source openmaptiles', async () => {
    const res = await request(app).get('/style.json');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(8);
    expect(res.body.sources.openmaptiles.type).toBe('vector');
  });

  it('le tile URL contengono versione e set nel path', async () => {
    const set = setIdFor(['base', 'roads']);
    const res = await request(app).get(`/style.json?set=${set}`);
    const url = res.body.sources.openmaptiles.tiles[0];
    expect(url).toContain(`/t/${V}/${set}/osm/`);
    expect(url).toContain('{z}/{x}/{y}.pbf');
  });

  it('dichiara maxzoom 14 sulla source, per abilitare l overzoom', async () => {
    const res = await request(app).get('/style.json');
    expect(res.body.sources.openmaptiles.maxzoom).toBe(14);
  });

  it('dichiara l attribuzione ODbL', async () => {
    const res = await request(app).get('/style.json');
    expect(res.body.sources.openmaptiles.attribution).toContain('OpenStreetMap');
  });

  it('porta il manifest dei gruppi nei metadata, per il client', async () => {
    const res = await request(app).get('/style.json');
    const groups = res.body.metadata['wm:groups'];
    expect(Array.isArray(groups)).toBe(true);
    expect(groups.length).toBe(m.groups.length);
    expect(groups[0].label.it).toBeTruthy();
  });

  it('un set sconosciuto produce comunque uno style, segnalando il fallback', async () => {
    const res = await request(app).get('/style.json?set=ffffffffffff');
    expect(res.status).toBe(200);
    expect(res.body.metadata['wm:setFallback']).toBe(true);
  });

  it('risolve i placeholder di sprite e glyphs in URL assolute', async () => {
    const res = await request(app).get('/style.json');
    expect(res.body.sprite).not.toContain('{BASE}');
    expect(res.body.glyphs).toContain('/glyphs/');
  });
});
```

- [ ] **Step 3: Eseguire i test e verificare che falliscano**

Run: `npm test -- test/style`
Expected: FAIL — 404 su `/style.json`

- [ ] **Step 4: Implementare `src/style/routes.ts`**

```typescript
import express from 'express';
import {readFileSync} from 'node:fs';
import {currentVersion} from '../archive/versions.js';
import {Config} from '../config.js';
import {Manifest} from '../manifest/registry.js';
import {SetRegistry, resolveSet, setIdFor} from '../sets/resolve.js';

const ATTRIBUTION = '© OpenStreetMap contributors (ODbL)';
const ATTRIBUTION_DEM = 'DEM Tinitaly © INGV';

export interface StyleDeps {
  cfg: Config;
  manifest: Manifest;
  sets: SetRegistry;
}

export function styleRoutes(deps: StyleDeps): express.Router {
  const router = express.Router();
  const {cfg, manifest, sets} = deps;

  router.get('/style.json', (req, res) => {
    const version = currentVersion(cfg.archiveDir);
    if (!version) {
      res.status(503).json({error: 'no archive published'});
      return;
    }

    const requested = typeof req.query.set === 'string' ? req.query.set : setIdFor(manifest.defaultSet);
    const resolved = resolveSet(manifest, requested, sets);

    const base = `${req.protocol}://${req.get('host')}`;
    const style = JSON.parse(readFileSync('style/webmapp.json', 'utf8')) as Record<string, unknown>;

    style.sources = {
      openmaptiles: {
        type: 'vector',
        tiles: [`${base}/t/${version}/${resolved.setId}/osm/{z}/{x}/{y}.pbf`],
        minzoom: 0,
        maxzoom: 14,
        attribution: ATTRIBUTION,
      },
    };

    style.sprite = String(style.sprite).replace('{BASE}', base);
    style.glyphs = String(style.glyphs).replace('{BASE}', base);

    style.metadata = {
      ...(style.metadata as object),
      'wm:version': version,
      'wm:set': resolved.setId,
      'wm:setFallback': resolved.fallback,
      'wm:groups': manifest.groups,
      'wm:attribution': [ATTRIBUTION, ATTRIBUTION_DEM],
    };

    res.set({
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    });
    res.json(style);
  });

  return router;
}
```

- [ ] **Step 5: Montare e verificare**

In `createApp()`: `app.use(styleRoutes({cfg, manifest, sets: setRegistry}));`

Run: `npm test`
Expected: PASS — tutti

- [ ] **Step 6: Verifica visiva nella preview**

```bash
npm run dev
```
Aprire `/preview`: il pannello sinistro ora disegna la cartografia vettoriale. Sara' povera e diversa dal riferimento — e' atteso. Verificare che: si veda qualcosa, le due viste restino sincronizzate, i checkbox dei gruppi accendano e spengano i layer.

- [ ] **Step 7: Commit**

```bash
git add style/webmapp.json src/style src/server.ts test/style
git commit -m "feat(server-tiles-osm): style.json servito con set e versione nel path"
```

---

## Task 10: Glifi e sprite

Senza glifi le etichette non compaiono e senza sprite le icone sono quadrati vuoti. Sono anche il pezzo che dovra' finire nella cache offline nel ciclo successivo, quindi vanno serviti da URL stabili.

**Files:**
- Create: `pipeline/build-glyphs.sh`, `pipeline/build-sprite.sh`
- Create: `src/assets/routes.ts`
- Modify: `src/server.ts`
- Test: `test/assets/routes.test.ts`

**Interfaces:**
- Consumes: `Config`
- Produces: `assetRoutes(): express.Router` che monta `GET /glyphs/:fontstack/:range.pbf` e `GET /sprite/:name(.png|.json|@2x.png|@2x.json)`

- [ ] **Step 1: Generare i glifi**

Si usano i font Noto (licenza aperta) tramite `font-maker` di Protomaps.

`pipeline/build-glyphs.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
OUT="${1:?out-dir richiesta}"
mkdir -p "$OUT"

# Noto Sans: licenza SIL OFL, ridistribuibile
for FONT in "NotoSans-Regular" "NotoSans-Bold" "NotoSans-Italic"; do
  curl -sSL -o "/tmp/${FONT}.ttf" \
    "https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSans/hinted/ttf/${FONT}.ttf"
done

npx --yes @protomaps/font-maker \
  --font /tmp/NotoSans-Regular.ttf --name "Noto Sans Regular" --out "$OUT"
npx --yes @protomaps/font-maker \
  --font /tmp/NotoSans-Bold.ttf --name "Noto Sans Bold" --out "$OUT"
npx --yes @protomaps/font-maker \
  --font /tmp/NotoSans-Italic.ttf --name "Noto Sans Italic" --out "$OUT"

echo "== glifi in $OUT"
ls "$OUT"
```

```bash
chmod +x pipeline/build-glyphs.sh
bash pipeline/build-glyphs.sh style/glyphs
```

- [ ] **Step 2: Generare lo sprite**

`pipeline/build-sprite.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
SRC="${1:?dir svg richiesta}"
OUT="${2:?out prefix richiesto}"

# spreet produce sprite.png/.json e @2x, compatibili con la style spec
npx --yes spreet "$SRC" "$OUT"
npx --yes spreet --retina "$SRC" "${OUT}@2x"
echo "== sprite in ${OUT}.png / ${OUT}.json"
```

Le icone di partenza sono quelle dei POI OpenMapTiles piu' quelle Webmapp esistenti (il repo `webmapp-icons` in `~/Documents/webmapp-icons` e' la fonte da cui prelevare i simboli del brand). Popolare `style/sprite/svg/` con gli SVG necessari ai `class`/`subclass` usati nello stile, poi:

```bash
chmod +x pipeline/build-sprite.sh
mkdir -p style/sprite/svg
bash pipeline/build-sprite.sh style/sprite/svg style/sprite/webmapp
```

- [ ] **Step 3: Scrivere i test che falliscono**

`test/assets/routes.test.ts`:

```typescript
import {describe, expect, it} from 'vitest';
import request from 'supertest';
import {createApp} from '../../src/server.js';

const app = createApp();

describe('glifi', () => {
  it('serve un range di glifi come protobuf', async () => {
    const res = await request(app).get('/glyphs/Noto%20Sans%20Regular/0-255.pbf');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/x-protobuf');
  });

  it('risponde 404 per un fontstack inesistente', async () => {
    const res = await request(app).get('/glyphs/Font%20Inesistente/0-255.pbf');
    expect(res.status).toBe(404);
  });

  it('rifiuta path traversal nel fontstack', async () => {
    const res = await request(app).get('/glyphs/..%2F..%2Fetc/0-255.pbf');
    expect([400, 404]).toContain(res.status);
  });
});

describe('sprite', () => {
  it('serve il json dello sprite', async () => {
    const res = await request(app).get('/sprite/webmapp.json');
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe('object');
  });

  it('serve il png dello sprite', async () => {
    const res = await request(app).get('/sprite/webmapp.png');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
  });

  it('serve la variante retina', async () => {
    const res = await request(app).get('/sprite/webmapp@2x.png');
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 4: Eseguire i test e verificare che falliscano**

Run: `npm test -- test/assets`
Expected: FAIL — 404 su tutte le rotte

- [ ] **Step 5: Implementare `src/assets/routes.ts`**

```typescript
import express from 'express';
import {existsSync} from 'node:fs';
import {basename, join} from 'node:path';

const GLYPHS_DIR = 'style/glyphs';
const SPRITE_DIR = 'style/sprite';
const RANGE_RE = /^\d{1,5}-\d{1,5}$/;

export function assetRoutes(): express.Router {
  const router = express.Router();

  router.get('/glyphs/:fontstack/:range.pbf', (req, res) => {
    const range = req.params.range;
    // basename neutralizza qualunque tentativo di risalita del path
    const fontstack = basename(req.params.fontstack);
    if (!RANGE_RE.test(range)) {
      res.status(400).json({error: 'range non valido'});
      return;
    }
    const path = join(GLYPHS_DIR, fontstack, `${range}.pbf`);
    if (!existsSync(path)) {
      res.status(404).end();
      return;
    }
    res.set({
      'Content-Type': 'application/x-protobuf',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
    });
    res.sendFile(path, {root: process.cwd()});
  });

  router.use(
    '/sprite',
    express.static(SPRITE_DIR, {
      maxAge: '365d',
      immutable: true,
      setHeaders: res => res.set('Access-Control-Allow-Origin', '*'),
    }),
  );

  return router;
}
```

- [ ] **Step 6: Montare, testare, verificare nella preview**

In `createApp()`: `app.use(assetRoutes());`

Run: `npm test`
Expected: PASS

Aprire `/preview`: le etichette dei luoghi ora compaiono.

- [ ] **Step 7: Commit**

```bash
git add pipeline/build-glyphs.sh pipeline/build-sprite.sh src/assets src/server.ts test/assets style/glyphs style/sprite
git commit -m "feat(server-tiles-osm): glifi e sprite serviti da URL stabili"
```

---

## Task 11: Rilievo — hillshade e curve di livello dal DEM

Il DEM e' l'unico dato non-OSM e cambia praticamente mai: si genera una volta, e la rigenerazione settimanale non lo ricalcola. Vive in una directory di versione propria, `dem/`, non in quelle datate degli archivi OSM.

**Files:**
- Create: `pipeline/build-hillshade.sh`, `pipeline/build-contours.sh`
- Modify: `src/archive/store.ts` (risoluzione del path per gli archivi DEM), `src/config.ts`
- Test: `test/archive/dem.test.ts`

**Interfaces:**
- Consumes: `Config`
- Produces: `data/archives/dem/hillshade.pmtiles` e `data/archives/dem/contours.pmtiles`; `getTile` accetta `version: 'dem'` per gli archivi `hillshade` e `contours`

- [ ] **Step 1: Scaricare e unire il DEM**

Tinitaly e' distribuito in riquadri da scaricare dal portale INGV (`https://tinitaly.pi.ingv.it/`); la licenza richiede attribuzione. Per lo sviluppo si puo' partire da un solo riquadro.

`pipeline/build-hillshade.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
# Uso: build-hillshade.sh <dir-dem-tif> <out-dir>
DEM_DIR="${1:?dir con i tif del DEM}"
OUT_DIR="${2:?out-dir}"
WORK="$(mktemp -d)"
mkdir -p "$OUT_DIR"

echo "== mosaico DEM"
gdalbuildvrt "${WORK}/dem.vrt" "${DEM_DIR}"/*.tif

echo "== riproiezione in Web Mercator"
gdalwarp -t_srs EPSG:3857 -r bilinear -multi \
  -co COMPRESS=DEFLATE "${WORK}/dem.vrt" "${WORK}/dem3857.tif"

echo "== hillshade"
# -z 1.5 attenua l'effetto: l'hillshade delle PNG attuali e' tenue, non drammatico
gdaldem hillshade -z 1.5 -az 315 -alt 45 -compute_edges \
  "${WORK}/dem3857.tif" "${WORK}/hillshade.tif"

echo "== tiles raster"
gdal2tiles.py --xyz --zoom=5-12 --resampling=average --processes=4 \
  --tiledriver=PNG "${WORK}/hillshade.tif" "${WORK}/tiles"

echo "== impacchettamento in pmtiles"
npx --yes @protomaps/pmtiles-cli convert-directory \
  "${WORK}/tiles" "${OUT_DIR}/hillshade.pmtiles" || {
    echo "!! se il convert-directory non e' disponibile, usare mb-util per creare"
    echo "   un mbtiles e poi 'pmtiles convert hillshade.mbtiles hillshade.pmtiles'"
    exit 1
  }

cat > "${OUT_DIR}/provenance-hillshade.json" <<JSON
{
  "archive": "hillshade",
  "version": "dem",
  "generator": {"name": "gdaldem", "version": "$(gdalinfo --version)"},
  "sources": [{"name": "Tinitaly 10m", "url": "https://tinitaly.pi.ingv.it/", "sha256": "", "retrievedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"}],
  "maxzoom": 12,
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "attribution": "DEM Tinitaly © INGV"
}
JSON

rm -rf "$WORK"
echo "== fatto: ${OUT_DIR}/hillshade.pmtiles"
```

- [ ] **Step 2: Generare le curve di livello**

L'equidistanza varia per zoom: curve dense a scala piccola sarebbero illeggibili e pesantissime.

`pipeline/build-contours.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
DEM_DIR="${1:?dir con i tif del DEM}"
OUT_DIR="${2:?out-dir}"
WORK="$(mktemp -d)"
mkdir -p "$OUT_DIR"

gdalbuildvrt "${WORK}/dem.vrt" "${DEM_DIR}"/*.tif

# Tre equidistanze, ognuna per una fascia di zoom.
# L'attributo `index` marca le curve indice (multipli di 5 intervalli),
# che lo stile disegna piu' spesse e con la quota.
generate() {
  local interval="$1" name="$2"
  gdal_contour -a elevation -i "$interval" -f GeoJSON \
    "${WORK}/dem.vrt" "${WORK}/${name}.geojson"
  jq -c --argjson step "$interval" \
    '.features[] | .tippecanoe = {layer: "contour"} |
     .properties.index = (if ((.properties.elevation / ($step * 5)) % 1) == 0 then 1 else 0 end) | .' \
    "${WORK}/${name}.geojson" > "${WORK}/${name}.ndjson"
}

generate 200 c200   # z11-12
generate 100 c100   # z13
generate 50  c50    # z14

tippecanoe -o "${WORK}/contours.mbtiles" \
  --force --no-feature-limit --no-tile-size-limit \
  --layer=contour --attribute-type=elevation:int --attribute-type=index:int \
  -Z11 -z11 "${WORK}/c200.ndjson" \
  || true

# Ogni fascia va tilata al proprio zoom e poi unita
tippecanoe -o "${WORK}/c200.mbtiles" --force -l contour -Z11 -z12 "${WORK}/c200.ndjson"
tippecanoe -o "${WORK}/c100.mbtiles" --force -l contour -Z13 -z13 "${WORK}/c100.ndjson"
tippecanoe -o "${WORK}/c50.mbtiles"  --force -l contour -Z14 -z14 "${WORK}/c50.ndjson"
tile-join -o "${WORK}/contours.mbtiles" --force \
  "${WORK}/c200.mbtiles" "${WORK}/c100.mbtiles" "${WORK}/c50.mbtiles"

npx --yes pmtiles convert "${WORK}/contours.mbtiles" "${OUT_DIR}/contours.pmtiles"

cat > "${OUT_DIR}/provenance-contours.json" <<JSON
{
  "archive": "contours",
  "version": "dem",
  "generator": {"name": "gdal_contour+tippecanoe", "version": "$(gdalinfo --version)"},
  "sources": [{"name": "Tinitaly 10m", "url": "https://tinitaly.pi.ingv.it/", "sha256": "", "retrievedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"}],
  "maxzoom": 14,
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "attribution": "DEM Tinitaly © INGV"
}
JSON

rm -rf "$WORK"
echo "== fatto: ${OUT_DIR}/contours.pmtiles"
```

```bash
chmod +x pipeline/build-hillshade.sh pipeline/build-contours.sh
```

- [ ] **Step 3: Eseguire su un riquadro di prova**

```bash
mkdir -p data/dem-src data/archives/dem
# scaricare almeno un riquadro Tinitaly in data/dem-src/
docker run --rm -v "$PWD/data:/work/data" -v "$PWD/pipeline:/work/pipeline" \
  wm-tiles-pipeline bash pipeline/build-hillshade.sh /work/data/dem-src /work/data/archives/dem
docker run --rm -v "$PWD/data:/work/data" -v "$PWD/pipeline:/work/pipeline" \
  wm-tiles-pipeline bash pipeline/build-contours.sh /work/data/dem-src /work/data/archives/dem
ls -la data/archives/dem/
```

- [ ] **Step 4: Scrivere il test**

`test/archive/dem.test.ts`:

```typescript
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {getTile} from '../../src/archive/store.js';
import {layerNames} from '../../src/tiles/filter.js';
import {gunzipSync} from 'node:zlib';

const DIR = 'data/archives';

describe('archivi DEM', () => {
  it('hillshade serve tile raster PNG', async () => {
    const t = await getTile(DIR, 'dem', 'hillshade', 8, 137, 95);
    expect(t).not.toBeNull();
    expect(t![0]).toBe(0x89); // magic PNG
  });

  it('contours serve tile vettoriali con il layer contour', async () => {
    const t = await getTile(DIR, 'dem', 'contours', 12, 2190, 1500);
    expect(t).not.toBeNull();
    const raw = t![0] === 0x1f && t![1] === 0x8b ? new Uint8Array(gunzipSync(t!)) : t!;
    expect(layerNames(raw)).toContain('contour');
  });

  it('la provenienza del DEM attribuisce INGV', () => {
    const p = JSON.parse(readFileSync(`${DIR}/dem/provenance-hillshade.json`, 'utf8'));
    expect(p.attribution).toContain('INGV');
  });
});
```

Le coordinate dei test vanno adattate al riquadro effettivamente scaricato: ricavarle con `npx pmtiles show data/archives/dem/hillshade.pmtiles` che stampa i bounds e i livelli disponibili.

- [ ] **Step 5: Consentire `version: 'dem'` in `versions.ts`**

`listVersions` filtra per il pattern `YYYYMMDD-HHMM` e quindi esclude `dem` — corretto, perche' `dem` non e' una versione OSM. Aggiungere in `src/archive/versions.ts`:

```typescript
export const DEM_VERSION = 'dem';

export function isValidVersion(archiveDir: string, version: string): boolean {
  return version === DEM_VERSION || listVersions(archiveDir).includes(version);
}
```

e in `src/tiles/routes.ts` sostituire il controllo:

```typescript
    if (!isValidVersion(cfg.archiveDir, version)) {
      res.status(404).json({error: `versione non disponibile: ${version}`});
      return;
    }
```

Il controllo di `maxzoom` va reso tollerante per `dem`, che ha un `provenance-<archive>.json` invece di `provenance.json`:

```typescript
    const maxzoom = version === DEM_VERSION
      ? (archive === 'hillshade' ? 12 : 14)
      : readProvenance(cfg.archiveDir, version).maxzoom;
```

- [ ] **Step 6: Eseguire i test**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add pipeline/build-hillshade.sh pipeline/build-contours.sh src/archive src/tiles/routes.ts test/archive/dem.test.ts
git commit -m "feat(server-tiles-osm): archivi DEM per hillshade e curve di livello"
```

---

## Task 12: Convergenza dello stile sull'aspetto attuale

Il task piu' lungo e l'unico iterativo. Non ha un test automatico che possa dire "ora e' uguale": la verifica e' visiva, sulla preview, contro le PNG reali. I test automatici coprono solo le invarianti strutturali.

**Files:**
- Modify: `style/webmapp.json` (iterazioni)
- Modify: `manifest/layers.v1.json` (correzione del difetto noto su `paths`)
- Modify: `src/style/routes.ts` (source hillshade e contours)
- Create: `docs/features/server-tiles-osm/style-comparison.md`
- Test: `test/style/invariants.test.ts`

**Interfaces:**
- Consumes: archivi `dem`, stile base, preview
- Produces: `style/webmapp.json` con hillshade e contours composti; `manifest/layers.v1.json` v1 corretto

- [ ] **Step 1: Aggiungere le source del rilievo allo style**

In `src/style/routes.ts`, dentro l'assegnazione di `style.sources`:

```typescript
    style.sources = {
      openmaptiles: {
        type: 'vector',
        tiles: [`${base}/t/${version}/${resolved.setId}/osm/{z}/{x}/{y}.pbf`],
        minzoom: 0,
        maxzoom: 14,
        attribution: ATTRIBUTION,
      },
      hillshade: {
        type: 'raster',
        tiles: [`${base}/t/dem/${resolved.setId}/hillshade/{z}/{x}/{y}.pbf`],
        tileSize: 256,
        minzoom: 5,
        maxzoom: 12,
        attribution: ATTRIBUTION_DEM,
      },
      contours: {
        type: 'vector',
        tiles: [`${base}/t/dem/${resolved.setId}/contours/{z}/{x}/{y}.pbf`],
        minzoom: 11,
        maxzoom: 14,
        attribution: ATTRIBUTION_DEM,
      },
    };
```

Nota: l'estensione `.pbf` sull'hillshade raster e' voluta — il path e' uniforme e il `Content-Type` reale e' `image/png`, impostato dalla rotta in base all'archivio. In `src/tiles/routes.ts` aggiungere:

```typescript
    const isRaster = archive === 'hillshade';
    res.set('Content-Type', isRaster ? 'image/png' : 'application/vnd.mapbox-vector-tile');
```

e saltare filtro e ricompressione quando `isRaster` (una PNG non ha layer da filtrare):

```typescript
    if (isRaster) {
      res.set({'Cache-Control': 'public, max-age=31536000, immutable', 'Access-Control-Allow-Origin': '*'});
      res.status(200).send(Buffer.from(raw));
      return;
    }
```

- [ ] **Step 2: Comporre i layer del rilievo nello stile**

Aggiungere in `style/webmapp.json`, **subito dopo** `background` (l'hillshade sta sotto tutto il resto) e in coda per i contours:

```json
    {"id": "hillshade", "type": "raster", "source": "hillshade",
     "paint": {"raster-opacity": 0.35, "raster-contrast": -0.1}},
```

e prima delle etichette:

```json
    {"id": "contour", "type": "line", "source": "contours", "source-layer": "contour",
     "minzoom": 11,
     "paint": {"line-color": "#b09070",
               "line-width": ["case", ["==", ["get", "index"], 1], 0.9, 0.5],
               "line-opacity": 0.55}},
    {"id": "contour-label", "type": "symbol", "source": "contours", "source-layer": "contour",
     "minzoom": 13,
     "filter": ["==", ["get", "index"], 1],
     "layout": {"symbol-placement": "line", "text-field": ["to-string", ["get", "elevation"]],
                "text-font": ["Noto Sans Regular"], "text-size": 9, "text-rotation-alignment": "map"},
     "paint": {"text-color": "#8a6f52", "text-halo-color": "#f4f0e6", "text-halo-width": 1}},
```

- [ ] **Step 3: Correggere il difetto noto del manifest su `paths`**

`paths` e `roads` condividono il layer tecnico `transportation`, quindi non sono separabili dal filtro. Due opzioni; scegliere la prima:

1. **Unire i due gruppi** in `roads` (etichetta "Strade e sentieri"), rimuovendo `paths` dal manifest. Corretto perche' non promette una separazione che il dato non consente.
2. Separare i sentieri in un layer proprio nella generazione (richiede uno schema planetiler custom). Rinviato: e' un cambio di schema, non di manifest.

Applicare l'opzione 1: rimuovere il gruppo `paths` da `manifest/layers.v1.json` e dal `defaultSet`, e cambiare l'etichetta di `roads` in `{"it": "Strade e sentieri", "en": "Roads and paths"}`.

- [ ] **Step 4: Scrivere il test delle invarianti dello stile**

`test/style/invariants.test.ts`:

```typescript
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {loadManifest} from '../../src/manifest/registry.js';

const style = JSON.parse(readFileSync('style/webmapp.json', 'utf8'));
const manifest = loadManifest('manifest/layers.v1.json');

describe('invarianti dello stile', () => {
  it('ogni layer con source-layer referenzia un layer dichiarato nel manifest', () => {
    const declared = new Set(manifest.groups.flatMap(g => g.layers));
    for (const l of style.layers) {
      if (!l['source-layer']) continue;
      expect(declared, `layer di stile ${l.id}`).toContain(l['source-layer']);
    }
  });

  it('l hillshade e disegnato sotto tutti i layer vettoriali', () => {
    const ids = style.layers.map((l: {id: string}) => l.id);
    const hill = ids.indexOf('hillshade');
    expect(hill).toBeGreaterThanOrEqual(0);
    expect(hill).toBeLessThan(ids.indexOf('water'));
  });

  it('le etichette sono disegnate sopra le geometrie', () => {
    const ids = style.layers.map((l: {id: string}) => l.id);
    expect(ids.indexOf('place-label')).toBeGreaterThan(ids.indexOf('road-fill'));
  });

  it('ogni layer symbol usa un fontstack per cui esistono i glifi', () => {
    const available = new Set(['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic']);
    for (const l of style.layers) {
      if (l.type !== 'symbol') continue;
      for (const f of l.layout['text-font']) {
        expect(available, `font di ${l.id}`).toContain(f);
      }
    }
  });

  it('nessun gruppo del manifest condivide layer tecnici con un altro', () => {
    const seen = new Map<string, string>();
    for (const g of manifest.groups) {
      for (const l of g.layers) {
        const prev = seen.get(l);
        expect(prev, `il layer ${l} e in ${prev} e in ${g.id}: i gruppi non sarebbero separabili`).toBeUndefined();
        seen.set(l, g.id);
      }
    }
  });
});
```

- [ ] **Step 5: Eseguire i test**

Run: `npm test -- test/style`
Expected: PASS — in particolare l'ultimo test, che ora passa perche' `paths` e' stato unito a `roads`

- [ ] **Step 6: Ciclo di convergenza visiva**

Questo e' il lavoro vero. Per ogni zona campione (montagna, citta, costa, pianura) e per ogni zoom in `{9, 11, 12, 13, 14, 16}`:

```bash
npm run dev
```

Aprire `/preview`, selezionare la zona, confrontare i due pannelli e annotare le differenze in `docs/features/server-tiles-osm/style-comparison.md` con questa struttura:

```markdown
## <zona> z<N>

| Elemento | PNG attuale | Vettoriale | Azione |
|---|---|---|---|
| fondo | beige #f4f0e6 | ok | — |
| bosco | verde salvia piu saturo | troppo pallido | alzare saturazione fill-color |
| strade secondarie | assenti a z11 | presenti | alzare minzoom |
```

Iterare su `style/webmapp.json` fino a esaurire le voci con azione. Committare ad ogni gruppo coerente di modifiche:

```bash
git add style/webmapp.json docs/features/server-tiles-osm/style-comparison.md
git commit -m "feat(server-tiles-osm): stile, convergenza su <zona> z<N>"
```

Criterio di uscita: nessuna differenza residua che un utente noterebbe navigando, con le differenze accettate elencate esplicitamente nel documento di confronto. La parita' e' **approssimata per definizione** (renderer diversi, antialiasing diverso): l'obiettivo e' che nessuno se ne accorga, non che i pixel coincidano.

- [ ] **Step 7: Far approvare il confronto**

Mostrare `style-comparison.md` e la preview al developer. L'approvazione e' un requisito dell'overview (sezione Migrazione), non una formalita': e' il punto in cui si decide che lo stile e' pronto.

- [ ] **Step 8: Commit finale del task**

```bash
git add style manifest src/style src/tiles/routes.ts test/style docs/features/server-tiles-osm/style-comparison.md
git commit -m "feat(server-tiles-osm): stile con rilievo composto e manifest corretto"
```

---

## Task 13: Renderer raster

**Il punto fragile del progetto.** `@maplibre/maplibre-gl-native` e' una build nativa con storia di attriti di installazione. Il primo step e' una verifica di fattibilita': se non regge, si passa a `tileserver-gl` come processo separato, funzionalmente equivalente.

**Files:**
- Create: `src/raster/render.ts`, `src/raster/cache.ts`, `src/raster/routes.ts`
- Modify: `src/server.ts`
- Test: `test/raster/cache.test.ts`, `test/raster/routes.test.ts`

**Interfaces:**
- Consumes: `styleRoutes` (per ottenere lo style risolto), `Config`
- Produces:
  - `renderTile(style: object, z: number, x: number, y: number): Promise<Buffer>` — PNG 256x256
  - `cacheKey(version: string, setId: string, z: number, x: number, y: number): string`
  - `readCached(dir: string, key: string): Promise<Buffer | null>` / `writeCached(dir: string, key: string, png: Buffer): Promise<void>`
  - `rasterRoutes(deps): express.Router` che monta `GET /t/:version/:set/raster/:z/:x/:y.png`

- [ ] **Step 1: Verificare la fattibilita' del rendering nativo**

```bash
npm install @maplibre/maplibre-gl-native sharp
cat > /tmp/spike-render.ts <<'TS'
import mbgl from '@maplibre/maplibre-gl-native';
console.log('modulo caricato:', typeof mbgl.Map);
const map = new mbgl.Map({
  request: (req, cb) => cb(new Error('nessuna risorsa in questo spike')),
  ratio: 1,
});
console.log('istanza creata');
map.release();
console.log('OK: il rendering nativo e disponibile');
TS
npx tsx /tmp/spike-render.ts
```

Expected: `OK: il rendering nativo e disponibile`

**Se lo spike falla** (errore di build, libreria di sistema mancante, segfault): fermarsi, registrare l'errore in `notes.md` e passare al piano alternativo — aggiungere `tileserver-gl` come servizio in `docker-compose.yml`, e implementare `render.ts` come proxy HTTP verso di esso. Il resto del task (cache, rotte, limiti, test) resta identico: cambia solo il corpo di `renderTile`.

- [ ] **Step 2: Scrivere i test che falliscono**

`test/raster/cache.test.ts`:

```typescript
import {describe, expect, it, beforeEach} from 'vitest';
import {rmSync, mkdirSync} from 'node:fs';
import {cacheKey, readCached, writeCached} from '../../src/raster/cache.js';

const DIR = 'data/test-raster-cache';

describe('cache raster', () => {
  beforeEach(() => {
    rmSync(DIR, {recursive: true, force: true});
    mkdirSync(DIR, {recursive: true});
  });

  it('la chiave include versione, set e coordinate', () => {
    const k = cacheKey('20260904-1200', 'abc123abc123', 9, 268, 182);
    expect(k).toContain('20260904-1200');
    expect(k).toContain('abc123abc123');
    expect(k).toContain('9');
  });

  it('versioni diverse producono chiavi diverse: la rigenerazione si propaga', () => {
    const a = cacheKey('20260904-1200', 'abc', 9, 268, 182);
    const b = cacheKey('20260911-1200', 'abc', 9, 268, 182);
    expect(a).not.toBe(b);
  });

  it('set diversi producono chiavi diverse', () => {
    expect(cacheKey('v', 'aaa', 1, 1, 1)).not.toBe(cacheKey('v', 'bbb', 1, 1, 1));
  });

  it('scrive e rilegge una tile', async () => {
    const key = cacheKey('v1', 'set1', 3, 4, 5);
    await writeCached(DIR, key, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const got = await readCached(DIR, key);
    expect(got).not.toBeNull();
    expect(got![0]).toBe(0x89);
  });

  it('restituisce null su cache miss', async () => {
    expect(await readCached(DIR, cacheKey('v', 's', 1, 1, 1))).toBeNull();
  });

  it('la scrittura e atomica: nessun file parziale visibile', async () => {
    const key = cacheKey('v1', 'set1', 3, 4, 6);
    await writeCached(DIR, key, Buffer.alloc(1024, 7));
    const got = await readCached(DIR, key);
    expect(got!.byteLength).toBe(1024);
  });
});
```

`test/raster/routes.test.ts`:

```typescript
import {describe, expect, it} from 'vitest';
import request from 'supertest';
import {createApp} from '../../src/server.js';
import {loadManifest} from '../../src/manifest/registry.js';
import {setIdFor} from '../../src/sets/resolve.js';
import {currentVersion} from '../../src/archive/versions.js';

const app = createApp();
const m = loadManifest('manifest/layers.v1.json');
const V = currentVersion('data/archives')!;
const S = setIdFor(m.defaultSet);

describe('GET /t/:version/:set/raster/:z/:x/:y.png', () => {
  it('rende una PNG 256x256', async () => {
    const res = await request(app).get(`/t/${V}/${S}/raster/9/268/182.png`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
  }, 30_000);

  it('dichiara l attribuzione: obbligatoria anche sulle immagini generate', async () => {
    const res = await request(app).get(`/t/${V}/${S}/raster/9/268/182.png`);
    expect(res.headers['x-attribution']).toContain('OpenStreetMap');
  }, 30_000);

  it('la seconda richiesta arriva dalla cache', async () => {
    await request(app).get(`/t/${V}/${S}/raster/9/268/183.png`);
    const res = await request(app).get(`/t/${V}/${S}/raster/9/268/183.png`);
    expect(res.headers['x-cache']).toBe('hit');
  }, 30_000);

  it('oltre lo zoom massimo consentito risponde in modo esplicito, non silenzioso', async () => {
    const res = await request(app).get(`/t/${V}/${S}/raster/19/1/1.png`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/zoom/);
  });

  it('sotto lo zoom minimo risponde in modo esplicito', async () => {
    const res = await request(app).get(`/t/${V}/${S}/raster/2/1/1.png`);
    expect(res.status).toBe(400);
  });

  it('limita le richieste concorrenti di rendering', async () => {
    const reqs = Array.from({length: 40}, (_, i) =>
      request(app).get(`/t/${V}/${S}/raster/12/2190/${1500 + i}.png`),
    );
    const results = await Promise.all(reqs);
    const codes = new Set(results.map(r => r.status));
    // Il renderer non deve accettare tutto: o mette in coda, o rifiuta con 429
    expect([...codes].every(c => c === 200 || c === 429)).toBe(true);
  }, 120_000);
});
```

- [ ] **Step 3: Eseguire i test e verificare che falliscano**

Run: `npm test -- test/raster`
Expected: FAIL — moduli non trovati

- [ ] **Step 4: Implementare la cache**

`src/raster/cache.ts`:

```typescript
import {createHash} from 'node:crypto';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';

export function cacheKey(version: string, setId: string, z: number, x: number, y: number): string {
  return `${version}/${setId}/${z}/${x}/${y}`;
}

function pathFor(dir: string, key: string): string {
  // La chiave e' gia' gerarchica; l'hash finale evita directory con troppi file
  const h = createHash('sha1').update(key).digest('hex').slice(0, 2);
  return join(dir, h, `${key.replace(/\//g, '_')}.png`);
}

export async function readCached(dir: string, key: string): Promise<Buffer | null> {
  try {
    return await readFile(pathFor(dir, key));
  } catch {
    return null;
  }
}

export async function writeCached(dir: string, key: string, png: Buffer): Promise<void> {
  const path = pathFor(dir, key);
  await mkdir(dirname(path), {recursive: true});
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, png);
  await rename(tmp, path);
}
```

- [ ] **Step 5: Implementare il renderer**

`src/raster/render.ts`. Il punto delicato: MapLibre lavora con tile logiche da 512px, quindi una tile XYZ da 256px al livello `z` corrisponde al centro della tile con zoom `z - 1`.

```typescript
import mbgl from '@maplibre/maplibre-gl-native';
import sharp from 'sharp';
import {log} from '../obs/log.js';

const TILE_SIZE = 256;

function tileCenter(z: number, x: number, y: number): [number, number] {
  const n = 2 ** z;
  const lon = ((x + 0.5) / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n)));
  return [lon, (latRad * 180) / Math.PI];
}

async function fetchResource(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`risorsa non disponibile: ${url} (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

export async function renderTile(style: object, z: number, x: number, y: number): Promise<Buffer> {
  const map = new mbgl.Map({
    ratio: 1,
    request: (req: {url: string}, cb: (err?: Error | null, res?: {data: Buffer}) => void) => {
      fetchResource(req.url).then(
        data => cb(null, {data}),
        err => {
          log.warn('raster resource failed', {url: req.url, err: String(err)});
          cb(err as Error);
        },
      );
    },
  });

  try {
    map.load(style);
    const [lon, lat] = tileCenter(z, x, y);
    const raw: Buffer = await new Promise((resolve, reject) => {
      map.render(
        {zoom: Math.max(0, z - 1), center: [lon, lat], width: TILE_SIZE, height: TILE_SIZE},
        (err: Error | null, buffer: Buffer) => (err ? reject(err) : resolve(buffer)),
      );
    });
    return await sharp(raw, {raw: {width: TILE_SIZE, height: TILE_SIZE, channels: 4}}).png().toBuffer();
  } finally {
    map.release();
  }
}
```

- [ ] **Step 6: Implementare le rotte con limite di concorrenza**

`src/raster/routes.ts`:

```typescript
import express from 'express';
import {currentVersion, isValidVersion} from '../archive/versions.js';
import {Config} from '../config.js';
import {Manifest} from '../manifest/registry.js';
import {SetRegistry, resolveSet} from '../sets/resolve.js';
import {cacheKey, readCached, writeCached} from './cache.js';
import {renderTile} from './render.js';
import {log} from '../obs/log.js';

const MIN_ZOOM = 5;
const MAX_ZOOM = 18;
const MAX_CONCURRENT = 4;
const ATTRIBUTION = '© OpenStreetMap contributors (ODbL); DEM Tinitaly © INGV';

let inFlight = 0;

export interface RasterDeps {
  cfg: Config;
  manifest: Manifest;
  sets: SetRegistry;
  styleFor: (setId: string, base: string) => object;
}

export function rasterRoutes(deps: RasterDeps): express.Router {
  const router = express.Router();
  const {cfg, manifest, sets, styleFor} = deps;

  router.get('/t/:version/:set/raster/:z/:x/:y.png', async (req, res) => {
    const {version, set} = req.params;
    const z = Number(req.params.z);
    const x = Number(req.params.x);
    const y = Number(req.params.y);

    if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) {
      res.status(400).json({error: 'coordinate non valide'});
      return;
    }
    if (z < MIN_ZOOM || z > MAX_ZOOM) {
      res.status(400).json({error: `zoom ${z} fuori dall'intervallo servito (${MIN_ZOOM}-${MAX_ZOOM})`});
      return;
    }
    if (!isValidVersion(cfg.archiveDir, version)) {
      res.status(404).json({error: `versione non disponibile: ${version}`});
      return;
    }

    const resolved = resolveSet(manifest, set, sets);
    const key = cacheKey(version, resolved.setId, z, x, y);

    const cached = await readCached(cfg.rasterCacheDir, key);
    if (cached) {
      res.set({
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
        'X-Attribution': ATTRIBUTION,
        'X-Cache': 'hit',
      });
      res.status(200).send(cached);
      return;
    }

    if (inFlight >= MAX_CONCURRENT) {
      res.set('Retry-After', '2');
      res.status(429).json({error: 'renderer occupato'});
      return;
    }

    inFlight++;
    const t0 = performance.now();
    try {
      const base = `${req.protocol}://${req.get('host')}`;
      const png = await renderTile(styleFor(resolved.setId, base), z, x, y);
      await writeCached(cfg.rasterCacheDir, key, png);
      log.info('raster rendered', {
        version, set: resolved.setId, z, x, y,
        ms: Math.round(performance.now() - t0), bytes: png.byteLength,
      });
      res.set({
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
        'X-Attribution': ATTRIBUTION,
        'X-Cache': 'miss',
      });
      res.status(200).send(png);
    } catch (err) {
      log.error('raster render failed', {version, set: resolved.setId, z, x, y, err: String(err)});
      res.status(500).json({error: 'rendering fallito'});
    } finally {
      inFlight--;
    }
  });

  return router;
}
```

- [ ] **Step 7: Estrarre `styleFor` da `src/style/routes.ts`**

Il renderer ha bisogno dello stesso style servito ai client: e' l'invariante "il PNG e' una proiezione dello stesso stile". Estrarre la costruzione in una funzione esportata e usarla in entrambi i posti:

```typescript
export function buildStyle(deps: StyleDeps, setId: string, base: string): object {
  // corpo attuale della rotta, senza res
}
```

e in `createApp()`:

```typescript
  const styleDeps = {cfg, manifest, sets: setRegistry};
  app.use(styleRoutes(styleDeps));
  app.use(rasterRoutes({...styleDeps, styleFor: (setId, base) => buildStyle(styleDeps, setId, base)}));
```

- [ ] **Step 8: Eseguire i test**

Run: `npm test -- test/raster`
Expected: PASS — inclusi il test di cache hit e quello di limite di concorrenza

- [ ] **Step 9: Verificare l'invariante vettoriale/raster nella preview**

Aprire `/preview`, selezionare "PNG nuovo (raster)" nel pannello destro e confrontare con il vettoriale a sinistra sulle quattro zone. Le due rese devono essere sostanzialmente identiche: se divergono, il renderer non sta usando lo stesso stile e va indagato prima di procedere.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json src/raster src/style src/server.ts test/raster
git commit -m "feat(server-tiles-osm): renderer raster dallo stesso stile, con cache e limite di concorrenza"
```

---

## Task 14: Pipeline Italia, mirroring, ritenzione e schedulazione settimanale

Finora tutto ha girato su un estratto piccolo. Qui si passa all'Italia e si rende la pipeline non presidiata.

**Files:**
- Create: `pipeline/mirror.sh`, `pipeline/publish.sh`, `pipeline/prune.sh`, `pipeline/weekly.sh`
- Create: `.github/workflows/weekly-build.yml` (o l'equivalente cron sul server, secondo dove gira)
- Modify: `src/archive/versions.ts` (applicazione della ritenzione)
- Test: `test/archive/retention.test.ts`

**Interfaces:**
- Consumes: `build-osm.sh` (Task 2), `Config.retainedVersions`
- Produces: `pruneVersions(archiveDir: string, keep: number): string[]` — restituisce le versioni rimosse

- [ ] **Step 1: Mirroring degli input**

Gli input sono download da terzi: senza copia, un archivio non e' piu' ricostruibile.

`pipeline/mirror.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
# Uso: mirror.sh <area> <mirror-dir>
AREA="${1:?area richiesta}"
MIRROR="${2:?mirror-dir richiesta}"
mkdir -p "$MIRROR"

URL="https://download.geofabrik.de/europe/${AREA}-latest.osm.pbf"
STAMP="$(date -u +%Y%m%d)"
DEST="${MIRROR}/${AREA}-${STAMP}.osm.pbf"

echo "== mirror ${URL}"
curl -sSL --fail -o "${DEST}.tmp" "$URL"
curl -sSL --fail -o "${DEST}.md5" "${URL}.md5" || true
mv "${DEST}.tmp" "$DEST"
sha256sum "$DEST" > "${DEST}.sha256"

echo "== provider dichiarato: Geofabrik (https://download.geofabrik.de/)"
echo "== copia: $DEST"
ls -la "$MIRROR"
```

Il DEM Tinitaly va scaricato una volta e conservato nella stessa directory di mirror: e' un download una-tantum e non ha un provider che garantisca disponibilita' futura.

- [ ] **Step 2: Adattare `build-osm.sh` a usare il mirror**

Sostituire il blocco `--download` con l'uso del file locale, cosi' il build non dipende dalla rete:

```bash
# Al posto di --download --area=...
SRC_PBF="${3:?path del .osm.pbf dal mirror}"
java -Xmx16g -jar "$PLANETILER_JAR" \
  --osm-path="$SRC_PBF" \
  --maxzoom="$MAXZOOM" \
  --output="${WORK}/osm.pmtiles" \
  --force
```

Per l'Italia servono almeno 16 GB di RAM per la JVM e circa 100 GB di spazio temporaneo. Se la macchina ha meno memoria, aggiungere `--nodemap-type=sortedtable --storage=mmap`.

- [ ] **Step 3: Pubblicazione atomica e ritenzione**

`pipeline/publish.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
# Uso: publish.sh <version-dir> <archives-root>
SRC="${1:?version-dir}"
ROOT="${2:?archives-root}"
VERSION="$(basename "$SRC")"

# Verifiche prima di rendere visibile la versione: un archivio corrotto promosso
# spegne la mappa di tutte le app, e la CDN lo cachera'.
test -s "${SRC}/osm.pmtiles" || { echo "!! osm.pmtiles assente o vuoto"; exit 1; }
test -s "${SRC}/provenance.json" || { echo "!! provenance.json assente"; exit 1; }
npx --yes pmtiles show "${SRC}/osm.pmtiles" > "${SRC}/pmtiles-info.txt" || {
  echo "!! archivio non leggibile"; exit 1;
}
grep -q '"maxzoom": *14' "${SRC}/provenance.json" || { echo "!! maxzoom inatteso"; exit 1; }

mv "$SRC" "${ROOT}/${VERSION}"
echo "== promossa ${VERSION}"
```

`pipeline/prune.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="${1:?archives-root}"
KEEP="${2:-3}"

mapfile -t versions < <(find "$ROOT" -maxdepth 1 -type d -regextype posix-extended \
  -regex '.*/[0-9]{8}-[0-9]{4}$' -printf '%f\n' | sort -r)

echo "== versioni presenti: ${#versions[@]}, conservate: ${KEEP}"
for v in "${versions[@]:$KEEP}"; do
  echo "== rimozione ${v}"
  rm -rf "${ROOT}/${v}"
done
```

- [ ] **Step 4: Orchestrazione settimanale**

`pipeline/weekly.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="${ARCHIVES_ROOT:?}"
MIRROR="${MIRROR_DIR:?}"
AREA="${AREA:-italy}"
KEEP="${RETAINED_VERSIONS:-3}"

notify() {
  local status="$1" msg="$2"
  echo "{\"event\":\"weekly-build\",\"status\":\"${status}\",\"msg\":\"${msg}\",\"ts\":\"$(date -u +%FT%TZ)\"}"
  if [ -n "${NOTIFY_WEBHOOK:-}" ]; then
    curl -sS -X POST "$NOTIFY_WEBHOOK" -H 'Content-Type: application/json' \
      -d "{\"status\":\"${status}\",\"msg\":\"${msg}\"}" || true
  fi
}

trap 'notify failed "build interrotto alla riga $LINENO"' ERR

START="$(date -u +%s)"
bash pipeline/mirror.sh "$AREA" "$MIRROR"
SRC="$(find "$MIRROR" -name "${AREA}-*.osm.pbf" | sort | tail -1)"
bash pipeline/build-osm.sh "$AREA" "$ROOT" "$SRC"
NEW="$(find "$ROOT" -maxdepth 1 -type d -regextype posix-extended -regex '.*/[0-9]{8}-[0-9]{4}$' | sort | tail -1)"
bash pipeline/prune.sh "$ROOT" "$KEEP"
notify ok "versione $(basename "$NEW") pubblicata in $(( $(date -u +%s) - START ))s"
```

```bash
chmod +x pipeline/mirror.sh pipeline/publish.sh pipeline/prune.sh pipeline/weekly.sh
```

- [ ] **Step 5: Schedulazione**

Se il build gira su un server Webmapp, aggiungere al crontab dell'utente di servizio:

```cron
# build settimanale wm-tiles: lunedi 03:00
0 3 * * 1 cd /srv/wm-tiles && ARCHIVES_ROOT=/srv/wm-tiles/data/archives MIRROR_DIR=/srv/wm-tiles/data/mirror AREA=italy NOTIFY_WEBHOOK=<url> bash pipeline/weekly.sh >> /var/log/wm-tiles-build.log 2>&1
```

Se gira in CI, `.github/workflows/weekly-build.yml`:

```yaml
name: weekly-build
on:
  schedule:
    - cron: '0 3 * * 1'
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 360
    steps:
      - uses: actions/checkout@v4
      - name: Build immagine pipeline
        run: docker build -f pipeline/Dockerfile.planetiler -t wm-tiles-pipeline pipeline/
      - name: Build settimanale
        env:
          ARCHIVES_ROOT: ${{ github.workspace }}/data/archives
          MIRROR_DIR: ${{ github.workspace }}/data/mirror
          AREA: italy
          NOTIFY_WEBHOOK: ${{ secrets.WM_TILES_NOTIFY_WEBHOOK }}
        run: bash pipeline/weekly.sh
      - name: Notifica fallimento
        if: failure()
        run: echo "build fallito" >&2
```

- [ ] **Step 6: Scrivere il test sulla ritenzione**

`test/archive/retention.test.ts`:

```typescript
import {describe, expect, it, beforeEach} from 'vitest';
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {listVersions, pruneVersions} from '../../src/archive/versions.js';

const DIR = 'data/test-archives';

function makeVersion(v: string): void {
  mkdirSync(join(DIR, v), {recursive: true});
  writeFileSync(join(DIR, v, 'osm.pmtiles'), 'x');
}

describe('ritenzione delle versioni', () => {
  beforeEach(() => {
    rmSync(DIR, {recursive: true, force: true});
    mkdirSync(DIR, {recursive: true});
    for (const v of ['20260801-0300', '20260808-0300', '20260815-0300', '20260822-0300']) {
      makeVersion(v);
    }
  });

  it('conserva le N piu recenti e rimuove le altre', () => {
    const removed = pruneVersions(DIR, 2);
    expect(removed).toEqual(['20260808-0300', '20260801-0300']);
    expect(listVersions(DIR)).toEqual(['20260822-0300', '20260815-0300']);
  });

  it('non rimuove nulla se le versioni sono meno del limite', () => {
    expect(pruneVersions(DIR, 10)).toEqual([]);
  });

  it('non rimuove mai la versione corrente', () => {
    pruneVersions(DIR, 1);
    expect(listVersions(DIR)).toEqual(['20260822-0300']);
  });

  it('rifiuta keep < 1: lascerebbe il servizio senza archivi', () => {
    expect(() => pruneVersions(DIR, 0)).toThrow(/keep/);
  });
});
```

- [ ] **Step 7: Implementare `pruneVersions`**

In `src/archive/versions.ts`:

```typescript
import {rmSync} from 'node:fs';

export function pruneVersions(archiveDir: string, keep: number): string[] {
  if (keep < 1) throw new Error('pruneVersions: keep deve essere >= 1');
  const all = listVersions(archiveDir);
  const removed = all.slice(keep);
  for (const v of removed) {
    rmSync(join(archiveDir, v), {recursive: true, force: true});
    log.warn('archive version pruned', {version: v});
  }
  return removed;
}
```

con gli import necessari (`log` da `../obs/log.js`).

- [ ] **Step 8: Eseguire il build Italia**

```bash
docker run --rm -v "$PWD/data:/work/data" -v "$PWD/pipeline:/work/pipeline" \
  -e ARCHIVES_ROOT=/work/data/archives -e MIRROR_DIR=/work/data/mirror -e AREA=italy \
  wm-tiles-pipeline bash pipeline/weekly.sh
du -sh data/archives/*/
```
Expected: un archivio dell'Italia nell'ordine del gigabyte. Registrare in `notes.md` la dimensione effettiva e la durata del build: sono i numeri che servono a dimensionare storage e finestra di schedulazione.

- [ ] **Step 9: Eseguire i test e verificare la preview sull'Italia**

Run: `npm test`
Expected: PASS

Aprire `/preview` sulle quattro zone campione, che ora sono coperte da dati reali.

- [ ] **Step 10: Commit**

```bash
git add pipeline src/archive/versions.ts test/archive/retention.test.ts .github
git commit -m "feat(server-tiles-osm): pipeline Italia con mirroring, pubblicazione verificata, ritenzione e schedulazione"
```

---

## Task 15: Rigenerazione on-demand su bounding box

Job batch pesante esposto in rete: autenticato, con limite di area e quota. Senza questi vincoli e' un vettore di consumo di risorse.

**Files:**
- Create: `src/ondemand/routes.ts`, `src/ondemand/jobs.ts`, `pipeline/build-bbox.sh`
- Modify: `src/server.ts`, `src/config.ts`
- Test: `test/ondemand/routes.test.ts`

**Interfaces:**
- Consumes: `Config` (con `onDemandToken: string`, `onDemandMaxAreaKm2: number`, `onDemandMaxPerDay: number`)
- Produces:
  - `onDemandRoutes(deps): express.Router` che monta `POST /jobs/bbox` e `GET /jobs/:id`
  - `areaKm2(bbox: [number, number, number, number]): number`
  - `Job = {id: string; status: 'queued' | 'running' | 'done' | 'failed'; bbox: number[]; version?: string; error?: string; createdAt: string}`

- [ ] **Step 1: Scrivere i test che falliscono**

`test/ondemand/routes.test.ts`:

```typescript
import {describe, expect, it} from 'vitest';
import request from 'supertest';
import {createApp} from '../../src/server.js';
import {areaKm2} from '../../src/ondemand/jobs.js';

const app = createApp();
const TOKEN = process.env.ONDEMAND_TOKEN ?? 'test-token';
const TOSCANA = [10.2, 43.6, 11.4, 44.2];

describe('areaKm2', () => {
  it('calcola un ordine di grandezza plausibile', () => {
    const a = areaKm2(TOSCANA as [number, number, number, number]);
    expect(a).toBeGreaterThan(1_000);
    expect(a).toBeLessThan(20_000);
  });
});

describe('POST /jobs/bbox', () => {
  it('rifiuta senza token', async () => {
    const res = await request(app).post('/jobs/bbox').send({bbox: TOSCANA});
    expect(res.status).toBe(401);
  });

  it('rifiuta con token errato', async () => {
    const res = await request(app)
      .post('/jobs/bbox')
      .set('Authorization', 'Bearer sbagliato')
      .send({bbox: TOSCANA});
    expect(res.status).toBe(401);
  });

  it('accetta un bbox valido e restituisce un job', async () => {
    const res = await request(app)
      .post('/jobs/bbox')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({bbox: TOSCANA});
    expect(res.status).toBe(202);
    expect(res.body.id).toBeTruthy();
    expect(res.body.status).toBe('queued');
  });

  it('rifiuta un bbox troppo grande', async () => {
    const res = await request(app)
      .post('/jobs/bbox')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({bbox: [-180, -85, 180, 85]});
    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/area/);
  });

  it('rifiuta un bbox malformato', async () => {
    const res = await request(app)
      .post('/jobs/bbox')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({bbox: [10, 43]});
    expect(res.status).toBe(400);
  });

  it('rifiuta un bbox con coordinate invertite', async () => {
    const res = await request(app)
      .post('/jobs/bbox')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({bbox: [11.4, 44.2, 10.2, 43.6]});
    expect(res.status).toBe(400);
  });

  it('applica una quota giornaliera', async () => {
    const results = [];
    for (let i = 0; i < 12; i++) {
      results.push(
        await request(app)
          .post('/jobs/bbox')
          .set('Authorization', `Bearer ${TOKEN}`)
          .send({bbox: [10.2 + i * 0.01, 43.6, 10.3 + i * 0.01, 43.7]}),
      );
    }
    expect(results.some(r => r.status === 429)).toBe(true);
  });
});

describe('GET /jobs/:id', () => {
  it('riporta lo stato di un job', async () => {
    const created = await request(app)
      .post('/jobs/bbox')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({bbox: [10.2, 43.6, 10.3, 43.7]});
    const res = await request(app).get(`/jobs/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(['queued', 'running', 'done', 'failed']).toContain(res.body.status);
  });

  it('404 per un job inesistente', async () => {
    const res = await request(app).get('/jobs/non-esiste');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `npm test -- test/ondemand`
Expected: FAIL

- [ ] **Step 3: Implementare `src/ondemand/jobs.ts`**

```typescript
import {randomUUID} from 'node:crypto';
import {log} from '../obs/log.js';

export type Bbox = [number, number, number, number];

export interface Job {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  bbox: Bbox;
  version?: string;
  error?: string;
  createdAt: string;
}

const EARTH_R = 6371;

/** Area approssimata del bbox in km quadrati (sufficiente per un limite di guardia). */
export function areaKm2(bbox: Bbox): number {
  const [w, s, e, n] = bbox;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLon = rad(e - w);
  return Math.abs(EARTH_R * EARTH_R * dLon * (Math.sin(rad(n)) - Math.sin(rad(s))));
}

export function validateBbox(raw: unknown): Bbox {
  if (!Array.isArray(raw) || raw.length !== 4 || raw.some(v => typeof v !== 'number' || !Number.isFinite(v))) {
    throw new Error('bbox deve essere [west, south, east, north] con quattro numeri');
  }
  const [w, s, e, n] = raw as Bbox;
  if (w >= e || s >= n) throw new Error('bbox con coordinate invertite');
  if (w < -180 || e > 180 || s < -85 || n > 85) throw new Error('bbox fuori dai limiti');
  return [w, s, e, n];
}

const jobs = new Map<string, Job>();
const dailyCount = new Map<string, number>();

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function quotaExceeded(max: number): boolean {
  return (dailyCount.get(today()) ?? 0) >= max;
}

export function createJob(bbox: Bbox): Job {
  const job: Job = {id: randomUUID(), status: 'queued', bbox, createdAt: new Date().toISOString()};
  jobs.set(job.id, job);
  dailyCount.set(today(), (dailyCount.get(today()) ?? 0) + 1);
  log.info('ondemand job created', {id: job.id, bbox, areaKm2: Math.round(areaKm2(bbox))});
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function updateJob(id: string, patch: Partial<Job>): void {
  const job = jobs.get(id);
  if (!job) return;
  Object.assign(job, patch);
  log.info('ondemand job updated', {id, status: job.status, error: job.error});
}
```

- [ ] **Step 4: Implementare `src/ondemand/routes.ts`**

```typescript
import express from 'express';
import {spawn} from 'node:child_process';
import {Config} from '../config.js';
import {areaKm2, createJob, getJob, quotaExceeded, updateJob, validateBbox} from './jobs.js';
import {log} from '../obs/log.js';

export function onDemandRoutes(cfg: Config): express.Router {
  const router = express.Router();
  router.use(express.json({limit: '4kb'}));

  router.post('/jobs/bbox', (req, res) => {
    const auth = req.get('Authorization');
    if (!cfg.onDemandToken || auth !== `Bearer ${cfg.onDemandToken}`) {
      res.status(401).json({error: 'non autorizzato'});
      return;
    }

    let bbox;
    try {
      bbox = validateBbox((req.body as {bbox?: unknown}).bbox);
    } catch (err) {
      res.status(400).json({error: String((err as Error).message)});
      return;
    }

    const area = areaKm2(bbox);
    if (area > cfg.onDemandMaxAreaKm2) {
      res.status(413).json({
        error: `area richiesta ${Math.round(area)} km2 oltre il limite di ${cfg.onDemandMaxAreaKm2} km2`,
      });
      return;
    }

    if (quotaExceeded(cfg.onDemandMaxPerDay)) {
      res.set('Retry-After', '3600');
      res.status(429).json({error: 'quota giornaliera esaurita'});
      return;
    }

    const job = createJob(bbox);
    res.status(202).json(job);

    // Esecuzione fuori dal ciclo di richiesta
    updateJob(job.id, {status: 'running'});
    const child = spawn('bash', ['pipeline/build-bbox.sh', bbox.join(','), cfg.archiveDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
    child.on('close', code => {
      if (code === 0) updateJob(job.id, {status: 'done'});
      else {
        updateJob(job.id, {status: 'failed', error: stderr.slice(-500)});
        log.error('ondemand job failed', {id: job.id, code});
      }
    });
  });

  router.get('/jobs/:id', (req, res) => {
    const job = getJob(req.params.id);
    if (!job) {
      res.status(404).json({error: 'job inesistente'});
      return;
    }
    res.json(job);
  });

  return router;
}
```

Aggiungere a `loadConfig`: `onDemandToken: env.ONDEMAND_TOKEN ?? ''`, `onDemandMaxAreaKm2: Number(env.ONDEMAND_MAX_AREA_KM2 ?? 20000)`, `onDemandMaxPerDay: Number(env.ONDEMAND_MAX_PER_DAY ?? 10)`. Documentarli in `.env.example`.

- [ ] **Step 5: Implementare `pipeline/build-bbox.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
# Uso: build-bbox.sh <west,south,east,north> <archives-root>
BBOX="${1:?bbox richiesto}"
ROOT="${2:?archives-root}"
MAXZOOM=14
VERSION="$(date -u +%Y%m%d-%H%M)"
WORK="${ROOT}/.tmp-${VERSION}"
mkdir -p "$WORK"

SRC="$(find "${MIRROR_DIR:-./data/mirror}" -name '*.osm.pbf' | sort | tail -1)"
test -n "$SRC" || { echo "!! nessun estratto nel mirror" >&2; exit 1; }

java -Xmx8g -jar "$PLANETILER_JAR" \
  --osm-path="$SRC" \
  --bounds="$BBOX" \
  --maxzoom="$MAXZOOM" \
  --output="${WORK}/osm.pmtiles" \
  --force

jq -n --arg v "$VERSION" --arg bbox "$BBOX" --arg now "$(date -u +%FT%TZ)" --argjson mz "$MAXZOOM" \
  '{archive:"osm", version:$v, scope:"bbox", bbox:$bbox,
    generator:{name:"planetiler", version:env.PLANETILER_VERSION},
    sources:[], maxzoom:$mz, createdAt:$now,
    attribution:"© OpenStreetMap contributors (ODbL)"}' > "${WORK}/provenance.json"

mv "$WORK" "${ROOT}/${VERSION}"
echo "== pubblicata ${VERSION} (bbox ${BBOX})"
```

```bash
chmod +x pipeline/build-bbox.sh
```

- [ ] **Step 6: Montare, testare**

In `createApp()`: `app.use(onDemandRoutes(cfg));`

Run: `ONDEMAND_TOKEN=test-token npm test -- test/ondemand`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/ondemand pipeline/build-bbox.sh src/config.ts src/server.ts .env.example test/ondemand
git commit -m "feat(server-tiles-osm): rigenerazione on-demand su bbox, autenticata e con quota"
```

---

## Task 16: Osservabilita', metriche e purge

Chiude i requisiti che rendono il sistema diagnosticabile invece di silenzioso.

**Files:**
- Create: `src/obs/metrics.ts`, `pipeline/purge.sh`
- Modify: `src/server.ts`, `src/tiles/routes.ts`, `src/raster/routes.ts`
- Test: `test/obs/metrics.test.ts`

**Interfaces:**
- Consumes: niente
- Produces:
  - `metrics.observe(name: string, ms: number, labels?: Record<string, string>): void`
  - `metrics.inc(name: string, labels?: Record<string, string>): void`
  - `metrics.render(): string` — formato di esposizione Prometheus
  - `metricsRoutes(): express.Router` che monta `GET /metrics`

- [ ] **Step 1: Scrivere i test che falliscono**

`test/obs/metrics.test.ts`:

```typescript
import {describe, expect, it, beforeEach} from 'vitest';
import request from 'supertest';
import {createApp} from '../../src/server.js';
import {metrics} from '../../src/obs/metrics.js';

describe('metriche', () => {
  beforeEach(() => metrics.reset());

  it('conta gli eventi per etichetta', () => {
    metrics.inc('tiles_served_total', {archive: 'osm', cache: 'miss'});
    metrics.inc('tiles_served_total', {archive: 'osm', cache: 'miss'});
    expect(metrics.render()).toContain('tiles_served_total{archive="osm",cache="miss"} 2');
  });

  it('registra istogrammi di latenza', () => {
    metrics.observe('filter_duration_ms', 0.4);
    metrics.observe('filter_duration_ms', 1.2);
    const out = metrics.render();
    expect(out).toContain('filter_duration_ms_count 2');
    expect(out).toContain('filter_duration_ms_sum');
  });

  it('conta i fallback di set separatamente: non devono restare invisibili', () => {
    metrics.inc('set_fallback_total');
    expect(metrics.render()).toContain('set_fallback_total 1');
  });

  it('espone /metrics in formato testuale', async () => {
    const res = await request(createApp()).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
  });
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `npm test -- test/obs`
Expected: FAIL

- [ ] **Step 3: Implementare `src/obs/metrics.ts`**

```typescript
type Labels = Record<string, string>;

function key(name: string, labels?: Labels): string {
  if (!labels || Object.keys(labels).length === 0) return name;
  const parts = Object.keys(labels)
    .sort()
    .map(k => `${k}="${labels[k]}"`)
    .join(',');
  return `${name}{${parts}}`;
}

const counters = new Map<string, number>();
const histograms = new Map<string, {count: number; sum: number; max: number}>();

export const metrics = {
  inc(name: string, labels?: Labels): void {
    const k = key(name, labels);
    counters.set(k, (counters.get(k) ?? 0) + 1);
  },

  observe(name: string, ms: number, labels?: Labels): void {
    const k = key(name, labels);
    const h = histograms.get(k) ?? {count: 0, sum: 0, max: 0};
    h.count++;
    h.sum += ms;
    h.max = Math.max(h.max, ms);
    histograms.set(k, h);
  },

  reset(): void {
    counters.clear();
    histograms.clear();
  },

  render(): string {
    const lines: string[] = [];
    for (const [k, v] of counters) lines.push(`${k} ${v}`);
    for (const [k, h] of histograms) {
      const base = k.includes('{') ? k.replace('{', '_count{') : `${k}_count`;
      lines.push(`${base} ${h.count}`);
      lines.push(`${k.includes('{') ? k.replace('{', '_sum{') : `${k}_sum`} ${h.sum.toFixed(3)}`);
      lines.push(`${k.includes('{') ? k.replace('{', '_max{') : `${k}_max`} ${h.max.toFixed(3)}`);
    }
    return lines.join('\n') + '\n';
  },
};

export function metricsRoutes(): import('express').Router {
  // import dinamico per non creare dipendenze circolari nei test
  const express = require('express') as typeof import('express');
  const router = express.Router();
  router.get('/metrics', (_req, res) => {
    res.set('Content-Type', 'text/plain; version=0.0.4');
    res.send(metrics.render());
  });
  return router;
}
```

Nota: se `require` non e' disponibile in ESM, importare `express` normalmente in testa al file — la dipendenza circolare non si presenta perche' `metrics.ts` non importa nulla del progetto.

- [ ] **Step 4: Strumentare le rotte**

In `src/tiles/routes.ts`, misurare il filtro e contare i serviti e i fallback:

```typescript
    const t0 = performance.now();
    const filtered = filterLayers(plain, resolved.layers);
    metrics.observe('filter_duration_ms', performance.now() - t0, {archive});
    metrics.inc('tiles_served_total', {archive, fallback: String(resolved.fallback)});
    if (resolved.fallback) metrics.inc('set_fallback_total');
```

In `src/raster/routes.ts`:

```typescript
    metrics.inc('raster_served_total', {cache: cached ? 'hit' : 'miss'});
    // e dopo il rendering:
    metrics.observe('raster_render_ms', performance.now() - t0);
```

Ridurre il volume dei log per tile: sostituire `log.info('tile served', ...)` con un campionamento, mantenendo comunque la tracciabilita' per set e versione richiesta dall'overview:

```typescript
    // Tracciabilita': tutte le richieste con fallback vengono loggate sempre
    // (sono anomalie da vedere); il traffico normale e' campionato all'1%.
    if (resolved.fallback || Math.random() < 0.01) {
      log.info('tile served', {archive, version, set: resolved.setId, z, x, y, fallback: resolved.fallback});
    }
```

- [ ] **Step 5: Implementare la procedura di purge**

`pipeline/purge.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
# Uso: purge.sh <version> [set]
# Rimuove dalla cache raster e dalla CDN le tile di una versione (opzionalmente di un solo set).
# Serve nel caso peggiore: un archivio corrotto promosso, o un filtro che ha
# lasciato passare un livello non abilitato.
VERSION="${1:?versione richiesta}"
SET="${2:-}"
CACHE="${RASTER_CACHE_DIR:-./data/raster-cache}"

echo "== purge cache raster: versione ${VERSION} set ${SET:-tutti}"
PATTERN="${VERSION}_${SET:+${SET}_}"
find "$CACHE" -name "${PATTERN}*.png" -print -delete | wc -l

if [ -n "${CDN_PURGE_URL:-}" ]; then
  echo "== purge CDN"
  curl -sS -X POST "$CDN_PURGE_URL" \
    -H "Authorization: Bearer ${CDN_PURGE_TOKEN:?token CDN richiesto}" \
    -H 'Content-Type: application/json' \
    -d "{\"prefix\":\"/t/${VERSION}/${SET}\"}"
else
  echo "!! CDN_PURGE_URL non configurata: purge CDN NON eseguito"
  echo "!! le tile restano servite dalla cache di bordo fino alla loro scadenza"
  exit 2
fi
```

```bash
chmod +x pipeline/purge.sh
```

Documentare in `docs/features/server-tiles-osm/notes.md` che il purge va **provato almeno una volta** prima di considerare il sistema pronto: una procedura di emergenza non testata non esiste.

- [ ] **Step 6: Definire gli alert**

Aggiungere a `docs/features/server-tiles-osm/notes.md` sotto "Decisioni" le condizioni da monitorare, che dipendono dallo stack di monitoraggio Webmapp e vanno configurate lì:

- `weekly-build` con `status: failed` → alert immediato
- nessuna nuova versione da piu' di 8 giorni → alert (il build e' fermo in silenzio)
- `set_fallback_total` in crescita → un client sta chiedendo set inesistenti
- `raster_render_ms` p95 oltre i 3 s, o `raster_served_total{cache="miss"}` dominante → cache fredda prolungata
- `/health` non 200 → servizio giu'

- [ ] **Step 7: Eseguire i test**

Run: `npm test`
Expected: PASS — tutta la suite

- [ ] **Step 8: Commit**

```bash
git add src/obs pipeline/purge.sh src/tiles/routes.ts src/raster/routes.ts src/server.ts test/obs docs/features/server-tiles-osm/notes.md
git commit -m "feat(server-tiles-osm): metriche, tracciabilita campionata e procedura di purge"
```

---

## Task 17: Documentazione operativa e chiusura del ciclo

**Files:**
- Create: `README.md`
- Modify: `docs/features/server-tiles-osm/notes.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Scrivere il README**

Deve contenere, in questo ordine: cosa fa il servizio; come si avvia in locale (`docker compose up`, dove mettere gli archivi); la tabella degli endpoint (`/health`, `/version`, `/manifest`, `/sets/:set`, `/style.json`, `/t/...pbf`, `/t/.../raster/...png`, `/p/...` con nota che risponde 501, `/preview`, `/metrics`, `/jobs/bbox`); come si esegue un build (settimanale e on-demand); la forma delle URL con la spiegazione del perche' versione e set sono nel path; le variabili d'ambiente; le attribuzioni obbligatorie.

- [ ] **Step 2: Compilare `notes.md`**

Registrare: il costo misurato del filtro (Task 6 step 6), la dimensione e la durata del build Italia (Task 14 step 8), l'esito dello spike sul rendering nativo (Task 13 step 1), la decisione sull'unione di `paths` in `roads` (Task 12 step 3), le differenze visive accettate (Task 12 step 6), gli alert da configurare (Task 16 step 6), e se il purge e' stato provato.

- [ ] **Step 3: Aggiornare `CLAUDE.md`**

Creare in `wm-tiles/CLAUDE.md` le sezioni `## Feature disponibili` e `## Decisioni architetturali`, con la riga della feature e le decisioni non ovvie: i tre stadi capacita'/abilitazione/visibilita', il filtro come unico punto di controllo di accesso, versione e set nel path per la cacheabilita', il PNG come proiezione dello stesso stile, z14 con overzoom.

- [ ] **Step 4: Verifica finale dell'intera suite**

Run:
```bash
npm test
docker compose up -d --build && sleep 5
curl -sf localhost:8080/health && curl -sf localhost:8080/version | jq .current
docker compose down
```
Expected: suite verde, health e version rispondono.

- [ ] **Step 5: Approvazione del confronto visivo**

Mostrare al developer la preview sulle quattro zone e `style-comparison.md`. Questo e' il criterio di chiusura del ciclo previsto dall'overview: senza approvazione esplicita il ciclo non e' concluso.

- [ ] **Step 6: Commit e apertura della PR**

```bash
git add README.md CLAUDE.md docs/features/server-tiles-osm/notes.md
git commit -m "docs(server-tiles-osm): documentazione operativa e chiusura del primo ciclo"
```

La PR va aperta verso `develop` (branch di integrazione Webmapp). Il repo `wm-tiles` e' nuovo: se `develop` non esiste ancora, crearlo da `main` prima di aprire la PR.

---

## Self-review

**Copertura dei requisiti dell'overview.**

| Sezione dell'overview | Task |
|---|---|
| Pipeline di generazione | 2 (estratto ridotto), 14 (Italia, mirroring, provenienza, ritenzione, settimanale), 15 (on-demand bbox) |
| Rilievo (DEM) | 11 |
| Stile | 9 (base, servito), 12 (convergenza, composizione rilievo), 10 (glifi e sprite) |
| Governance: capacita'/abilitazione/visibilita' | 4 (manifest, gruppi, classi), 5 (set), 6 (filtro), 12 (correzione confini gruppi) |
| Filtro dei dati e cache | 6 (filtro lossless, misurato), 7 (versione e set nel path), 13 (cache raster con versione in chiave), 3 (annuncio versione), 14 (ritenzione) |
| Predisposizione livelli protetti | 5 (set non auto-descrittivo), 7 (namespace `/p/` con 501), 4 (classe per gruppo), 6 (unico punto di filtro). **Nota:** il requisito "archivio non pubblicamente accessibile" e' garantito in locale dal filesystem; la configurazione del bucket in produzione e' operativa e va verificata al deploy, non e' codice di questo piano. |
| Contenuto informativo dei livelli | 4 (attributi dichiarati nel manifest) |
| Output raster | 13 |
| Licenze e attribuzione | 7, 9, 13 (header e style), 2, 11 (provenienza), 17 (README) |
| Serving | 3, 7, 13, 16 |
| Pagina di preview | 8, con il pannello raster completato in 13 |
| Migrazione | 12 (confronto approvato), 17 (chiusura). Il vecchio tile server non viene toccato in nessun task. |

**Nessun placeholder.** Ogni step contiene il comando o il codice da eseguire. Le due eccezioni consapevoli, entrambe non risolvibili in anticipo: le coordinate delle tile nelle fixture e nei test DEM dipendono dall'estratto e dal riquadro effettivamente scaricati, e ogni step in cui compaiono indica come ricavarle (`pmtiles show`); il ciclo di convergenza dello stile (Task 12 step 6) e' iterativo per natura e ha un criterio di uscita dichiarato invece di un elenco chiuso di modifiche.

**Coerenza dei tipi e dei nomi.** `getTile(archiveDir, version, archive, z, x, y)` e' usata con la stessa firma in Task 3, 6, 7, 11. `resolveSet(manifest, setId, registry)` restituisce sempre `ResolvedSet` con `setId`/`groups`/`layers`/`fallback`, consumato in Task 7, 9, 13. `filterLayers(tile, allowed)` e `layerNames(tile)` hanno la stessa firma in Task 6, 7, 11, 12. `cacheKey(version, setId, z, x, y)` e' coerente tra Task 13 e `purge.sh` in Task 16 (`<version>_<set>_<z>_<x>_<y>.png`). `isValidVersion` introdotta in Task 11 sostituisce il controllo diretto su `listVersions` in Task 7 e viene usata in Task 13 e 15.

**Un difetto noto, dichiarato.** Il manifest v1 nasce con `paths` e `roads` che condividono il layer tecnico `transportation`, quindi non separabili dal filtro. Task 12 step 3 lo risolve unendo i due gruppi, e Task 12 step 4 aggiunge il test che impedisce il ripetersi del problema. La separazione reale dei sentieri richiede uno schema planetiler custom ed e' fuori dal ciclo.
