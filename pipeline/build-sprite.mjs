/**
 * Genera lo sprite (atlas PNG + indice JSON) per MapLibre dagli SVG in
 * style/sprite/svg, nelle varianti 1x e 2x.
 *
 * Le icone Maki sono monocromatiche e senza attributo `fill`: il colore viene
 * iniettato qui secondo la categoria, perche' uno sprite non-SDF non e'
 * colorabile dallo stile. Le icone che portano gia' i propri colori
 * (`hiking-shield`) vengono lasciate intatte.
 *
 * Uso: node pipeline/build-sprite.mjs [svg-dir] [out-prefix]
 */
import sharp from 'sharp';
import {readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {basename, join} from 'node:path';

const SVG_DIR = process.argv[2] ?? 'style/sprite/svg';
const OUT = process.argv[3] ?? 'style/sprite/webmapp';

/**
 * Colore per categoria, allineato alle variabili del riferimento: le icone
 * sono fra gli elementi piu' scuri della mappa e pesano sul contrasto piu' di
 * quanto la loro area suggerisca. `natural` e' @landform-color (cime, passi),
 * `shelter` e' @accommodation-icon (rifugi e bivacchi).
 */
const COLORS = {
  natural: '#5c491d',
  shelter: '#734a08',
  water: '#3d7a99',
  service: '#7a6b52',
  civic: '#5a5348',
};

const CATEGORY = {
  mountain: 'natural', peak: 'natural', waterfall: 'water', viewpoint: 'natural',
  campsite: 'natural', 'picnic-site': 'natural', 'dog-park': 'natural',
  'garden-centre': 'natural', attraction: 'natural',
  shelter: 'shelter', lodging: 'shelter', hut: 'shelter',
  'drinking-water': 'water',
  restaurant: 'service', cafe: 'service', bar: 'service', toilet: 'service',
  parking: 'service', bus: 'service', car: 'service', 'bicycle-share': 'service',
  information: 'service',
  'place-of-worship': 'civic',
};

/** Icone che definiscono i propri colori e non vanno ricolorate. */
const KEEP_COLORS = new Set(['hiking-shield', 'power-tower', 'power-tower-small', 'power-pole', 'aerodrome', 'station', 'spring', 'saddle', 'cave', 'level-crossing', 'level-crossing2', 'cross', 'bus-stop', 'ford', 'place-4', 'place-4-z7', 'place-6', 'place-6-z7', 'place-capital-6', 'place-capital-8', 'alpine-hut-cai', 'wilderness-hut-cai', 'tgen-shelter']);

const PADDING = 2;

function colorize(svg, name) {
  // le icone di TGen (svg-amenity.mjs) portano gia' il colore della loro regola
  if (KEEP_COLORS.has(name) || name.startsWith('tg-')) return svg;
  const color = COLORS[CATEGORY[name] ?? 'service'];
  // I path Maki non hanno fill: si aggiunge sul tag <svg>, che i figli ereditano
  return svg.replace(/<svg\b/, `<svg fill="${color}"`);
}

/**
 * Scudi stradali: un'icona per tipo e per numero di caratteri.
 *
 * La via elegante sarebbe una sola icona allungabile per tipo
 * (`content` + `stretchX`/`stretchY` + `icon-text-fit`), ma **ol-mapbox-style
 * ignora `icon-text-fit`**: verificato cambiando il padding da 4 a 8 senza
 * che il riquadro cambiasse di un pixel, con la sigla che sbordava. Si fa
 * quindi come il riferimento, che tiene un SVG per ogni combinazione: qui
 * bastano cinque tipi per sei lunghezze, e lo stile sceglie con
 * `length(ref)`.
 *
 * Colori presi dagli SVG del riferimento, che li porta gia' distinti per
 * tipo: sono gli stessi che si misurano nei PNG serviti.
 */
const SCUDI = {
  'shield-motorway':  {fill: '#eacec6', stroke: '#cfa092'},
  'shield-trunk':     {fill: '#eed9c9', stroke: '#cfac90'},
  'shield-primary':   {fill: '#efe4ce', stroke: '#cbb993'},
  'shield-secondary': {fill: '#eeefd7', stroke: '#c4c69c'},
  'shield-tertiary':  {fill: '#f1f1f1', stroke: '#c6c6c6'},
};
const SCUDO_H = 15;
const SCUDO_CARATTERI = [2, 3, 4, 5, 6, 7];
/** Larghezza del riquadro per una sigla di n caratteri, a text-size 10. */
const scudoW = n => Math.round(n * 6.2 + 9);

const svgScudo = ({fill, stroke}, w) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${SCUDO_H}" ` +
  `viewBox="0 0 ${w} ${SCUDO_H}">` +
  `<rect x="0.5" y="0.5" width="${w - 1}" height="${SCUDO_H - 1}" rx="2" ry="2" ` +
  `style="fill:${fill};stroke:${stroke};stroke-width:1"/></svg>`;

const files = readdirSync(SVG_DIR).filter(f => f.endsWith('.svg')).sort();
// i motivi di riempimento di TGen sono PNG (es. il tratteggio delle aree
// militari): entrano cosi' come sono, ingranditi senza sfumare per la 2x
const motivi = readdirSync(SVG_DIR).filter(f => f.endsWith('.png')).sort();
if (files.length === 0) {
  console.error(`nessun .svg in ${SVG_DIR}`);
  process.exit(1);
}

for (const ratio of [1, 2]) {
  const items = [];
  for (const [name, col] of Object.entries(SCUDI)) {
    for (const n of SCUDO_CARATTERI) {
      const buf = await sharp(Buffer.from(svgScudo(col, scudoW(n))), {density: 72 * ratio})
        .png().toBuffer();
      const meta = await sharp(buf).metadata();
      items.push({name: `${name}-${n}`, buf, width: meta.width, height: meta.height});
    }
  }
  for (const file of files) {
    const name = basename(file, '.svg');
    const svg = colorize(readFileSync(join(SVG_DIR, file), 'utf8'), name);
    // density scala il rendering dell'SVG: 72 dpi = dimensione nominale
    const buf = await sharp(Buffer.from(svg), {density: 72 * ratio}).png().toBuffer();
    const meta = await sharp(buf).metadata();
    items.push({name, buf, width: meta.width, height: meta.height});
  }
  for (const file of motivi) {
    const src = sharp(join(SVG_DIR, file));
    const {width, height} = await src.metadata();
    const buf = await src.resize(width * ratio, height * ratio, {kernel: 'nearest'}).png().toBuffer();
    items.push({name: basename(file, '.png'), buf, width: width * ratio, height: height * ratio});
  }

  // Griglia semplice: righe di altezza uniforme, larghezza dell'atlas a
  // potenza di due per compatibilita' con le texture GPU
  const cols = Math.ceil(Math.sqrt(items.length));
  const cellW = Math.max(...items.map(i => i.width)) + PADDING * 2;
  const cellH = Math.max(...items.map(i => i.height)) + PADDING * 2;
  const rows = Math.ceil(items.length / cols);
  const pow2 = n => 2 ** Math.ceil(Math.log2(n));
  const atlasW = pow2(cols * cellW);
  const atlasH = pow2(rows * cellH);

  const composites = [];
  const index = {};
  items.forEach((item, n) => {
    const col = n % cols;
    const row = Math.floor(n / cols);
    const x = col * cellW + PADDING;
    const y = row * cellH + PADDING;
    composites.push({input: item.buf, left: x, top: y});
    index[item.name] = {
      x, y, width: item.width, height: item.height,
      pixelRatio: ratio,
    };

  });

  const suffix = ratio === 1 ? '' : `@${ratio}x`;
  await sharp({
    create: {width: atlasW, height: atlasH, channels: 4, background: {r: 0, g: 0, b: 0, alpha: 0}},
  })
    .composite(composites)
    .png()
    .toFile(`${OUT}${suffix}.png`);

  writeFileSync(`${OUT}${suffix}.json`, JSON.stringify(index, null, 1));
  console.log(`${OUT}${suffix}.png  ${atlasW}x${atlasH}  ${items.length} icone`);
}
