/**
 * Riquadro dell'area effettivamente generata, su entrambi i pannelli.
 *
 * Il prototipo copre un bbox, non l'Italia: fuori da quello le tile vettoriali
 * semplicemente non esistono, mentre il riferimento raster continua a
 * rispondere. Il risultato e' un confronto in cui il pannello di sinistra e'
 * vuoto o incompleto senza che nulla lo segnali — e' successo piu' volte di
 * misurare una differenza enorme che era solo assenza di dati.
 *
 * Il rettangolo serve SOLO alla preview: non fa parte dello stile e non
 * finisce in nessuna tile.
 *
 * Il bbox si legge da `/version` (`provenance.scope`), cosi' segue l'area
 * davvero generata invece di essere scritto a mano da qualche parte.
 */

const ROSSO = 'rgba(220,38,38,.9)';

/** `bbox 10.0,43.9,10.9,44.5 (Appennino ...)` -> [W, S, E, N] */
export function leggiBbox(scope) {
  const m = /bbox\s*(-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)/.exec(scope ?? '');
  return m ? m.slice(1).map(Number) : null;
}

/**
 * @param {Array} maps  le mappe su cui disegnare (i due pannelli)
 * @param {string} base URL del server, per leggere /version
 */
export function coperturaOverlay(maps, base = '') {
  const panes = maps.map(map => {
    const source = new ol.source.Vector({wrapX: false});
    const layer = new ol.layer.Vector({
      source,
      // sopra tutto: il riquadro deve restare leggibile anche sopra la griglia
      zIndex: 1000,
      updateWhileAnimating: true,
      updateWhileInteracting: true,
      // esclude il layer dall'ispettore e dai filtri ?only= / ?off=
      properties: {'wm-copertura': true},
      style: [
        new ol.style.Style({
          stroke: new ol.style.Stroke({color: ROSSO, width: 2}),
        }),
        new ol.style.Style({
          geometry: f => {
            const [, , maxX, maxY] = f.getGeometry().getExtent();
            return new ol.geom.Point([maxX, maxY]);
          },
          text: new ol.style.Text({
            text: 'dati generati',
            font: '600 10px ui-monospace, monospace',
            textAlign: 'right',
            textBaseline: 'bottom',
            offsetX: -4,
            offsetY: -3,
            fill: new ol.style.Fill({color: ROSSO}),
            stroke: new ol.style.Stroke({color: 'rgba(255,255,255,.85)', width: 2.5}),
          }),
        }),
      ],
      visible: false,
    });
    return {map, layer, source};
  });

  let bbox = null;
  let visible = false;

  function disegna() {
    for (const {layer, source} of panes) {
      source.clear(true);
      layer.setVisible(visible && !!bbox);
      if (!visible || !bbox) continue;
      const [W, S, E, N] = bbox;
      const extent = [
        ...ol.proj.fromLonLat([W, S]),
        ...ol.proj.fromLonLat([E, N]),
      ];
      source.addFeature(new ol.Feature({geometry: ol.geom.Polygon.fromExtent(extent)}));
    }
  }

  const pronto = (async () => {
    try {
      const v = await (await fetch(`${base}/version`)).json();
      bbox = leggiBbox(v?.provenance?.scope);
    } catch { bbox = null; }
    disegna();
    return bbox;
  })();

  return {
    /** Da richiamare dopo ogni applyStyle(): svuota i layer del pannello. */
    attach() {
      for (const {map, layer} of panes) {
        if (!map.getLayers().getArray().includes(layer)) map.addLayer(layer);
      }
      disegna();
    },
    setVisible(v) { visible = v; disegna(); },
    bbox: () => bbox,
    pronto,
  };
}
