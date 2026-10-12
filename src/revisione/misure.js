/**
 * Le misure di una tile: colore per classe sotto le nostre maschere, e il
 * RESIDUO, cioe' cio' che diverge e che nessuna nostra geometria spiega.
 *
 * Ogni pixel appartiene al layer piu' in alto che lo copre (l'ordine delle
 * maschere e' quello dello stile): il riempimento di una strada prende il
 * centro, il bordo i margini. Le zone etichetta sono escluse: un nome sopra
 * un bosco non deve spostare il colore del bosco. Mediana per canale, come
 * colore-per-classe.
 *
 * Linee e cerchi si misurano sull'INCHIOSTRO: il quarto dei pixel della
 * maschera piu' lontano dal colore dell'anello che la circonda, lato per
 * lato. Una curva di livello e' larga 1 px e la sua maschera almeno 2: la
 * mediana semplice cade sul fondo da entrambe le parti, e una curva mancante
 * risultava uno scarto di 3,8 (collaudo con --senza contour).
 */

export const SOGLIE = {
  // scarto di colore oltre cui un pixel "diverge": sopra le differenze
  // d'ombra fra i due lati (fino a ~15), sotto quelle fra due oggetti diversi
  divergenza: 30,
  // una regione di residuo piu' piccola e' rumore di antialias
  regioneMin: 25,
  // pixel propri minimi perche' una classe conti in una tile
  pixelClasse: 40,
  // pixel minimi della zona di un layer symbol perche' conti in una tile
  pixelZona: 200,
  // scarto dal colore tipico della zona oltre cui un pixel e' inchiostro:
  // testo e icone, non ombra
  inchiostro: 30,
  // dilatazione delle maschere prima di calcolare il residuo: una linea
  // larga 2 px da noi e 3 da TGen non e' una mancanza
  dilatazione: 2,
  // larghezza dell'anello attorno a una linea, da cui si legge il fondo
  anello: 3,
  // da questa larghezza una linea si misura con la mediana: e' abbastanza
  // larga da riempire la maschera, e il nome scritto sopra resta minoranza
  lineaLarga: 3,
  // dettaglio: luminosita' meno la media locale (finestra 2r+1). TGen ha un
  // dettaglio netto dove il locale e' liscio: una linea, un testo, un'icona
  // che solo TGen disegna. L'ombra e' morbida e qui sparisce; la soglia di
  // colore da sola non vedeva le piste (tono a ~20 dal fondo, tratti di 3 px)
  dettaglioRaggio: 3,
  dettaglioTgen: 10,
  dettaglioLocale: 5,
  // sovrapposizione (intersezione / unione) oltre cui due zone sono la stessa
  gemelle: 0.7,
  // i tratti di una linea tratteggiata si uniscono prima di cercare le regioni
  unione: 2,
  // scarto oltre cui una superficie, in questa tile, e' sbagliata: i pixel
  // che divergono sopra di essa sono suoi, non residuo
  superficieSbagliata: 8,
};

export function lab([r, g, b]) {
  const lin = c => { c /= 255; return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

export function deltaE(c1, c2) {
  const [a, b] = [lab(c1), lab(c2)];
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export const quantizza = c => '#' + c.map(v => (Math.floor(v / 32) * 32 + 16).toString(16).padStart(2, '0')).join('');

export function regioni(bin) {
  const visto = new Uint8Array(bin.length), out = [];
  for (let i0 = 0; i0 < bin.length; i0++) {
    if (!bin[i0] || visto[i0]) continue;
    const pixel = [], pila = [i0];
    visto[i0] = 1;
    let [x0, y0, x1, y1] = [256, 256, -1, -1];
    while (pila.length) {
      const i = pila.pop(), x = i % 256, y = (i / 256) | 0;
      pixel.push(i);
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      for (const j of [x > 0 ? i - 1 : -1, x < 255 ? i + 1 : -1, y > 0 ? i - 256 : -1, y < 255 ? i + 256 : -1]) {
        if (j >= 0 && bin[j] && !visto[j]) { visto[j] = 1; pila.push(j); }
      }
    }
    out.push({n: pixel.length, bbox: [x0, y0, x1, y1], pixel});
  }
  return out;
}

function dilata(m, r) {
  if (!r) return m;
  const out = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) {
    if (!m[i]) continue;
    const x = i % 256, y = (i / 256) | 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < 256 && yy < 256) out[yy * 256 + xx] = 1;
    }
  }
  return out;
}

const px = (buf, i) => [buf[3 * i], buf[3 * i + 1], buf[3 * i + 2]];

/** Luminosita' meno la media della finestra (2r+1)^2: il dettaglio fine. */
function dettaglio(buf, r) {
  const N = 256, Y = new Float64Array(N * N);
  for (let i = 0; i < N * N; i++) Y[i] = 0.299 * buf[3 * i] + 0.587 * buf[3 * i + 1] + 0.114 * buf[3 * i + 2];
  const I = new Float64Array((N + 1) * (N + 1)); // immagine integrale
  for (let y = 0; y < N; y++) {
    let riga = 0;
    for (let x = 0; x < N; x++) { riga += Y[y * N + x]; I[(y + 1) * (N + 1) + x + 1] = I[y * (N + 1) + x + 1] + riga; }
  }
  const out = new Float64Array(N * N);
  for (let y = 0; y < N; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(N, y + r + 1);
    for (let x = 0; x < N; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(N, x + r + 1);
      const somma = I[y1 * (N + 1) + x1] - I[y0 * (N + 1) + x1] - I[y1 * (N + 1) + x0] + I[y0 * (N + 1) + x0];
      out[y * N + x] = Y[y * N + x] - somma / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}
const mediana = arr => [0, 1, 2].map(k => arr.map(c => c[k]).sort((a, b) => a - b)[arr.length >> 1]);

/** Il quarto dei pixel piu' lontano dal fondo, e la sua mediana. */
function inchiostro(pixel, fondo) {
  const d = pixel.map(c => [deltaE(c, fondo), c]).sort((a, b) => b[0] - a[0]);
  return mediana(d.slice(0, Math.max(10, d.length >> 2)).map(q => q[1]));
}

export function misuraTile({tgen, locale, maschere, etichette, etichettePunti = etichette, zone = []}) {
  const N = 256 * 256;
  const copertura = new Uint8Array(N);
  const proprietario = new Int16Array(N).fill(-1);
  for (const [k, m] of maschere.entries()) {
    if (m.tipo === 'sfondo') continue;
    for (let i = 0; i < N; i++) if (m.data[i]) { copertura[i]++; proprietario[i] = k; }
  }
  const diverge = new Uint8Array(N);
  for (let i = 0; i < N; i++) diverge[i] = deltaE(px(tgen, i), px(locale, i)) > SOGLIE.divergenza ? 1 : 0;

  const classi = {};
  for (const [k, m] of maschere.entries()) {
    const t = [], l = [];
    let nMask = 0, nDiv = 0;
    const lineare = m.tipo === 'line' || m.tipo === 'circle';
    const fuori = lineare ? etichettePunti : etichette;
    for (let i = 0; i < N; i++) {
      if (!m.data[i]) continue;
      if (m.tipo !== 'sfondo') { nMask++; nDiv += diverge[i]; }
      const suo = m.tipo === 'sfondo' ? proprietario[i] === -1 : proprietario[i] === k;
      if (!suo || fuori[i]) continue;
      t.push(px(tgen, i)); l.push(px(locale, i));
    }
    if (t.length < SOGLIE.pixelClasse) continue;
    let mt = mediana(t), ml = mediana(l);
    if (lineare && !(m.larghezza >= SOGLIE.lineaLarga)) {
      const giro = dilata(m.data, SOGLIE.anello), ft = [], fl = [];
      for (let i = 0; i < N; i++) if (giro[i] && !m.data[i] && !fuori[i]) { ft.push(px(tgen, i)); fl.push(px(locale, i)); }
      if (ft.length >= 10) { mt = inchiostro(t, mediana(ft)); ml = inchiostro(l, mediana(fl)); }
    }
    classi[m.id] = {n: t.length, tgen: mt, locale: ml, dE: deltaE(mt, ml), presenza: nMask ? nDiv / nMask : 0};
  }

  // il residuo: diverge, e niente lo spiega. Lo spiegano le linee e i cerchi
  // (dilatati), le zone etichetta, e le superfici sbagliate in questa tile.
  // Una superficie giusta non spiega niente: senza questa regola uso suolo e
  // acqua, che coprono tutta la tile, nascondevano ogni oggetto disegnato
  // solo da TGen (review 1: zero residui su 193 tile)
  const linee = new Uint8Array(N);
  for (const m of maschere) if (m.tipo === 'line' || m.tipo === 'circle') for (let i = 0; i < N; i++) linee[i] |= m.data[i];
  const spiegato = dilata(linee, SOGLIE.dilatazione);
  const sbagliata = id => !classi[id] || classi[id].dE > SOGLIE.superficieSbagliata;
  const sfondo = maschere.find(m => m.tipo === 'sfondo');
  for (let i = 0; i < N; i++) {
    const k = proprietario[i];
    const m = k >= 0 ? maschere[k] : sfondo;
    if (m && m.tipo !== 'line' && m.tipo !== 'circle' && sbagliata(m.id)) spiegato[i] = 1;
  }
  const dT = dettaglio(tgen, SOGLIE.dettaglioRaggio), dL = dettaglio(locale, SOGLIE.dettaglioRaggio);
  const bin = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    // il pixel stesso deve differire: attorno a un oggetto scuro anche il
    // fondo ha dettaglio (la media locale scende), ma e' uguale nei due lati
    const soloTgen = Math.abs(dT[i]) >= SOGLIE.dettaglioTgen && Math.abs(dL[i]) < SOGLIE.dettaglioLocale
      && Math.abs(dT[i] - dL[i]) >= SOGLIE.dettaglioTgen && deltaE(px(tgen, i), px(locale, i)) >= SOGLIE.dettaglioTgen;
    bin[i] = (diverge[i] || soloTgen) && !spiegato[i] && !etichette[i] ? 1 : 0;
  }
  // le regioni si cercano sul residuo dilatato, cosi' i tratti di una linea
  // tratteggiata fanno una regione sola; pixel e colore restano quelli veri
  const residuo = regioni(dilata(bin, SOGLIE.unione))
    .map(r => ({r, veri: r.pixel.filter(i => bin[i])}))
    .filter(({veri}) => veri.length >= SOGLIE.regioneMin)
    .map(({veri}) => {
      const xs = veri.map(i => i % 256), ys = veri.map(i => (i / 256) | 0);
      const bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      return {colore: quantizza(mediana(veri.map(i => px(tgen, i)))), n: veri.length, bbox};
    });
  // simboli: la quota di inchiostro nella zona di ogni layer symbol, lato per
  // lato. Non dice dove sta l'etichetta, dice se c'e'
  // Solo i pixel della zona che nessun'altra zona copre: dove due si
  // sovrappongono l'inchiostro non si sa di chi sia. Tranne le zone
  // GEMELLE (quasi coincidenti: l'icona e il nome della stessa cima), che si
  // escluderebbero a vicenda e sparirebbero dalla misura.
  const simboli = {};
  const area = zone.map(z => z.data.reduce((a, v) => a + v, 0));
  const gemelle = (a, b) => {
    let comune = 0;
    for (let i = 0; i < N; i++) comune += zone[a].data[i] & zone[b].data[i];
    return comune / (area[a] + area[b] - comune) > SOGLIE.gemelle;
  };
  for (const [k, z] of zone.entries()) {
    const altre = zone.filter((_, j) => j !== k && !gemelle(k, j));
    const t = [], l = [];
    for (let i = 0; i < N; i++) {
      if (!z.data[i] || altre.some(o => o.data[i])) continue;
      t.push(px(tgen, i)); l.push(px(locale, i));
    }
    if (t.length < SOGLIE.pixelZona) continue;
    const quota = arr => { const f = mediana(arr); return arr.filter(c => deltaE(c, f) > SOGLIE.inchiostro).length / arr.length; };
    simboli[z.id] = {n: t.length, tgen: quota(t), locale: quota(l)};
  }
  return {classi, residuo, simboli};
}
