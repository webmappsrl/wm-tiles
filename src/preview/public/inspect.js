/**
 * Ispezione interattiva della mappa vettoriale.
 *
 * Al passaggio del mouse evidenzia gli elementi sotto il cursore; al clic
 * raccoglie tutto quello che serve a descrivere un problema — quale layer di
 * stile ha disegnato cosa, con quali attributi, in quale tile, e soprattutto
 * il colore reso nei DUE pannelli nello stesso punto geografico. Un pulsante
 * copia il rapporto negli appunti.
 *
 * Il colore del riferimento si legge dal canvas del pannello destro, che
 * condivide la vista con quello sinistro: lo stesso pixel e' lo stesso punto
 * a terra.
 */

/** Contorno acceso, per evidenziare senza nascondere cosa c'e' sotto. */
const stileEvidenza = ol => new ol.style.Style({
  stroke: new ol.style.Stroke({color: 'rgba(214,31,105,0.95)', width: 3}),
  fill: new ol.style.Fill({color: 'rgba(214,31,105,0.18)'}),
  image: new ol.style.Circle({
    radius: 7,
    stroke: new ol.style.Stroke({color: 'rgba(214,31,105,0.95)', width: 3}),
    fill: new ol.style.Fill({color: 'rgba(214,31,105,0.25)'}),
  }),
});

/** Il colore di un pixel del canvas di una mappa, in coordinate schermo. */
function coloreAlPixel(map, pixel) {
  const canvas = map.getViewport().querySelector('canvas');
  if (!canvas) return null;
  const r = canvas.getBoundingClientRect();
  const sx = Math.round((pixel[0] / r.width) * canvas.width);
  const sy = Math.round((pixel[1] / r.height) * canvas.height);
  try {
    const ctx = canvas.getContext('2d', {willReadFrequently: true});
    if (!ctx) return null;                       // canvas WebGL: non leggibile
    const d = ctx.getImageData(sx, sy, 1, 1).data;
    return {r: d[0], g: d[1], b: d[2],
            hex: '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('')};
  } catch { return null; }
}

/**
 * Da RenderFeature a geometria disegnabile.
 *
 * `forEachFeatureAtPixel` su un layer vettoriale a tile restituisce
 * `RenderFeature`, non `Feature`: la sua geometria e' una struttura piatta e
 * passarla a `new ol.Feature({geometry})` fa fallire OpenLayers con
 * "t.addEventListener is not a function", perche' prova ad ascoltarne i
 * cambiamenti. Va ricostruita dalle coordinate.
 */
function aGeometria(ol, f) {
  if (typeof f.getFlatCoordinates !== 'function') return f.getGeometry?.() ?? null;
  const flat = f.getFlatCoordinates();
  const ends = typeof f.getEnds === 'function' ? f.getEnds() : null;
  try {
    switch (f.getType()) {
      case 'Point': return new ol.geom.Point(flat.slice(0, 2));
      case 'MultiPoint': return new ol.geom.MultiPoint(flat, 'XY');
      case 'LineString':
        return ends && ends.length > 1
          ? new ol.geom.MultiLineString(flat, 'XY', ends)
          : new ol.geom.LineString(flat, 'XY');
      case 'MultiLineString': return new ol.geom.MultiLineString(flat, 'XY', ends);
      case 'Polygon': return new ol.geom.Polygon(flat, 'XY', ends);
      case 'MultiPolygon': return new ol.geom.Polygon(flat, 'XY', ends);
      default: return null;
    }
  } catch { return null; }
}

const tileDi = (lon, lat, z) => {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(
    ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n,
  );
  return `${z}/${x}/${y}`;
};

/**
 * @param {object} ol       namespace OpenLayers
 * @param {object} sinistra mappa vettoriale (locale)
 * @param {object} destra   mappa di riferimento
 * @param {HTMLElement} pannello  dove scrivere il rapporto
 */
export function ispettore(ol, sinistra, destra, pannello) {
  let attivo = false;
  let ultimo = '';

  const evidenza = new ol.layer.Vector({
    source: new ol.source.Vector(),
    style: stileEvidenza(ol),
    zIndex: 1000,
    updateWhileInteracting: true,
    properties: {'wm-evidenza': true},
  });

  /**
   * Elenco dei layer di stile attivi a un dato zoom, e delle sorgenti che
   * usano: serve a dire cosa DOVREBBE esserci, anche quando la rilevazione
   * grafica non lo intercetta.
   */
  let stile = null;
  const caricaStile = async url => (stile ??= await (await fetch(url)).json());

  const attiviA = z => {
    if (!stile) return [];
    return stile.layers.filter(l => {
      if (l.layout?.visibility === 'none') return false;
      // minzoom e' soglia esclusa, maxzoom inclusa: le stesse regole del
      // generatore, altrimenti il rapporto elenca layer che non si vedono
      if (l.minzoom !== undefined && z <= l.minzoom) return false;
      if (l.maxzoom !== undefined && z > l.maxzoom) return false;
      return true;
    });
  };

  /**
   * Valuta un filtro dello Style Spec sulle proprieta' di una feature.
   *
   * Serve a dire QUALE layer ha disegnato l'elemento: ol-mapbox-style
   * raggruppa in un solo layer OpenLayers tutti i layer di stile consecutivi
   * con la stessa sorgente, e la rilevazione restituisce il gruppo. Senza
   * questa valutazione il rapporto elenca una dozzina di nomi e non dice
   * quale sia quello giusto.
   *
   * Copre gli operatori che lo stile usa davvero; su un costrutto non
   * riconosciuto restituisce `null`, che il chiamante tratta come "forse".
   */
  const valuta = (f, props) => {
    if (f === undefined || f === null) return true;
    if (!Array.isArray(f)) return null;
    const [op, ...a] = f;
    const val = e => {
      if (Array.isArray(e)) {
        if (e[0] === 'get') return props[e[1]];
        if (e[0] === 'literal') return e[1];
        if (e[0] === 'geometry-type') return props.$type;
        return null;
      }
      return e;
    };
    switch (op) {
      case 'all': return a.every(x => valuta(x, props) !== false);
      case 'any': return a.some(x => valuta(x, props) === true);
      case '!': return valuta(a[0], props) === false;
      case 'has': return props[val(a[0])] !== undefined;
      case '!has': return props[val(a[0])] === undefined;
      case '==': return val(a[0]) == val(a[1]);
      case '!=': return val(a[0]) != val(a[1]);
      case '<': return val(a[0]) < val(a[1]);
      case '<=': return val(a[0]) <= val(a[1]);
      case '>': return val(a[0]) > val(a[1]);
      case '>=': return val(a[0]) >= val(a[1]);
      case 'in': {
        const v = val(a[0]);
        const lista = a.length === 2 ? val(a[1]) : a.slice(1).map(val);
        return Array.isArray(lista) ? lista.includes(v) : false;
      }
      case 'match': {
        const v = val(a[0]);
        for (let i = 1; i < a.length - 1; i += 2) {
          const k = val(a[i]);
          if (Array.isArray(k) ? k.includes(v) : k == v) return true;
        }
        return true;   // il fallback fa comunque match
      }
      default: return null;
    }
  };

  /**
   * Fra i layer di stile del gruppo, quelli che possono aver disegnato questa
   * feature: stesso source-layer e filtro soddisfatto.
   */
  const quale = (ids, sourceLayer, props, z) => {
    if (!stile) return {certi: ids, forse: []};
    const certi = [], forse = [];
    for (const id of ids) {
      const l = stile.layers.find(x => x.id === id);
      if (!l) continue;
      if (l['source-layer'] && sourceLayer && l['source-layer'] !== sourceLayer) continue;
      if (l.minzoom !== undefined && z <= l.minzoom) continue;
      if (l.maxzoom !== undefined && z > l.maxzoom) continue;
      const esito = valuta(l.filter, props);
      if (esito === true) certi.push(id);
      else if (esito === null) forse.push(id);
    }
    return {certi, forse};
  };

  /** Le feature sotto il cursore, con il layer di stile che le ha disegnate. */
  const sotto = pixel => {
    const trovate = [];
    sinistra.forEachFeatureAtPixel(pixel, (f, layer) => {
      const ids = layer?.get('mapbox-layers') ?? [];
      const sl = f.get('layer') ?? layer?.get('mapbox-source') ?? null;
      const props = f.getProperties ? {...f.getProperties()} : {};
      delete props.geometry;
      trovate.push({
        feature: f,
        gruppo: ids,
        sourceLayer: sl ?? '?',
        props,
        // quale del gruppo ha davvero disegnato: si valutano i filtri
        ...quale(ids, sl, props, sinistra.getView().getZoom()),
      });
    }, {
      // una tolleranza stretta lascia fuori linee sottili ed etichette, e il
      // rapporto finisce per riportare sempre e solo i poligoni grandi
      hitTolerance: 8,
      // senza questo filtro la ricerca trova le geometrie che l'evidenza
      // stessa ha appena disegnato, e il rapporto si riempie di voci vuote
      layerFilter: l => !l.get('wm-evidenza') && !l.get('wm-grid'),
    });
    return trovate;
  };

  const onMove = e => {
    if (!attivo || e.dragging) return;
    const t = sotto(e.pixel);
    evidenza.getSource().clear(true);
    for (const x of t.slice(0, 6)) {
      const g = aGeometria(ol, x.feature);
      if (g) evidenza.getSource().addFeature(new ol.Feature({geometry: g}));
    }
    sinistra.getViewport().style.cursor = t.length ? 'crosshair' : '';
  };

  const onClick = e => {
    if (!attivo) return;
    const c = ol.proj.toLonLat(e.coordinate);
    const z = sinistra.getView().getZoom();
    const zi = Math.round(z);
    const cl = coloreAlPixel(sinistra, e.pixel);
    const cr = coloreAlPixel(destra, e.pixel);
    const t = sotto(e.pixel);

    const righe = [];
    righe.push(`punto      ${c[0].toFixed(5)}, ${c[1].toFixed(5)}`);
    righe.push(`zoom       ${z.toFixed(2)}   tile ${tileDi(c[0], c[1], zi)}`);
    if (cl || cr) {
      righe.push(`colore     locale ${cl ? `${cl.hex} rgb(${cl.r},${cl.g},${cl.b})` : 'n/d'}` +
        `   tgen ${cr ? `${cr.hex} rgb(${cr.r},${cr.g},${cr.b})` : 'n/d'}`);
      if (cl && cr) {
        const d = (a, b) => (a - b >= 0 ? '+' : '') + (a - b);
        righe.push(`           Δ r ${d(cl.r, cr.r)}  g ${d(cl.g, cr.g)}  b ${d(cl.b, cr.b)}`);
      }
    }
    // Cosa dovrebbe esserci, dallo stile: la rilevazione grafica intercetta
    // solo cio' che e' disegnato esattamente sotto il pixel, quindi da sola
    // riporta sempre i poligoni piu' grandi.
    const attivi = attiviA(zi);
    if (attivi.length) {
      const perSorgente = new Map();
      for (const l of attivi) {
        const k = l['source-layer'] ?? l.source ?? '-';
        if (!perSorgente.has(k)) perSorgente.set(k, []);
        perSorgente.get(k).push(l.id);
      }
      righe.push('');
      righe.push(`layer attivi a z${zi} (${attivi.length}):`);
      for (const [src, ids] of perSorgente) righe.push(`  ${src}: ${ids.join(', ')}`);
    }

    righe.push('');
    if (!t.length) {
      righe.push('nessuna geometria vettoriale sotto il cursore');
      righe.push('(il fondo, l\'ombreggiatura e le tile raster non sono interrogabili)');
    } else {
      righe.push(`${t.length} element${t.length === 1 ? 'o' : 'i'} sotto il cursore:`);
      t.slice(0, 8).forEach((x, i) => {
        const nome = x.certi.length ? x.certi.join(' + ')
          : x.forse.length ? x.forse.join(' | ') + '  (filtro non valutabile)'
          : x.gruppo.join(', ') || '?';
        righe.push(`  ${i + 1}. LAYER: ${nome}`);
        righe.push(`     source-layer: ${x.sourceLayer}`);
        if (x.gruppo.length > 1 && x.certi.length)
          righe.push(`     (nel gruppo OpenLayers con: ${x.gruppo.filter(g => !x.certi.includes(g)).join(', ')})`);
        const attr = Object.entries(x.props).filter(([k]) => !k.startsWith('name_') && k !== 'name:latin');
        if (attr.length) righe.push(`     ${attr.map(([k, v]) => `${k}=${v}`).join('  ')}`);
      });
    }
    ultimo = righe.join('\n');
    pannello.querySelector('pre').textContent = ultimo;
    pannello.style.display = 'block';
  };

  sinistra.on('pointermove', onMove);
  sinistra.on('singleclick', onClick);

  return {
    /** Lo stile serve per elencare i layer attivi: si carica una volta. */
    async caricaStile(url) { await caricaStile(url); },
    setAttivo(v) {
      attivo = v;
      if (v) {
        if (!sinistra.getLayers().getArray().includes(evidenza)) sinistra.addLayer(evidenza);
      } else {
        evidenza.getSource().clear(true);
        sinistra.getViewport().style.cursor = '';
        pannello.style.display = 'none';
      }
    },
    /** Il layer di evidenza va rimesso dopo ogni applyStyle. */
    riattacca() {
      if (attivo && !sinistra.getLayers().getArray().includes(evidenza)) sinistra.addLayer(evidenza);
    },
    testo: () => ultimo,
  };
}
