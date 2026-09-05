/**
 * Griglia delle tile XYZ, sovrapposta a entrambi i pannelli.
 *
 * Serve al confronto puntuale: senza di essa una differenza si descrive "in
 * alto a destra del crinale", con essa si nomina la tile — `14/8721/6003` —
 * e la si va a ispezionare con `tools/find-in-tile.mjs` o `/inspect/...`.
 * Rende anche visibili i confini di tile, che sono il posto dove nascono gli
 * artefatti: cuciture nell'ombreggiatura, etichette troncate, poligoni di uso
 * suolo tagliati.
 *
 * Le due mappe condividono la `ol.View` ma hanno viewport propri, quindi ogni
 * pannello ha la sua sorgente e calcola le tile sul proprio extent.
 */

/** Convenzione XYZ: origine in alto a sinistra, come le URL dei tile server. */
const tileGrid = ol.tilegrid.createXYZ({tileSize: 256, maxZoom: 24});

const stroke = new ol.style.Stroke({color: 'rgba(214,31,105,.85)', width: 1});

/**
 * Il bordo della tile, piu' la sua sigla all'angolo superiore sinistro.
 *
 * L'ancora e' vincolata alla porzione visibile della tile: le tile a bordo di
 * viewport sono meta' del confronto, e con l'etichetta fuori schermo non
 * sarebbero identificabili.
 */
const styleFor = (feature, visibleExtent) => [
  new ol.style.Style({stroke}),
  new ol.style.Style({
    geometry: f => {
      const [minX, minY, maxX, maxY] = f.getGeometry().getExtent();
      const [vMinX, vMinY, vMaxX, vMaxY] = visibleExtent();
      return new ol.geom.Point([
        Math.min(Math.max(minX, vMinX), maxX),
        Math.max(Math.min(maxY, vMaxY), minY),
      ]);
    },
    text: new ol.style.Text({
      text: feature.get('label'),
      font: '600 11px ui-monospace, monospace',
      textAlign: 'left',
      textBaseline: 'top',
      offsetX: 4,
      offsetY: 3,
      fill: new ol.style.Fill({color: '#fff'}),
      backgroundFill: new ol.style.Fill({color: 'rgba(214,31,105,.85)'}),
      padding: [1, 3, 1, 3],
    }),
  }),
];

/**
 * @param {ol.Map[]} maps  i pannelli su cui sovrapporre la griglia
 * @param {ol.View} view   la vista condivisa
 * @param {number|null} fixedZ  livello forzato (?grid=14), altrimenti quello della vista
 * @returns {{attach: () => void, setVisible: (v: boolean) => void, z: () => number}}
 */
export function tileGridOverlay(maps, view, fixedZ = null) {
  let visible = false;

  const panes = maps.map(map => {
    const source = new ol.source.Vector();
    const layer = new ol.layer.Vector({
      source,
      style: f => styleFor(f, () => view.calculateExtent(map.getSize())),
      // olms aggiunge i suoi layer in modo differito: senza zIndex alto la
      // griglia finisce sotto al vettoriale appena lo stile si completa.
      zIndex: 999,
      visible: false,
      properties: {'wm-grid': true}, // come la verifica ritrova la griglia
      updateWhileAnimating: true,
      updateWhileInteracting: true,
    });
    map.addLayer(layer);
    return {map, source, layer};
  });

  const currentZ = () =>
    fixedZ ?? tileGrid.getZForResolution(view.getResolution());

  function redraw() {
    if (!visible) return;
    const z = currentZ();
    for (const {map, source} of panes) {
      const size = map.getSize();
      if (!size) continue;
      source.clear(true);
      const features = [];
      tileGrid.forEachTileCoord(view.calculateExtent(size), z, coord => {
        const extent = tileGrid.getTileCoordExtent(coord);
        features.push(new ol.Feature({
          geometry: ol.geom.Polygon.fromExtent(extent),
          label: `${coord[0]}/${coord[1]}/${coord[2]}`,
        }));
      });
      source.addFeatures(features);
    }
  }

  view.on('change', redraw);
  window.addEventListener('resize', redraw);

  return {
    /** Da richiamare dopo ogni applyStyle(): clear() sui layer la rimuove. */
    attach() {
      for (const {map, layer} of panes) {
        if (!map.getLayers().getArray().includes(layer)) map.addLayer(layer);
      }
      redraw();
    },
    setVisible(v) {
      visible = v;
      for (const {layer, source} of panes) {
        layer.setVisible(v);
        if (!v) source.clear(true);
      }
      redraw();
    },
    z: currentZ,
  };
}
