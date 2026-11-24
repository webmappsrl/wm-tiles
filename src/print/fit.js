/**
 * Inquadratura di una mappa a partire dalle geometrie: l'equivalente di
 * `zoomToExtent` di OpenLayers, che maplibre-native non ha. Lo zoom e il centro
 * escono dal conto Web Mercator; la scala non si sceglie, dipende dalla scheda.
 *
 * Lo zoom e' nella convenzione a 256 px (PIXEL_Z0 sono i metri per pixel a z0).
 *
 * Dagli shard arrivano anche tracce non pubblicate: gli errori nominano il
 * campo e mai il suo contenuto, per non scrivere coordinate nei log.
 */
import {PIXEL_Z0} from '../raster/ombra.js';

const R = 6378137; // raggio della sfera di Web Mercator, metri
const RAD = Math.PI / 180;
const LAT_MAX = 85.0511287798; // limite di latitudine di Web Mercator

const mercatorY = lat => R * Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2));
const latFromY = y => (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) / RAD;
const mercatorX = lon => R * lon * RAD;

function positiva(v, campo) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
    throw new Error(`${campo} deve essere un numero positivo`);
  }
}

/** Visita ogni coordinata di un GeoJSON (FeatureCollection, Feature o geometria). */
function raccogli(node, acc) {
  if (!node || typeof node !== 'object') return;
  switch (node.type) {
    case 'FeatureCollection':
      if (Array.isArray(node.features)) node.features.forEach(f => raccogli(f, acc));
      return;
    case 'Feature':
      raccogli(node.geometry, acc);
      return;
    case 'GeometryCollection':
      if (Array.isArray(node.geometries)) node.geometries.forEach(g => raccogli(g, acc));
      return;
    case 'Point': case 'MultiPoint': case 'LineString': case 'MultiLineString':
    case 'Polygon': case 'MultiPolygon':
      coordinate(node.coordinates, acc);
      return;
    default:
      throw new Error('GeoJSON con un campo type non riconosciuto');
  }
}

function coordinate(c, acc) {
  if (!Array.isArray(c)) throw new Error('coordinate non valide: attesa una lista');
  if (!c.length) throw new Error('coordinate non valide: lista vuota');
  if (c.length && !Array.isArray(c[0])) {
    const [lon, lat] = c;
    if (typeof lon !== 'number' || typeof lat !== 'number' || !Number.isFinite(lon) || !Number.isFinite(lat)) {
      throw new Error('coordinate non numeriche');
    }
    if (Math.abs(lon) > 180 || Math.abs(lat) > 90) {
      throw new Error('coordinate fuori dal mondo (longitudine o latitudine oltre i limiti)');
    }
    acc.push([lon, lat]);
    return;
  }
  c.forEach(x => coordinate(x, acc));
}

/**
 * @returns {{center: [number, number], zoom: number}} zoom frazionario, mai oltre
 *   `maxZoom`; un bbox degenere (un punto) usa `maxZoom`.
 */
export function fitBounds(geojson, {width, height, padding, maxZoom} = {}) {
  positiva(width, 'width');
  positiva(height, 'height');
  if (typeof padding !== 'number' || !Number.isFinite(padding) || padding < 0) {
    throw new Error('padding deve essere un numero non negativo');
  }
  if (typeof maxZoom !== 'number' || !Number.isFinite(maxZoom)) {
    throw new Error('maxZoom deve essere un numero');
  }
  const usableW = width - 2 * padding;
  const usableH = height - 2 * padding;
  if (usableW <= 0 || usableH <= 0) {
    throw new Error('padding troppo grande per la pagina: non resta area utile');
  }

  const punti = [];
  raccogli(geojson, punti);
  if (!punti.length) throw new Error('nessuna geometria da inquadrare');

  // Antimeridiano: un'estensione in longitudine oltre 180 gradi, per un sentiero,
  // e' quasi certamente un dato corrotto che attraversa i 180. Si rifiuta invece di
  // inquadrare mezzo mondo. Se un giorno servisse: traslare di +360 le longitudini
  // negative prima del conto e riportare il centro in [-180, 180].
  const lons = punti.map(p => p[0]);
  if (Math.max(...lons) - Math.min(...lons) > 180) {
    throw new Error('coordinate che attraversano l\'antimeridiano: longitudine non inquadrabile');
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [lon, lat] of punti) {
    const x = mercatorX(lon);
    const y = mercatorY(Math.max(-LAT_MAX, Math.min(LAT_MAX, lat)));
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  // metri per pixel necessari su ciascun asse; un'estensione nulla non vincola
  const res = Math.max((maxX - minX) / usableW, (maxY - minY) / usableH);
  const zoom = res > 0 ? Math.min(maxZoom, Math.log2(PIXEL_Z0 / res)) : maxZoom;

  return {
    center: [(minX + maxX) / 2 / (R * RAD), latFromY((minY + maxY) / 2)],
    zoom: Math.max(0, zoom),
  };
}
