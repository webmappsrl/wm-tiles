/**
 * Le geometrie ricevute dalla richiesta di stampa, disegnate sopra la mappa.
 *
 * Il colore e lo spessore viaggiano dentro il GeoJSON (simplestyle-spec:
 * `stroke`, `stroke-width`), per feature: la mappa d'insieme porta N tracce e
 * un colore unico per richiesta non le distinguerebbe. Senza proprieta' vale
 * la resa predefinita qui sotto.
 *
 * R10: i dati sono SEMPRE inline, mai un indirizzo. Una source con un URL
 * farebbe del servizio un vettore di SSRF verso la rete dell'host.
 */

export const SOURCE_ID = 'print-overlay';
/** Rosso acceso: si legge su bosco, prato e roccia, anche in bianco e nero. */
export const DEFAULT_STROKE = '#e8312f';
export const DEFAULT_WIDTH = 4;
/** Alone: leggibilita' su carta, non identita' del cliente. Non e' configurabile. */
const HALO_COLOR = '#ffffff';
const HALO_EXTRA = 4;
const HALO_OPACITY = 0.85;

const colore = ['coalesce', ['get', 'stroke'], DEFAULT_STROKE];
const spessore = ['coalesce', ['get', 'stroke-width'], DEFAULT_WIDTH];
const isPoint = ['==', ['geometry-type'], 'Point'];
const notPoint = ['!=', ['geometry-type'], 'Point'];

/**
 * @param {object} style stile maplibre (non viene modificato)
 * @param {object} featureCollection GeoJSON FeatureCollection, oggetto (mai stringa/URL)
 * @returns {object} copia dello stile con la source e i layer dell'overlay in fondo
 *
 * Linee: tratto con alone. Poligoni: il contorno, con la stessa regola delle
 * linee (il layer `line` disegna gli anelli). Punti: cerchio con alone, posto
 * sotto le tracce cosi' i due layer di linea restano gli ultimi.
 *
 * ORDINE: va chiamata PRIMA di `adattaStile`, cioe' `adattaStile(addOverlay(stile, dati))`.
 * `adattaStile` raddoppia le grandezze in pixel (pixel ratio 0,5 di
 * maplibre-native), anche dentro le espressioni: se l'overlay arriva dopo,
 * la traccia esce larga la meta' della strada accanto, senza alcun errore.
 * Non e' idempotente: se lo stile ha gia' la source `print-overlay` lancia.
 */
export function addOverlay(style, featureCollection) {
  if (!featureCollection || typeof featureCollection !== 'object' || featureCollection.type !== 'FeatureCollection'
    || !Array.isArray(featureCollection.features)) {
    throw new Error('overlay: serve una FeatureCollection GeoJSON inline');
  }
  if (style.sources?.[SOURCE_ID]) {
    throw new Error(`overlay: lo stile contiene gia' la source ${SOURCE_ID} (addOverlay chiamata due volte?)`);
  }
  const out = structuredClone(style);
  out.sources = {
    ...out.sources,
    [SOURCE_ID]: {type: 'geojson', data: structuredClone(featureCollection)},
  };
  out.layers = [
    ...out.layers,
    {id: 'print-overlay-point-halo', type: 'circle', source: SOURCE_ID, filter: isPoint,
      paint: {'circle-color': HALO_COLOR, 'circle-opacity': HALO_OPACITY,
        'circle-radius': ['+', ['*', spessore, 1.5], HALO_EXTRA / 2]}},
    {id: 'print-overlay-point', type: 'circle', source: SOURCE_ID, filter: isPoint,
      paint: {'circle-color': colore, 'circle-radius': ['*', spessore, 1.5]}},
    {id: 'print-overlay-halo', type: 'line', source: SOURCE_ID, filter: notPoint,
      layout: {'line-cap': 'round', 'line-join': 'round'},
      paint: {'line-color': HALO_COLOR, 'line-opacity': HALO_OPACITY, 'line-width': ['+', spessore, HALO_EXTRA]}},
    {id: 'print-overlay-line', type: 'line', source: SOURCE_ID, filter: notPoint,
      layout: {'line-cap': 'round', 'line-join': 'round'},
      paint: {'line-color': colore, 'line-width': spessore}},
  ];
  return out;
}
