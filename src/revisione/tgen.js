/**
 * Le tile di TGen, lette in sola lettura da api.webmapp.it e tenute in
 * data/ref-cache come fanno gli altri strumenti. Una tile che TGen non ha
 * (404) da' null: e' contenuto, non un errore. Ogni altro esito si riprova
 * due volte e poi diventa un'eccezione: confonderlo con un 404 cambiava il
 * campione da un giro all'altro.
 */
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const LEGACY = process.env.WM_LEGACY ?? 'https://api.webmapp.it/tiles';

export async function scaricaTgen(t, cache = 'data/ref-cache') {
  mkdirSync(cache, {recursive: true});
  const f = join(cache, `${t.replaceAll('/', '-')}.png`);
  if (existsSync(f)) return f;
  let errore;
  for (let prova = 0; prova < 3; prova++) {
    try {
      const r = await fetch(`${LEGACY}/${t}.png`);
      if (r.status === 404) return null;
      if (r.ok) { writeFileSync(f, Buffer.from(await r.arrayBuffer())); return f; }
      errore = new Error(`TGen ${t}: HTTP ${r.status}`);
    } catch (e) { errore = e; }
  }
  throw errore;
}
