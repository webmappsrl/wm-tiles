/**
 * Genera style/webmapp.json dal profilo per zoom e dai layer di base.
 *
 *   style/base-layers.json  struttura dei layer (source, filtri, paint)
 *   style/zoom-profile.json ordine e visibilita' per livello, set per fascia
 *                           -> style/webmapp.json
 *
 * Perche' passare da un generatore invece di scrivere lo stile a mano:
 *
 *  - `minzoom` in ol-mapbox-style e' una soglia ESCLUSA (un layer con
 *    minzoom 12 e' invisibile a zoom 12). Scritta a mano, quella regola era
 *    stata dimenticata su 28 layer, tutti silenziosamente assenti alla loro
 *    soglia. Qui il profilo dichiara i livelli in cui il layer si vede e la
 *    conversione avviene in un punto solo.
 *  - i parametri del riferimento cambiano per fascia (ombra, uso suolo,
 *    modello stradale): tenerli sparsi nei layer significa correggere un
 *    livello e romperne un altro.
 *
 * Non modificare style/webmapp.json a mano: viene sovrascritto.
 *
 * Uso: node pipeline/build-style.mjs [out]
 */
import {readFileSync, writeFileSync} from 'node:fs';

const OUT = process.argv[2] ?? 'style/webmapp.json';
const base = JSON.parse(readFileSync('style/base-layers.json', 'utf8'));
const prof = JSON.parse(readFileSync('style/zoom-profile.json', 'utf8'));
const [Z0, Z1] = prof.zoomRange;

/**
 * Porta le soglie di zoom di `step`/`interpolate` da nominali a effettive,
 * togliendo un livello (vedi il commento dentro il ciclo dei layer).
 */
function scalaZoom(nodo) {
  if (Array.isArray(nodo)) {
    const suZoom = (nodo[0] === 'step' && Array.isArray(nodo[1]) && nodo[1][0] === 'zoom')
      || (nodo[0] === 'interpolate' && Array.isArray(nodo[2]) && nodo[2][0] === 'zoom');
    if (!suZoom) return nodo.map(scalaZoom);
    // step:        ["step", ["zoom"], default, s1, v1, s2, v2, ...]
    // interpolate: ["interpolate", tipo, ["zoom"], s1, v1, s2, v2, ...]
    const primo = 3;
    const out = nodo.slice(0, primo).map(scalaZoom);
    for (let i = primo; i < nodo.length; i += 2) {
      out.push(typeof nodo[i] === 'number' ? nodo[i] - 1 : scalaZoom(nodo[i]));
      if (i + 1 < nodo.length) out.push(scalaZoom(nodo[i + 1]));
    }
    return out;
  }
  if (nodo && typeof nodo === 'object') {
    return Object.fromEntries(Object.entries(nodo).map(([k, v]) => [k, scalaZoom(v)]));
  }
  return nodo;
}

const byId = new Map(base.layers.map(l => [l.id, l]));
const livelli = z => new Set(prof.levels[String(z)].visible);

/** Intervalli contigui di zoom in cui il layer e' visibile. */
const intervalli = id => {
  const out = [];
  let start = null;
  for (let z = Z0; z <= Z1 + 1; z++) {
    const on = z <= Z1 && livelli(z).has(id);
    if (on && start === null) start = z;
    if (!on && start !== null) { out.push([start, z - 1]); start = null; }
  }
  return out;
};

const layers = [];
const avvisi = [];
for (const id of prof.order) {
  const l = byId.get(id);
  if (!l) { avvisi.push(`${id}: nel profilo ma non in base-layers.json`); continue; }
  const iv = intervalli(id);
  if (!iv.length) { avvisi.push(`${id}: mai visibile, escluso`); continue; }

  // Un layer puo' avere un buco: il riferimento non usa il casing delle
  // strade maggiori a z10-z11, dove passa al modello con alone. Lo Style
  // Spec non esprime buchi in un solo layer, quindi si emette un layer per
  // intervallo, con l'intervallo nel nome per rendere il salto evidente.
  iv.forEach(([zmin, zmax], k) => {
  const out = {...l};
  if (k > 0) out.id = `${l.id}-z${zmin}`;
  /**
   * Le due soglie NON sono simmetriche in ol-mapbox-style, ed e' verificato:
   *  - `minzoom: N` -> il layer si vede da N+1 (soglia ESCLUSA)
   *  - `maxzoom: N` -> il layer si vede fino a N compreso (soglia INCLUSA)
   * Trattandole entrambe come escluse, `clc-fill` restava visibile a z14 e
   * copriva `landcover-fill`, che sta sotto: a z14 l'uso suolo regionale non
   * si vedeva affatto e la mappa mostrava ancora Corine. Nessun errore, e la
   * taratura della palette regionale non aveva alcun effetto.
   */
  if (zmin > Z0) out.minzoom = zmin - 1;
  /**
   * `maxzoom` si emette SOLO se il layer si spegne prima della fine della
   * scala. Un layer visibile all'ultimo livello del profilo non ne riceve
   * nessuno, e resta quindi visibile a z17, z18, z19...
   *
   * E' voluto: il riferimento raster finisce a z16, quindi oltre non c'e'
   * nulla da imitare e la regola e' tenere i parametri dell'ultimo livello
   * derivato da TGen. Vale anche per le espressioni (`step` e `interpolate`
   * mantengono l'ultimo valore) e per le fasce d'ombra (`fasce.at(-1)` in
   * hillshade.js). Verificato da `tools/oltre-z16.mjs`.
   */
  if (zmax < Z1) out.maxzoom = zmax;

  /**
   * Lo stesso sfasamento vale DENTRO le espressioni.
   *
   * `ol-mapbox-style` valuta `["step", ["zoom"], ...]` e `["interpolate", ...,
   * ["zoom"], ...]` con un livello di scarto: una soglia scritta 12 fa
   * scattare il valore a vista z13. Verificato contando i pixel di un colore
   * noto su road-fill-secondary ai tre livelli.
   *
   * Le soglie nei sorgenti restano quindi quelle NOMINALI del CartoCSS e la
   * correzione si applica qui, in un punto solo. Prima erano compensate a mano
   * layer per layer: alcune nominali, altre gia' scalate, senza modo di
   * distinguerle rileggendo il file.
   */
  if (out.paint) out.paint = scalaZoom(out.paint);
  if (out.layout) out.layout = scalaZoom(out.layout);

  /**
   * Palette delle superfici, per fascia.
   *
   * I due layer di uso suolo si dividono la scala (Corine fino a z13, dati
   * regionali da z14), quindi ciascuno prende il set del proprio intervallo e
   * non serve alcuna espressione sullo zoom. La palette e' indicizzata per
   * chiave semantica (`bosco`, `pascolo`): il riferimento tiene toni molto
   * piu' tenui da z14, e cosi' si corregge una voce invece di 44 valori.
   */
  const setName = prof.levels[String(zmin)].surfaces;
  const pal = prof.surfaceSets[setName];
  if (pal && (id === 'clc-fill' || id === 'landcover-fill')) {
    const chiave = id === 'clc-fill'
      ? code => prof.clcSemantica[code]           // 111 -> fondogiallo
      : code => code;                             // coduso e' gia' semantico
    const m = l.paint?.['fill-color'];
    if (Array.isArray(m) && m[0] === 'match') {
      const nuovo = [...m];
      let sostituiti = 0;
      for (let k = 2; k < nuovo.length - 1; k += 2) {
        const c = pal[chiave(nuovo[k])];
        if (c) { nuovo[k + 1] = c; sostituiti++; }
      }
      const fallback = pal[chiave(String(m.at(-1)))] ?? pal.verdeneutro;
      if (fallback) nuovo[nuovo.length - 1] = fallback;
      out.paint = {...l.paint, 'fill-color': nuovo};
      if (!sostituiti) avvisi.push(`${id}: palette '${setName}' non ha coperto nessuna voce`);

      // Una classe assente dalla palette conserva in silenzio il colore che
      // aveva in base-layers.json: `ricsport` copriva il 35% di una tile a
      // z14 col colore sbagliato e la mappa risultava 13 punti troppo scura.
      const scoperte = [];
      for (let k = 2; k < m.length - 1; k += 2)
        if (!pal[chiave(m[k])]) scoperte.push(m[k]);
      if (scoperte.length)
        avvisi.push(`${id}: classi non nella palette '${setName}': ${scoperte.join(', ')}`);
    }
  }

  /**
   * L'ombreggiatura NON e' un layer dello stile.
   *
   * `hillshade` dello Style Spec, in OpenLayers, non e' regolabile:
   * `hillshade-exaggeration` viene ignorato e l'alpha dei colori sposta la
   * luminosita' di appena due punti, mentre l'ombra ne costa diciotto. Il
   * rilievo viene quindi calcolato dal client con `ol/layer/WebGLTile` sui
   * canali del DEM, dove si puo' comporre in `multiply` con l'opacita' del
   * riferimento — cioe' riprodurne il comportamento invece di approssimarlo.
   * I parametri viaggiano in `metadata['wm:hillshade']`, cosi' restano nel
   * profilo e sono disponibili anche a map-core.
   *
   * (blocco conservato per i vecchi profili che ancora dichiarano il layer)
   *
   * I set vanno cercati su TUTTO l'intervallo, non sul primo livello: il
   * layer e' visibile da z7 dove il profilo non assegna alcun set, e leggere
   * solo `levels[zmin]` faceva saltare l'intero blocco — il paint restava
   * quello di base-layers.json e il profilo non aveva effetto, cosa che
   * rendeva la taratura cieca (valori diversi, misure identiche).
   */
  const stops = [];
  let setUsato = null;
  if (l.type === 'hillshade') {
    for (let z = zmin; z <= zmax; z++) {
      const nome = prof.levels[String(z)].shade;
      const v = prof.shadeSets[nome]?.exaggeration;
      if (v === undefined) continue;
      setUsato ??= nome;
      if (!stops.length || stops.at(-1)[1] !== v) stops.push([z, v]);
    }
  }
  if (stops.length) {
    const s = prof.shadeSets[prof.levels[String(stops.at(-1)[0])].shade];
    out.paint = {...l.paint};
    out.paint['hillshade-exaggeration'] = stops.length > 1
      ? ['step', ['zoom'], stops[0][1], ...stops.slice(1).flatMap(([z, v]) => [z, v])]
      : stops[0][1];
    out.paint['hillshade-shadow-color'] = s.shadow;
    out.paint['hillshade-highlight-color'] = s.highlight;
    out.paint['hillshade-accent-color'] = s.accent;
  } else if (l.type === 'hillshade') {
    avvisi.push(`${id}: nessun set di ombreggiatura assegnato in z${zmin}-${zmax}`);
  }
  layers.push(out);
  });
  if (iv.length > 1)
    avvisi.push(`${id}: visibile a tratti ${iv.map(([a, b]) => `z${a}-${b}`).join(', ')} → ${iv.length} layer`);
}

const style = {...base, layers};
delete style.sources_comment;

// Parametri dell'ombreggiatura calcolata: un intervallo per fascia, con i
// valori del set assegnato a quei livelli.
const fasce = [];
for (let z = Z0; z <= Z1; z++) {
  const nome = prof.levels[String(z)].shade;
  if (!nome || !prof.shadeSets[nome]) continue;
  const ultimo = fasce.at(-1);
  if (ultimo && ultimo.set === nome) ultimo.zmax = z;
  else fasce.push({set: nome, zmin: z, zmax: z, ...prof.shadeSets[nome]});
}
style.metadata = {...(base.metadata ?? {}), 'wm:hillshade': {
  source: 'terrain',
  nota: "Ombreggiatura calcolata dal client su WebGLTile e composta in multiply: "
      + "il layer `hillshade` dello Style Spec non e' regolabile in OpenLayers. "
      + "Il layer va inserito sopra le superfici e sotto le curve di livello.",
  fasce,
}};
writeFileSync(OUT, JSON.stringify(style, null, 2));
console.log(`  ${OUT}: ${layers.length} layer`);
for (const a of avvisi) console.log(`  ⚠ ${a}`);
