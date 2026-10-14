/**
 * Lo stile servito alle app, adattato a maplibre-native per rendere i PNG.
 *
 * `style.json` e' scritto per OpenLayers, che lo disegnera' nelle app: le sue
 * soglie e grandezze sono quelle che OpenLayers interpreta come TGen. Per i PNG
 * lo stesso stile passa da maplibre-native, che lo legge diversamente in tre
 * punti; qui si compensano, in automatico, cosi' resta UN solo stile da tarare.
 *
 * 1. Tile vettoriali e zoom. maplibre-native considera ogni tile vettoriale da
 *    512 px (lo Style Spec ammette `tileSize` solo per i raster) e a zoom N
 *    carica le tile N. Una vista che OpenLayers disegna a zN con le tile zN,
 *    disegnata a zoom N-1 per avere la stessa scala, userebbe le tile N-1:
 *    parchi, scudi e citta' che entrano nel dato a zN comparirebbero un livello
 *    dopo. Si disegna quindi a zoom N con pixel ratio 0,5 — stessa scala in
 *    pixel, tile zN — e di conseguenza:
 *    - le grandezze in pixel raddoppiano (`IN_PIXEL`), perche' un pixel CSS
 *      vale mezzo pixel dell'immagine;
 *    - le soglie di zoom salgono di uno, perche' OpenLayers valuta lo stile a
 *      N-1 (lo sfasamento che `build-style.mjs` compensa in `scalaZoom`) e qui
 *      lo si valuta a N.
 * 2. Il testo lungo le linee. OpenLayers lo ripete ogni `symbol-spacing x 2`
 *    (`text.setRepeat(symbolSpacing * 2)`), maplibre-native ogni
 *    `symbol-spacing`: per avere lo stesso passo il valore raddoppia.
 * 3. Il bordo sfumato dei poligoni. maplibre-native disegna attorno a ogni
 *    poligono un contorno di un pixel del suo colore (`fill-antialias`): sui
 *    poligoni piu' piccoli di un pixel dell'uso suolo restano visibili solo
 *    quei contorni, come anelli bianchi, che OpenLayers e Mapnik non
 *    disegnano. Sulle superfici si spegne.
 */

/** Proprieta' espresse in pixel CSS: con pixel ratio 0,5 raddoppiano. */
export const IN_PIXEL = new Set(['circle-radius', 'circle-stroke-width', 'circle-translate', 'icon-size',
  'icon-padding', 'line-offset', 'line-width', 'line-gap-width', 'line-blur', 'symbol-spacing',
  'text-halo-width', 'text-halo-blur', 'text-padding', 'text-size', 'fill-translate']);

/** Layer di superficie: senza il contorno sfumato di maplibre-native. */
export const SUPERFICI = new Set(['landcover-fill', 'landcover-osm', 'clc-fill']);

export const PIXEL_RATIO = 0.5;

/** `step` o `interpolate` sullo zoom (le sole espressioni di zoom ammesse in cima). */
export const suZoom = v => Array.isArray(v)
  && ((v[0] === 'step' && JSON.stringify(v[1]) === '["zoom"]')
    || (v[0] === 'interpolate' && JSON.stringify(v[2]) === '["zoom"]'));

/** Le soglie di zoom di un'espressione salgono di `d`. */
export function sposta(v, d = 1) {
  if (!suZoom(v)) return v;
  // step: [step, input, out0, z1, out1, ...]; interpolate: [interpolate, tipo, input, z1, out1, ...]
  return v.map((x, i) => (i >= 3 && i % 2 === 1 ? x + d : x));
}

/** Moltiplica per `f` il valore, o le uscite di un'espressione di zoom. */
export function per(v, f) {
  if (typeof v === 'number') return v * f;
  if (suZoom(v)) {
    const uscita = i => (v[0] === 'step' ? i === 2 || (i >= 4 && i % 2 === 0) : i >= 4 && i % 2 === 0);
    return v.map((x, i) => (uscita(i) ? per(x, f) : x));
  }
  if (Array.isArray(v) && typeof v[0] === 'number') return v.map(x => x * f); // [x, y]
  if (Array.isArray(v)) return ['*', f, v];
  throw new Error(`valore non numerico: ${JSON.stringify(v)}`);
}

/**
 * Gli URL dello stile (tile, glifi, sprite, quote) riscritti verso `base`.
 *
 * Dietro una CDN il server scrive nello stile l'indirizzo pubblico
 * (`PUBLIC_URL`): il renderer, che gira accanto al server, scaricherebbe ogni
 * tile passando da internet e dalla CDN, piu' lento e con milioni di richieste
 * a pagamento. Tutti gli URL dello stile puntano allo stesso server, quindi
 * basta cambiarne l'origine.
 */
export function localizza(stile, base) {
  const b = base.replace(/\/$/, '');
  const qui = u => (typeof u === 'string' ? u.replace(/^https?:\/\/[^/]+/, b) : u);
  const s = structuredClone(stile);
  for (const src of Object.values(s.sources ?? {})) {
    if (Array.isArray(src.tiles)) src.tiles = src.tiles.map(qui);
    if (src.url) src.url = qui(src.url);
  }
  if (s.glyphs) s.glyphs = qui(s.glyphs);
  if (s.sprite) s.sprite = qui(s.sprite);
  return s;
}

/** Copia dello stile pronta per maplibre-native a pixel ratio `PIXEL_RATIO`. */
export function adattaStile(stileOl) {
  const stile = structuredClone(stileOl);
  const scala = 1 / PIXEL_RATIO;
  for (const l of stile.layers) {
    if (SUPERFICI.has(l.id)) (l.paint ??= {})['fill-antialias'] = false;
    if (l.minzoom !== undefined) l.minzoom += 1;
    if (l.maxzoom !== undefined) l.maxzoom += 1;
    // anche i valori di default sono in pixel: vanno scritti per poterli raddoppiare
    if (l.type === 'line') (l.paint ??= {})['line-width'] ??= 1;
    if (l.type === 'circle') (l.paint ??= {})['circle-radius'] ??= 5;
    if (l.type === 'symbol') {
      l.layout ??= {};
      if (l.layout['icon-image'] !== undefined) {
        l.layout['icon-size'] ??= 1;
        l.layout['icon-padding'] ??= 2;
      }
      if (l.layout['text-field'] !== undefined) {
        l.layout['text-size'] ??= 16;
        l.layout['text-padding'] ??= 2;
        // padding negativo (nomi delle strade): serve a OpenLayers, che misura
        // un testo ruotato col suo riquadro orizzontale; maplibre-native ruota il
        // riquadro e non ne ha bisogno
        if (Array.isArray(l.layout['text-padding']) && l.layout['text-padding'][0] === '-') l.layout['text-padding'] = 0;
      }
      if (l.layout['symbol-placement'] === 'line') l.layout['symbol-spacing'] ??= 250;
      const testoSuLinea = l.layout['symbol-placement'] === 'line'
        && l.layout['text-field'] !== undefined && l.layout['icon-image'] === undefined;
      if (testoSuLinea) l.layout['symbol-spacing'] = per(l.layout['symbol-spacing'], 2);
    }
    for (const g of ['paint', 'layout']) {
      for (const [k, v] of Object.entries(l[g] ?? {})) {
        let w = sposta(v);
        if (IN_PIXEL.has(k)) w = per(w, scala);
        l[g][k] = w;
      }
    }
  }
  return stile;
}
