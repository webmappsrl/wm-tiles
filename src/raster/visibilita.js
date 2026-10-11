/**
 * A quali livelli lo stile disegna ogni archivio.
 *
 * Serve al confronto fra versioni: una tile cambiata conta solo dove l'archivio
 * e' disegnato. Senza questo limite le strade dei livelli bassi (roadslz,
 * disegnate fino a z11) propagavano ogni modifica fino a z16, e 70 tile
 * cambiate diventavano 101.119 PNG da rifare: su tutta l'Italia ogni
 * aggiornamento avrebbe rifatto quasi tutto.
 *
 * La fonte e' `zoom-profile.json`, che per ogni livello elenca i layer
 * visibili con le soglie NOMINALI (style/webmapp.json ha le soglie gia'
 * sfasate di uno per ol-mapbox-style). Il profilo copre z7-z16: sotto il
 * primo livello e oltre l'ultimo vale il livello estremo, come per lo stile
 * (CLAUDE.md, "Il riferimento raster arriva a z16").
 */

// L'archivio `osm` e' servito come sorgente `openmaptiles`; gli altri hanno
// lo stesso nome.
const SORGENTE = {osm: 'openmaptiles'};

export function livelliArchivi(stile, profilo) {
  const sorgenteDi = new Map(stile.layers.filter(l => l.source).map(l => [l.id, l.source]));
  const [primo, ultimo] = profilo.zoomRange;
  const vis = new Map();
  for (const [z, livello] of Object.entries(profilo.levels)) {
    for (const id of livello.visible ?? []) {
      const s = sorgenteDi.get(id);
      if (!s) continue;
      const v = vis.get(s) ?? {zmin: Infinity, zmax: -Infinity};
      v.zmin = Math.min(v.zmin, Number(z));
      v.zmax = Math.max(v.zmax, Number(z));
      vis.set(s, v);
    }
  }
  for (const v of vis.values()) {
    if (v.zmin <= primo) v.zmin = 0;
    if (v.zmax >= ultimo) v.zmax = Infinity;
  }
  /** I livelli dell'archivio, o `null` se lo stile non lo disegna. */
  return archivio => vis.get(SORGENTE[archivio] ?? archivio) ?? null;
}
