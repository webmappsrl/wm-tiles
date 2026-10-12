/**
 * Da molte tile a poche difformita'. Lo stile e' sistematico, il contenuto
 * sparso: uno scarto che si ripete sulla maggioranza delle tile in cui un
 * layer compare e' stile; uno su una tile sola e' probabilmente OSM cambiato,
 * e resta nella tabella senza diventare una difformita'.
 */

export const CRITERI = {
  dE: 8,              // scarto di classe oltre cui una tile "non torna"
  presenza: 0.6,      // quota di pixel della maschera che divergono
  maggioranza: 0.5,   // quota delle tile del layer che deve non tornare
  tileMin: 3,         // sotto, nessuna conclusione sistematica
  residuo: 0.1,       // quota delle tile del livello con lo stesso colore di residuo
  regressione: 3,     // peggioramento di dE fra due giri
  regressioneRapporto: Math.log(1.5), // allontanamento del rapporto dei simboli da 1, in scala log
  regressionePresenza: 0.2,
  // simboli: rapporto fra l'inchiostro locale e quello di TGen nella zona di
  // un layer symbol; fuori da [1/2, 2] il layer scrive troppo o troppo poco
  rapporto: 2,
  inchiostroMin: 0.002, // sotto, in entrambi i lati la zona e' vuota: la tile non conta
  esempi: 3,
};

const med = a => [...a].sort((x, y) => x - y)[a.length >> 1];
const medRgb = a => [0, 1, 2].map(k => med(a.map(c => c[k])));

export function aggrega(risultati) {
  const tabella = {}, difformita = [];
  const perZ = new Map();
  for (const r of risultati) {
    if (!perZ.has(r.z)) perZ.set(r.z, []);
    perZ.get(r.z).push(r);
  }
  for (const [z, rs] of [...perZ].sort((a, b) => a[0] - b[0])) {
    tabella[z] = {};
    const layer = new Set(rs.flatMap(r => Object.keys(r.classi)));
    for (const id of [...layer].sort()) {
      const casi = rs.filter(r => r.classi[id]).map(r => ({tile: r.tile, ...r.classi[id]}));
      const fuoriDE = casi.filter(q => q.dE > CRITERI.dE);
      const fuoriP = casi.filter(q => q.presenza > CRITERI.presenza);
      const sistematico = f => casi.length >= CRITERI.tileMin && f.length / casi.length > CRITERI.maggioranza;
      const esito = sistematico(fuoriDE) ? 'stile' : sistematico(fuoriP) ? 'presenza'
        : fuoriDE.length || fuoriP.length ? 'sparso' : 'conforme';
      const riga = {dE: med(casi.map(q => q.dE)), presenza: med(casi.map(q => q.presenza)), nTile: casi.length, esito};
      tabella[z][id] = riga;
      if (esito === 'stile' || esito === 'presenza') {
        const chiave = esito === 'stile' ? 'dE' : 'presenza';
        const fuori = esito === 'stile' ? fuoriDE : fuoriP;
        difformita.push({
          id: `z${z}:${id}:${esito}`, z, tipo: esito, layer: id,
          misure: {dE: riga.dE, presenza: riga.presenza, diffusione: fuori.length / casi.length, nTile: casi.length,
            tgen: medRgb(casi.map(q => q.tgen)), locale: medRgb(casi.map(q => q.locale))},
          esempi: [...fuori].sort((a, b) => b[chiave] - a[chiave]).slice(0, CRITERI.esempi).map(q => ({tile: q.tile})),
        });
      }
    }
    const simboli = new Set(rs.flatMap(r => Object.keys(r.simboli ?? {})));
    for (const id of [...simboli].sort()) {
      const casi = rs.filter(r => r.simboli?.[id] && Math.max(r.simboli[id].tgen, r.simboli[id].locale) > CRITERI.inchiostroMin)
        .map(r => ({tile: r.tile, ...r.simboli[id], r: (r.simboli[id].locale + CRITERI.inchiostroMin) / (r.simboli[id].tgen + CRITERI.inchiostroMin)}));
      if (!casi.length) continue;
      const fuori = casi.filter(q => q.r > CRITERI.rapporto || q.r < 1 / CRITERI.rapporto);
      const sistematico = casi.length >= CRITERI.tileMin && fuori.length / casi.length > CRITERI.maggioranza;
      const rapporto = med(casi.map(q => q.locale)) / Math.max(1e-6, med(casi.map(q => q.tgen)));
      tabella[z][id] = {rapporto, nTile: casi.length, esito: sistematico ? 'simboli' : fuori.length ? 'sparso' : 'conforme'};
      if (!sistematico) continue;
      difformita.push({
        id: `z${z}:${id}:simboli`, z, tipo: 'simboli', layer: id,
        misure: {rapporto, diffusione: fuori.length / casi.length, nTile: casi.length},
        // gli esempi piu' lontani da 1, nei due versi
        esempi: [...fuori].sort((a, b) => Math.abs(Math.log(b.r)) - Math.abs(Math.log(a.r))).slice(0, CRITERI.esempi).map(q => ({tile: q.tile})),
      });
    }
    const perColore = new Map();
    for (const r of rs) for (const q of r.residuo) {
      if (!perColore.has(q.colore)) perColore.set(q.colore, []);
      perColore.get(q.colore).push({tile: r.tile, ...q});
    }
    for (const [colore, casi] of [...perColore].sort()) {
      const tileDistinte = new Set(casi.map(q => q.tile)).size;
      if (tileDistinte < CRITERI.tileMin || tileDistinte / rs.length <= CRITERI.residuo) continue;
      difformita.push({
        id: `z${z}:residuo:${colore}`, z, tipo: 'residuo', colore,
        misure: {diffusione: tileDistinte / rs.length, nTile: rs.length, pixel: casi.reduce((s, q) => s + q.n, 0)},
        // la regione piu' grande di ogni tile, una tile per esempio
        esempi: [...casi].sort((a, b) => b.n - a.n).filter((q, i, a) => a.findIndex(o => o.tile === q.tile) === i)
          .slice(0, CRITERI.esempi).map(q => ({tile: q.tile, bbox: q.bbox})),
      });
    }
  }
  return {tabella, difformita};
}

/**
 * Cosa e' peggiorato rispetto al giro prima: dE, presenza, rapporto dei
 * simboli che si allontana da 1, e i layer che c'erano e non ci sono piu' (un
 * layer tolto per errore dal profilo non da' nessun altro segnale).
 */
export function regressioni(tabella, prima) {
  const out = [];
  const lontananza = r => Math.abs(Math.log(Math.max(1e-6, r)));
  for (const [z, layer] of Object.entries(prima ?? {})) {
    for (const [id, p] of Object.entries(layer)) {
      const riga = tabella[z]?.[id];
      if (!tabella[z]) continue; // livello non misurato in questo giro
      if (!riga) {
        out.push({id: `z${z}:${id}:sparito`, z: Number(z), tipo: 'regressione', layer: id, misure: {nTilePrima: p.nTile}, esempi: []});
        continue;
      }
      const peggio = (riga.dE != null && p.dE != null && riga.dE - p.dE > CRITERI.regressione)
        || (riga.presenza != null && p.presenza != null && riga.presenza - p.presenza > CRITERI.regressionePresenza)
        || (riga.rapporto != null && p.rapporto != null
          && lontananza(riga.rapporto) - lontananza(p.rapporto) > CRITERI.regressioneRapporto);
      if (!peggio) continue;
      out.push({
        id: `z${z}:${id}:regressione`, z: Number(z), tipo: 'regressione', layer: id,
        misure: {dE: riga.dE, dEPrima: p.dE, presenza: riga.presenza, presenzaPrima: p.presenza,
          rapporto: riga.rapporto, rapportoPrima: p.rapporto, nTile: riga.nTile},
        esempi: [],
      });
    }
  }
  return out;
}
