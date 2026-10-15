/**
 * Preview con OpenLayers, cioe' con lo stesso renderer di map-core.
 *
 * Serve a giudicare la somiglianza su quello che vedra' davvero l'app: MapLibre
 * e OpenLayers interpretano la style spec in modo non identico (etichette,
 * dasharray, hillshade), quindi una preview MapLibre puo' mostrare un risultato
 * che map-core non riproduce.
 *
 * Le versioni caricate sono quelle candidate per map-core: ol 7.1.0 (quella
 * attualmente pinnata) e ol-mapbox-style 10.4.0, la piu' recente che non
 * dichiara vincoli su ol e che supporta raster-dem con encoding terrarium.
 */

import {tileGridOverlay} from './grid.js';
import {coperturaOverlay} from './copertura.js';
import {hillshadeGpu} from './hillshade.js';
import {ispettore} from './inspect.js';

const el = id => document.getElementById(id);
const showError = msg => {
  const box = el('err');
  box.style.display = 'block';
  box.textContent += (box.textContent ? '\n' : '') + String(msg).slice(0, 1200);
};

const params0 = new URLSearchParams(location.search);

window.addEventListener('error', e => showError('JS: ' + e.message));
window.addEventListener('unhandledrejection', e => showError('promise: ' + (e.reason?.message ?? e.reason)));

el('stack').textContent = `ol ${window.__versions?.ol ?? '?'} · ol-mapbox-style ${window.__versions?.olms ?? '?'}`;

// ?single=left|right nasconde l'altro pannello: serve agli screenshot
const single = params0.get('single');
if (single) document.body.classList.add(`single-${single}`);

// Sugli schermi stretti i controlli partono chiusi: aperti occuperebbero
// quasi meta' dell'altezza utile.
const chiudiBarra = chiusa => {
  document.body.classList.toggle('bar-chiusa', chiusa);
  el('bartoggle').setAttribute('aria-expanded', String(!chiusa));
};
chiudiBarra(matchMedia('(max-width: 720px)').matches);
el('bartoggle').addEventListener('click', () =>
  chiudiBarra(!document.body.classList.contains('bar-chiusa')));

const cfg = await (await fetch('/preview/config.json')).json();
const params = params0;
const state = {set: params.get('set') || cfg.defaultSet};

const areas = cfg.areas.length ? cfg.areas : [{id: 'demo', label: 'area demo', center: [10.31, 44.28], zoom: 13}];
for (const a of areas) el('area').append(new Option(a.label, a.id));
for (const s of cfg.sets) el('set').append(new Option(s.groups.join(', '), s.setId));
el('set').value = state.set;

const start = areas.find(a => a.id === params.get('area')) ?? areas[0];
el('area').value = start.id; // il menu mostra l'area aperta, non sempre la prima
const fromLonLat = ol.proj.fromLonLat;

// `?c=lon,lat` centra la vista all'apertura. Spostarla dopo il caricamento
// innesca una corsa con la costruzione differita dei layer di
// ol-mapbox-style: l'ombreggiatura a volte non arriva e uno screenshot preso
// in quel momento e' piu' chiaro di 15 punti, senza alcun errore.
const cParam = (params.get('c') || '').split(',').map(Number);
const center = cParam.length === 2 && cParam.every(Number.isFinite) ? cParam : start.center;

const view = new ol.View({
  center: fromLonLat(center),
  zoom: Number(params.get('zoom') ?? start.zoom),
  constrainResolution: false,
});

/**
 * Pannello di destra: il riferimento di TGen oppure, con `?destra=png`, i PNG
 * resi da `pipeline/render-png.mjs`. Cosi' i PNG si giudicano accanto al
 * vettoriale da cui vengono, e passando da uno all'altro col riferimento.
 * Dove un PNG non e' stato reso il pannello resta vuoto: non e' un difetto.
 */
const sorgentiDestra = {
  tgen: {titolo: 'TGEN — riferimento raster', url: cfg.legacyTileUrl},
  png: {titolo: 'PNG locali — resi da wm-tiles', url: cfg.pngTileUrl},
};
const rasterDestra = new ol.layer.Tile();
function mostraDestra(chi) {
  const s = sorgentiDestra[chi] ?? sorgentiDestra.tgen;
  rasterDestra.setSource(new ol.source.XYZ({
    url: s.url,
    maxZoom: 16,
    minZoom: 7,
    crossOrigin: 'anonymous',
    attributions: '© OpenStreetMap contributors',
  }));
  el('titolodestra').textContent = s.titolo;
  el('destra').value = sorgentiDestra[chi] ? chi : 'tgen';
}
mostraDestra(params0.get('destra') ?? 'tgen');
el('destra').onchange = e => mostraDestra(e.target.value);

const right = new ol.Map({
  target: 'right',
  view,
  controls: [new ol.control.ScaleLine({units: 'metric'})],
  layers: [rasterDestra],
});

/** Locale: lo stile applicato da ol-mapbox-style, come fara' map-core. */
/**
 * Sui telefoni la mappa locale disegna a densita' 1.
 *
 * ol-mapbox-style ne fa 59 layer `hybrid`, e ognuno tiene un canvas per tile:
 * a densita' 3 sono quasi 2 GB dopo una quindicina di spostamenti (216 MB a
 * densita' 1), oltre il tetto che Safari su iPhone concede ai canvas. La
 * pagina veniva chiusa mentre ci si muoveva ("impossibile aprire questa
 * pagina"), senza errori. I PNG del pannello di destra sono comunque a
 * densita' 1, quindi il confronto non ci perde.
 */
const telefono = matchMedia('(max-width: 720px), (pointer: coarse)').matches;

/**
 * `?render=vector` ridisegna i layer vettoriali a ogni frame invece di tenere
 * un canvas per tile (`hybrid`, il default di ol-mapbox-style). Misurato a
 * densita' 3 con la CPU rallentata 4 volte: canvas da 3 GB a 165 MB, e la
 * panoramica piu' fluida (p90 da 60 a 29 ms); a densita' 1 `hybrid` resta
 * piu' fluido. Serve a provare sul telefono, alla densita' vera, la modalita'
 * che le app potrebbero adottare: per questo non c'e' il limite di sopra.
 */
const renderVector = params0.get('render') === 'vector';

const left = new ol.Map({
  target: 'left',
  view, // vista condivisa: le due mappe sono sincronizzate per costruzione
  ...(telefono && !renderVector ? {pixelRatio: 1} : {}),
  controls: [new ol.control.Zoom()],
  layers: [],
});

/**
 * ol-mapbox-style 11 non lascia scegliere la modalita' da `apply()`: ogni
 * layer `hybrid` che arriva si sostituisce con una copia `vector`. La
 * sostituzione aspetta la fine dell'evento `add`, per non modificare la
 * collezione mentre la si notifica.
 *
 * La copia deve SEGUIRE l'originale, non fotografarlo: quando il layer arriva
 * non ha ancora sorgente, risoluzioni, `zIndex` ne' lo stile definitivo, che
 * ol-mapbox-style assegna dopo. Copiato all'arrivo, la mappa restava vuota.
 * Lo stile si ricopia a ogni `change`, che e' anche il segnale con cui
 * ol-mapbox-style chiede di ridisegnare quando arriva un'icona.
 */
if (renderVector) {
  const layers = left.getLayers();
  layers.on('add', e => {
    const l = e.element;
    if (l.getRenderMode?.() !== 'hybrid') return;
    queueMicrotask(() => {
      const i = layers.getArray().indexOf(l);
      if (i < 0) return;
      const copia = new ol.layer.VectorTile({
        renderMode: 'vector',
        source: l.getSource(),
        style: l.getStyle(),
        declutter: l.getDeclutter(),
        className: l.getClassName(),
        properties: l.getProperties(),
      });
      l.on('propertychange', ev => { if (ev.key !== 'map') copia.set(ev.key, l.get(ev.key)); });
      l.on('change', () => copia.setStyle(l.getStyle()));
      layers.setAt(i, copia);
    });
  });
}

/**
 * Griglia XYZ su entrambi i pannelli. `?grid=14` forza il livello — utile per
 * vedere i confini delle tile di una sorgente il cui maxzoom e' piu' basso
 * dello zoom di vista, che e' dove nascono gli artefatti da overzoom.
 * `?grid=on` la mostra subito, senza dover cliccare.
 */
const insp = ispettore(ol, left, right, el('inspectbox'));

el('inspect').onchange = async e => {
  if (e.target.checked) await insp.caricaStile(styleUrl);
  insp.setAttivo(e.target.checked);
  el('inspectlabel').classList.toggle('off', !e.target.checked);
};
el('inspectcopy').onclick = async () => {
  const t = insp.testo();
  if (!t) return;
  try {
    await navigator.clipboard.writeText(t);
    el('inspectcopy').textContent = 'copiato';
  } catch {
    // il permesso agli appunti puo' mancare: si seleziona il testo, cosi'
    // resta comunque copiabile a mano
    const pre = el('inspectbox').querySelector('pre');
    const r = document.createRange();
    r.selectNodeContents(pre);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    el('inspectcopy').textContent = 'selezionato';
  }
  setTimeout(() => (el('inspectcopy').textContent = 'copia'), 1500);
};
el('inspectclose').onclick = () => (el('inspectbox').style.display = 'none');

// 'i' come 'g' per la griglia: durante un confronto si accende e spegne spesso
addEventListener('keydown', e => {
  if (e.key !== 'i' || e.target.tagName === 'SELECT' || e.metaKey || e.ctrlKey) return;
  el('inspect').checked = !el('inspect').checked;
  el('inspect').onchange({target: el('inspect')});
});

const gridParam = params0.get('grid');
const grid = tileGridOverlay([left, right], view, /^\d+$/.test(gridParam ?? '') ? Number(gridParam) : null);

/**
 * Riquadro rosso dell'area generata, su entrambi i pannelli. `?copertura=on`
 * lo mostra subito. Fuori da quel bbox le tile vettoriali non esistono mentre
 * il riferimento risponde comunque: senza il riquadro la differenza sembra un
 * difetto di stile invece che assenza di dati.
 */
const copertura = coperturaOverlay([left, right]);

const styleUrl = `${location.origin}/style.json?set=${state.set}`;

/**
 * Ombreggiatura calcolata: non e' un layer dello stile, quindi va inserita a
 * mano nella pila, sopra le superfici e sotto le curve di livello — la stessa
 * posizione che ha nel riferimento. `ol-mapbox-style` aggiunge i suoi layer in
 * modo differito, per cui il posizionamento va ripetuto quando la pila cambia.
 */
let shade = null;

/**
 * Colloca l'ombreggiatura sotto le curve di livello usando `zIndex`.
 *
 * NON si tocca l'ordine della collezione: rimuovere un layer WebGL dalla mappa
 * lo smonta, e al reinserimento deve ricostruire il contesto e ricaricare le
 * texture — per qualche frame non disegna nulla e si vede un lampo, cioe' la
 * mappa che si schiarisce di colpo. Con `ol-mapbox-style` i layer arrivano in
 * modo differito, quindi la funzione veniva richiamata piu' volte dopo il
 * caricamento e il lampo si ripeteva (misurato a 800 e 2000 ms).
 *
 * Con `zIndex` i layer restano dove sono e cambia solo l'ordine di disegno:
 * ai vettoriali si assegna l'indice di collezione, all'ombra il valore del
 * primo gruppo che contiene le curve, meno un soffio.
 */
function posizionaOmbra() {
  if (!shade) return;
  const layers = left.getLayers();
  const arr = layers.getArray();

  let limite = arr.findIndex(l => (l.get('mapbox-layers') ?? []).some(i => i.startsWith('contour')));
  if (limite < 0) limite = arr.length;

  arr.forEach((l, k) => {
    if (l === shade.layer || l === shade.pendenzaLayer) return;
    // passo 10: lascia spazio per infilare l'ombra fra due layer adiacenti
    if (l.getZIndex() !== k * 10) l.setZIndex(k * 10);
  });

  const z = limite * 10 - 5;
  if (shade.layer.getZIndex() !== z) shade.layer.setZIndex(z);
  if (shade.pendenzaLayer && shade.pendenzaLayer.getZIndex() !== z + 1) {
    shade.pendenzaLayer.setZIndex(z + 1);
  }

  for (const l of [shade.layer, shade.pendenzaLayer]) {
    if (l && !arr.includes(l)) layers.push(l);
  }
}

/**
 * Le tile vettoriali scelte come le tile raster di TGen: il livello con la
 * risoluzione piu' vicina (`zDirection: 0`), cioe' N da N - 0,585. Di serie una
 * VectorTile ha `zDirection: 1` e passa al livello N solo a N: fra 12,42 e 12,99
 * TGen mostrava gia' z13 e il vettoriale ancora i dati di z12 (15 ottobre 2026).
 * Gli stili seguono la stessa soglia (ANTICIPO in build-style.mjs). ol-mapbox-style
 * crea le sorgenti da se', e alcuni layer arrivano dopo apply(): si sistemano
 * subito e a ogni layer aggiunto. Lo stesso va fatto in map-core.
 */
function allineaLivelli(mappa) {
  const sistema = l => {
    const src = l.getSource?.();
    if (src instanceof ol.source.VectorTile && src.zDirection !== 0) {
      src.zDirection = 0;
      src.changed();
    }
  };
  mappa.getLayers().forEach(sistema);
  if (!mappa.get('wm-allinea')) {
    mappa.set('wm-allinea', true);
    mappa.getLayers().on('add', e => sistema(e.element));
  }
}

async function applyStyle() {
  el('err').textContent = '';
  el('err').style.display = 'none';
  shade = null;
  left.getLayers().clear();
  try {
    // apply() costruisce i layer OpenLayers dallo style.json
    await window.olms.apply(left, styleUrl);
    allineaLivelli(left);
    const built = left.getLayers().getArray().map(l => ({
      kind: l.constructor.name,
      source: l.getSource()?.constructor.name,
      visible: l.getVisible(),
      mapboxLayers: l.get('mapbox-layers'),
      mapboxSource: l.get('mapbox-source'),
    }));
    window.__built = built;

    // ?only=a,b  tiene solo i layer di stile elencati
    // ?off=a,b   nasconde quelli elencati
    // Servono a isolare quale layer produce una differenza rispetto al
    // riferimento, invece di stimarlo a occhio.
    const only = (params0.get('only') || '').split(',').filter(Boolean);
    const off = (params0.get('off') || '').split(',').filter(Boolean);
    if (only.length || off.length) {
      // apply() aggiunge i layer in modo differito: filtrare subito colpisce
      // una lista incompleta e i layer aggiunti dopo restano visibili.
      const applyFilter = () => {
        for (const layer of left.getLayers().getArray()) {
          // ombreggiatura e griglia non sono layer di stile e non hanno
          // `mapbox-layers`: con ?only= sparivano insieme a tutto il resto,
          // rendendo impossibile guardare la sola ombra.
          if (layer.get('wm-hillshade') || layer.get('wm-hillshade-slope') ||
              layer.get('wm-grid') || layer.get('wm-evidenza') ||
              layer.get('wm-copertura')) continue;
          const ids = layer.get('mapbox-layers') || [];
          const keep = only.length ? ids.some(i => only.includes(i)) : !ids.some(i => off.includes(i));
          layer.setVisible(keep);
        }
      };
      applyFilter();
      left.getLayers().on('add', applyFilter);
      setTimeout(applyFilter, 800);
      setTimeout(applyFilter, 2000);
    }

    // L'ombreggiatura si costruisce dai metadati dello stile: le fasce di
    // opacita' e i parametri del sole restano nel profilo per zoom.
    const st = await (await fetch(styleUrl)).json();
    // `?shade=off` toglie l'ombreggiatura: serve a distinguere i difetti di
    // colore da quelli di rilievo, che le misure altrimenti confondono
    const hs = params0.get('shade') === 'off' ? null : st.metadata?.['wm:hillshade'];
    if (hs && st.sources?.[hs.source]) {
      shade = hillshadeGpu(ol, st.sources[hs.source], hs.fasce ?? []);
      shade.aggiornaOpacita(view.getZoom());
      posizionaOmbra();
      left.getLayers().on('add', posizionaOmbra);
      setTimeout(posizionaOmbra, 800);
      setTimeout(posizionaOmbra, 2000);
    } else if (hs) {
      showError(`ombreggiatura: sorgente '${hs.source}' non dichiarata nello stile`);
    }

    grid.attach(); // applyStyle() svuota i layer del pannello locale
    copertura.attach();
    insp.riattacca();

    el('meta').textContent = `${built.length} layer OL${renderVector ? ' · vector' : ''}`;
  } catch (e) {
    showError('olms.apply: ' + (e?.message ?? e));
  }
}

await applyStyle();

/**
 * Un interruttore per OGNI layer di stile.
 *
 * Prima gli interruttori seguivano i gruppi del manifest, che sono
 * commerciali e non cartografici: `base` contiene acque, confini e uso
 * urbano insieme, quindi spegnendo "Sfondo" sparivano anche i fiumi. Per
 * capire quale layer produce una differenza serve poterli spegnere uno per
 * uno.
 *
 * Lo spegnimento passa da `layout.visibility` nello stile, non da
 * `setVisible` sui layer OpenLayers: ol-mapbox-style raggruppa in un solo
 * layer OL i layer di stile consecutivi con la stessa sorgente, e agire sul
 * gruppo ne spegnerebbe una decina insieme. Riapplicare lo stile costa un
 * secondo, ma e' preciso.
 */
let stileBase = null;
const spenti = new Set();

async function buildToggles() {
  stileBase ??= await (await fetch(styleUrl)).json();

  // categoria di appartenenza, solo per raggruppare visivamente le voci
  const categoria = id =>
    /^(background|landcover|clc|landuse)/.test(id) ? 'superfici'
    : /^(water|contour)/.test(id) ? 'acque e curve'
    : /^(road|track|path|aerialway|hiking)/.test(id) ? 'viabilita'
    : /^(place|toponimi|park-label|water-name|waterway-label|road-label|road-ref|hiking-ref|contour-label)/.test(id) ? 'etichette'
    : /^(poi|osmpoi|rifugi|mountain)/.test(id) ? 'punti'
    : 'altro';

  const perCategoria = new Map();
  for (const sl of stileBase.layers) {
    const c = categoria(sl.id);
    if (!perCategoria.has(c)) perCategoria.set(c, []);
    perCategoria.get(c).push(sl.id);
  }

  el('groups').innerHTML = [...perCategoria.entries()].map(([cat, ids]) =>
    `<span class="cat" title="${cat}">` +
    ids.map(id =>
      `<label data-l="${id}" class="${spenti.has(id) ? 'off' : ''}" title="${id}">` +
      `<input type="checkbox" data-l="${id}"${spenti.has(id) ? '' : ' checked'}> ${id}</label>`
    ).join('') + '</span>',
  ).join('');

  el('groups').onchange = async e => {
    const id = e.target.dataset.l;
    if (!id) return;
    if (e.target.checked) spenti.delete(id); else spenti.add(id);
    el('groups').querySelector(`label[data-l="${id}"]`).classList.toggle('off', !e.target.checked);
    await applicaSpenti();
  };
}

/** Riapplica lo stile con i layer spenti marcati `visibility: none`. */
async function applicaSpenti() {
  const st = JSON.parse(JSON.stringify(stileBase));
  for (const sl of st.layers) {
    if (spenti.has(sl.id)) sl.layout = {...(sl.layout ?? {}), visibility: 'none'};
  }
  shade = null;
  left.getLayers().clear();
  await window.olms.apply(left, st);
  allineaLivelli(left);
  const hs = st.metadata?.['wm:hillshade'];
  if (hs && st.sources?.[hs.source]) {
    shade = hillshadeGpu(ol, st.sources[hs.source], hs.fasce ?? []);
    shade.aggiornaOpacita(view.getZoom());
    posizionaOmbra();
    left.getLayers().on('add', posizionaOmbra);
    setTimeout(posizionaOmbra, 800);
  }
  grid.attach();
  insp.riattacca();
  el('meta').textContent = `${st.layers.length - spenti.size}/${st.layers.length} layer`;
}

await buildToggles();

const gridLabel = () =>
  el('gridz').textContent = el('grid').checked ? `z${grid.z()}${gridParam && /^\d+$/.test(gridParam) ? ' fisso' : ''}` : '';

el('grid').onchange = e => {
  grid.setVisible(e.target.checked);
  el('gridlabel').classList.toggle('off', !e.target.checked);
  document.body.classList.toggle('grid', e.target.checked);
  gridLabel();
};

// La griglia si accende e spegne spesso durante un confronto: 'g' evita di
// tornare col mouse sulla barra a ogni verifica.
addEventListener('keydown', e => {
  if (e.key !== 'g' || e.target.tagName === 'SELECT' || e.metaKey || e.ctrlKey) return;
  el('grid').checked = !el('grid').checked;
  el('grid').onchange({target: el('grid')});
});

if (gridParam) {
  el('grid').checked = true;
  el('grid').onchange({target: el('grid')});
}

/**
 * L'ombreggiatura e la pendenza non sono layer dello stile: gli interruttori
 * dei layer non le toccano, e senza questi due non c'e' modo di spegnerle dal
 * frontend. Spegnendo tutto il resto restava solo l'ombra, senza che nulla
 * dicesse che cosa fosse.
 */
const mostraOmbra = (chiave, on) => {
  for (const l of left.getLayers().getArray()) {
    if (l.get(chiave)) l.setVisible(on);
  }
};
el('ombra').onchange = e => mostraOmbra('wm-hillshade', e.target.checked);
el('pendenza').onchange = e => mostraOmbra('wm-hillshade-slope', e.target.checked);

el('copertura').onchange = e => copertura.setVisible(e.target.checked);

// 'b' come bordo: si accende per capire se una differenza e' di stile o solo
// assenza di dati, e si rispegne subito.
addEventListener('keydown', e => {
  if (e.key !== 'b' || e.target.tagName === 'SELECT' || e.metaKey || e.ctrlKey) return;
  el('copertura').checked = !el('copertura').checked;
  el('copertura').onchange({target: el('copertura')});
});

if (params0.get('copertura') === 'on') {
  el('copertura').checked = true;
  el('copertura').onchange({target: el('copertura')});
}

view.on('change', () => {
  shade?.aggiornaOpacita(view.getZoom());
  const c = ol.proj.toLonLat(view.getCenter());
  el('meta').title = `z${view.getZoom().toFixed(1)} · ${c[0].toFixed(4)}, ${c[1].toFixed(4)}`;
  gridLabel();
});

// l'indirizzo segue l'area scelta (/preview/<nome>), cosi' quello che si
// copia e si manda apre cio' che si sta guardando; gli altri parametri restano
const indirizzoArea = a => {
  if (!a?.slug) return;
  const q = new URLSearchParams(location.search);
  for (const k of ['area', 'c', 'zoom']) q.delete(k);
  history.replaceState(null, '', `/preview/${a.slug}${q.size ? `?${q}` : ''}`);
};
if (params.get('area')) indirizzoArea(start);

el('area').onchange = e => {
  const a = areas.find(x => x.id === e.target.value);
  if (a) {
    view.setCenter(fromLonLat(a.center));
    view.setZoom(a.zoom);
    indirizzoArea(a);
  }
};

el('set').onchange = async e => {
  state.set = e.target.value;
  await applyStyle();
};

window.__wm = {left, right, view, cfg, state, grid, copertura, get shade() { return shade; }};
