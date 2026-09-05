/**
 * Estrae da CartoCSS la tabella "layer x zoom -> proprieta'", per copiare la
 * struttura del riferimento invece di dedurla.
 *
 * TGen e' organizzato per fascia di zoom: `project.mml` da' l'ordine di
 * disegno e le soglie di ciascuna sorgente, i `.mss` danno i valori sotto
 * condizioni `[zoom >= N]`. Sono dati, non interpretazioni: trascriverli a
 * mano e' lento e ha prodotto errori (il grigio urbano attribuito a Corine
 * quando il .mss dice @fondogiallo).
 *
 * Cosa fa:
 *  - espande le variabili `@nome` (anche a catena) e le funzioni di colore
 *    lighten/darken/saturate/desaturate/fadeout, che CartoCSS valuta a
 *    compilazione;
 *  - appiattisce il nesting, accumulando le condizioni del percorso;
 *  - per ogni zoom valuta le condizioni sullo zoom e scarta i rami esclusi,
 *    conservando come varianti le condizioni sugli attributi;
 *  - applica la cascata nell'ordine del file (l'ultima regola vince).
 *
 * Quello che NON fa, e che resta da mappare a mano una volta sola: i nomi.
 * Mapnik legge da PostGIS campi propri (`feature = 'highway_motorway'`,
 * `code_12`), noi leggiamo MVT con schema OpenMapTiles (`class = 'motorway'`).
 *
 * Uso: node pipeline/parse-cartocss.mjs [dir-stile] [out.json]
 */
import {readFileSync, readdirSync, writeFileSync} from 'node:fs';

const DIR = process.argv[2] ?? 'data/tgen-style';
const OUT = process.argv[3] ?? 'data/tgen-cartocss.json';
const ZMIN = 0, ZMAX = 20;

/* ---------- colori: CartoCSS valuta le funzioni a compilazione ---------- */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const parseColor = t => {
  t = t.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(t);
  if (m) return [...m[1]].map(c => parseInt(c + c, 16)).concat(1);
  m = /^#([0-9a-f]{6})$/i.exec(t);
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = /^rgba?\(([^)]+)\)$/i.exec(t);
  if (m) {
    const p = m[1].split(',').map(s => Number(s.trim()));
    return [p[0], p[1], p[2], p[3] ?? 1];
  }
  const named = {white: [255, 255, 255, 1], black: [0, 0, 0, 1], grey: [128, 128, 128, 1],
                 gray: [128, 128, 128, 1], transparent: [0, 0, 0, 0]};
  return named[t.toLowerCase()] ?? null;
};

const fmtColor = ([r, g, b, a]) => {
  const h = v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
  return a >= 1 ? `#${h(r)}${h(g)}${h(b)}` : `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
};

const toHsl = ([r, g, b, a]) => {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l, a];
};

const fromHsl = ([h, s, l, a]) => {
  const f = t => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  if (s === 0) return [l * 255, l * 255, l * 255, a];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255, a];
};

/** lighten/darken/saturate/desaturate/fadeout, come le intende CartoCSS. */
const colorFn = (name, arg, amount) => {
  const c = parseColor(arg);
  if (!c) return null;
  const k = amount / 100;
  if (name === 'fadeout') return fmtColor([c[0], c[1], c[2], clamp(c[3] - k, 0, 1)]);
  if (name === 'fadein') return fmtColor([c[0], c[1], c[2], clamp(c[3] + k, 0, 1)]);
  const [h, s, l, a] = toHsl(c);
  const map = {lighten: [h, s, clamp(l + k, 0, 1), a], darken: [h, s, clamp(l - k, 0, 1), a],
               saturate: [h, clamp(s + k, 0, 1), l, a], desaturate: [h, clamp(s - k, 0, 1), l, a]};
  return map[name] ? fmtColor(fromHsl(map[name])) : null;
};

/* ---------- variabili ---------- */

/**
 * SOLO gli stylesheet elencati da project.mml, e nel suo ordine.
 *
 * Il progetto contiene varianti alternative dello stesso file: sia
 * `road-colors-generated.mss` (@motorway-low-zoom #ffe37e) sia
 * `road-colors-no-hiking.mss` (rgb(141,136,124)), e solo il primo e' incluso.
 * Leggere la cartella e lasciar vincere l'ultimo in ordine alfabetico prende
 * i valori della variante sbagliata — cosa che mi ha portato fuori strada
 * anche leggendo i file a mano.
 */
const mmlText = readFileSync(`${DIR}/project.mml`, 'utf8');
const listed = [...mmlText.matchAll(/^\s*-\s*([\w.-]+\.mss)\s*$/gm)].map(m => m[1]);
const present = new Set(readdirSync(DIR));
const files = listed.filter(f => present.has(f));
if (!files.length) throw new Error('project.mml non elenca stylesheet leggibili');
const ignorati = [...present].filter(f => f.endsWith('.mss') && !files.includes(f));
const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const vars = new Map();
for (const f of files) {
  const t = strip(readFileSync(`${DIR}/${f}`, 'utf8'));
  for (const m of t.matchAll(/^\s*(@[\w-]+)\s*:\s*([^;{}]+);/gm)) vars.set(m[1], m[2].trim());
}

/** Risolve @var, anche a catena, e valuta le funzioni di colore. */
const resolve = (value, depth = 0) => {
  if (depth > 12 || typeof value !== 'string') return value;
  let v = value.trim();
  const fn = /^(lighten|darken|saturate|desaturate|fadeout|fadein)\(\s*(.+?)\s*,\s*([\d.]+)%?\s*\)$/i.exec(v);
  if (fn) {
    const inner = resolve(fn[2], depth + 1);
    const out = colorFn(fn[1].toLowerCase(), inner, Number(fn[3]));
    if (out) return out;
  }
  if (/^@[\w-]+$/.test(v) && vars.has(v)) return resolve(vars.get(v), depth + 1);
  return v.replace(/@[\w-]+/g, m => (vars.has(m) ? resolve(vars.get(m), depth + 1) : m));
};

/* ---------- parser: nesting + selettori ---------- */

/** Divide un selettore in condizioni `[...]`, id `#x`, classi `.x`, attachment `::x`. */
const parseSelector = sel => {
  const conds = [...sel.matchAll(/\[([^\]]+)\]/g)].map(m => m[1].trim());
  const ids = [...sel.matchAll(/#([\w-]+)/g)].map(m => m[1]);
  const attach = [...sel.matchAll(/::([\w-]+)/g)].map(m => m[1]);
  return {conds, ids, attach};
};

/** Vero se la condizione sullo zoom e' soddisfatta a quel livello; null se non riguarda lo zoom. */
const zoomTest = (cond, z) => {
  const m = /^zoom\s*(<=|>=|<|>|=|!=)\s*(\d+)$/.exec(cond.replace(/\s+/g, ' ').trim());
  if (!m) return null;
  const n = Number(m[2]);
  switch (m[1]) {
    case '>=': return z >= n; case '>': return z > n;
    case '<=': return z <= n; case '<': return z < n;
    case '=': return z === n; default: return z !== n;
  }
};

/**
 * Percorre un blocco CartoCSS ed emette le regole appiattite.
 * Ogni regola: {ids, attach, conds (non-zoom), zoomConds, props, ordine}
 */
function parseBlock(text, out, inherited = {ids: [], attach: [], conds: [], zoomConds: []}, counter = {n: 0}) {
  let i = 0;
  const len = text.length;
  let buf = '';
  while (i < len) {
    const ch = text[i];
    if (ch === '{') {
      // il selettore e' cio' che precede, eventualmente piu' selettori separati da virgola
      const sel = buf.trim(); buf = '';
      let depth = 1, j = i + 1;
      while (j < len && depth > 0) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      const body = text.slice(i + 1, j - 1);
      for (const one of sel.split(',')) {
        const s = one.trim();
        if (!s) continue;
        const {conds, ids, attach} = parseSelector(s);
        const zoomConds = conds.filter(c => /^zoom\s*[<>=!]/.test(c.replace(/\s+/g, ' ')));
        const other = conds.filter(c => !zoomConds.includes(c));
        parseBlock(body, out, {
          ids: [...inherited.ids, ...ids],
          attach: [...inherited.attach, ...attach],
          conds: [...inherited.conds, ...other],
          zoomConds: [...inherited.zoomConds, ...zoomConds],
        }, counter);
      }
      i = j;
      continue;
    }
    if (ch === ';') {
      const decl = buf.trim(); buf = '';
      const m = /^([\w-]+(?:\/[\w-]+)?)\s*:\s*([\s\S]+)$/.exec(decl);
      if (m && !decl.startsWith('@')) {
        out.push({...inherited, prop: m[1], value: resolve(m[2]), ordine: counter.n++});
      }
      i++;
      continue;
    }
    if (ch === '}') { buf = ''; i++; continue; }
    buf += ch;
    i++;
  }
}

const rules = [];
for (const f of files) {
  parseBlock(strip(readFileSync(`${DIR}/${f}`, 'utf8')), rules);
}

/* ---------- ordine e soglie dal project.mml ---------- */

const mml = mmlText;
const mmlLayers = [];
{
  const re = /^\s*-\s*id:\s*(\S+)/gm;
  let m;
  const starts = [];
  while ((m = re.exec(mml))) starts.push({id: m[1], at: m.index});
  starts.forEach((s, k) => {
    const seg = mml.slice(s.at, starts[k + 1]?.at ?? mml.length);
    const mn = /minzoom:\s*(\d+)/.exec(seg);
    const mx = /maxzoom:\s*(\d+)/.exec(seg);
    mmlLayers.push({id: s.id, ordine: k,
                    minzoom: mn ? Number(mn[1]) : null,
                    maxzoom: mx ? Number(mx[1]) : null});
  });
}

/* ---------- tabella layer x zoom ---------- */

const byId = new Map();
for (const r of rules) {
  const id = r.ids[r.ids.length - 1] ?? (r.attach[0] ? `::${r.attach[0]}` : '(globale)');
  if (!byId.has(id)) byId.set(id, []);
  byId.get(id).push(r);
}

const table = {};
for (const [id, rs] of byId) {
  const perZoom = {};
  for (let z = ZMIN; z <= ZMAX; z++) {
    const applicabili = rs.filter(r => r.zoomConds.every(c => zoomTest(c, z) !== false));
    if (!applicabili.length) continue;
    // cascata: a parita' di condizioni sugli attributi vince l'ultima
    const props = {};
    for (const r of applicabili.sort((a, b) => a.ordine - b.ordine)) {
      const key = r.conds.length ? r.conds.join(' && ') : '*';
      props[key] ??= {};
      props[key][(r.attach.length ? r.attach.join('::') + '::' : '') + r.prop] = r.value;
    }
    perZoom[z] = props;
  }
  const meta = mmlLayers.find(l => l.id === id);
  table[id] = {ordine: meta?.ordine ?? null, minzoom: meta?.minzoom ?? null,
               maxzoom: meta?.maxzoom ?? null, zoom: perZoom};
}

writeFileSync(OUT, JSON.stringify({
  nota: 'Estratto da CartoCSS da pipeline/parse-cartocss.mjs. Non modificare a mano.',
  variabili: Object.fromEntries([...vars].map(([k, v]) => [k, resolve(v)])),
  ordineMml: mmlLayers,
  layer: table,
}, null, 2));

const nz = Object.values(table).filter(t => Object.keys(t.zoom).length).length;
console.log(`  ${OUT}`);
console.log(`  stylesheet da project.mml: ${files.join(', ')}`);
if (ignorati.length) console.log(`  ignorati (varianti non incluse): ${ignorati.join(', ')}`);
console.log(`  ${vars.size} variabili risolte, ${rules.length} dichiarazioni, ` +
  `${Object.keys(table).length} selettori (${nz} con regole per zoom), ` +
  `${mmlLayers.length} layer nel project.mml`);
