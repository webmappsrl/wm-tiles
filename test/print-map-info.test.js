import {describe, expect, it} from 'vitest';
import sharp from 'sharp';
import {drawMapInfo, mapInfoFields, niceBarLength} from '../src/print/map-info.js';

const base = {zoom: 15, center: [10.72, 44], dpi: 300};

describe('mapInfoFields', () => {
  it('la scala si ricava da zoom e latitudine, con un conto fatto a parte', () => {
    // 156543.034 * cos(44 gradi) / 2^15 = 3,4364 m/px; x 300 / 0,0254 = 40.588,7 -> 40.589
    expect(mapInfoFields(base).scale).toBe('1:40589');
  });
  it('a latitudine maggiore la scala si stringe', () => {
    // 156543.034 * cos(60) / 2^14 = 4,7775 m/px -> x 300 / 0,0254 = 56.425
    expect(mapInfoFields({zoom: 14, center: [10, 60], dpi: 300}).scale).toBe('1:56425');
  });
  it('l\'attribuzione cita OpenStreetMap e Webmapp', () => {
    expect(mapInfoFields(base).attribution).toBe('© OpenStreetMap · © Webmapp');
  });
  it('restituisce anche il dpi', () => {
    expect(mapInfoFields(base).dpi).toBe(300);
  });
});

// R17: un ingresso non valido deve fermare la pagina, non produrne una a cui
// manca la scala. R11: il messaggio nomina il campo e non il suo contenuto.
describe('validazione degli ingressi', () => {
  const invalidi = [
    ['zoom non numerico', {...base, zoom: NaN}, /zoom/],
    ['zoom mancante', {center: base.center, dpi: 300}, /zoom/],
    ['dpi mancante', {zoom: 15, center: base.center}, /dpi/],
    ['dpi nullo', {...base, dpi: 0}, /dpi/],
    ['center mancante', {zoom: 15, dpi: 300}, /center/],
    ['center di un solo numero', {...base, center: [10]}, /center/],
    ['center non numerico', {...base, center: [10, 'quarantaquattro']}, /latitudine/],
    ['latitudine oltre i limiti di Web Mercator', {...base, center: [10, 90]}, /latitudine/],
    ['longitudine fuori dal mondo', {...base, center: [200, 44]}, /longitudine/],
  ];
  for (const [nome, opzioni, atteso] of invalidi) {
    it(`mapInfoFields rifiuta: ${nome}`, () => {
      expect(() => mapInfoFields(opzioni)).toThrow(atteso);
    });
    it(`drawMapInfo rifiuta: ${nome}`, async () => {
      const rgb = Buffer.alloc(10 * 10 * 3, 40);
      await expect(drawMapInfo(rgb, {width: 10, height: 10, ...opzioni})).rejects.toThrow(atteso);
    });
  }
  it('il messaggio non contiene le coordinate ricevute', () => {
    try {
      mapInfoFields({...base, center: [12.3456, 89.7654]});
      throw new Error('doveva sollevare');
    } catch (e) {
      expect(e.message).not.toMatch(/12\.3456|89\.7654/);
      expect(e.message).toMatch(/latitudine/);
    }
  });
  it('drawMapInfo rifiuta una pagina senza dimensioni', async () => {
    const rgb = Buffer.alloc(10 * 10 * 3, 40);
    await expect(drawMapInfo(rgb, {width: 0, height: 10, ...base})).rejects.toThrow(/width/);
    await expect(drawMapInfo(rgb, {width: 10, height: NaN, ...base})).rejects.toThrow(/height/);
  });
});

describe('niceBarLength', () => {
  it('sceglie una lunghezza rotonda che sta nello spazio', () => {
    // 3,4364 m/px, 1000 px liberi = 3436 m -> 2 km
    expect(niceBarLength(3.4364, 1000).meters).toBe(2000);
    // 2500 px = 8591 m -> 5 km
    expect(niceBarLength(3.4364, 2500).meters).toBe(5000);
    // 200 px = 687 m -> 500 m
    expect(niceBarLength(3.4364, 200).meters).toBe(500);
  });
  it('la lunghezza in pixel e\' coerente con i metri', () => {
    const {meters, px} = niceBarLength(3.4364, 1000);
    expect(px).toBeCloseTo(meters / 3.4364, 6);
  });
});

/**
 * Misure sull'immagine resa. L'inchiostro e' `#1a1a1a` (26), il fondo della
 * fixture e' 40 e i riquadri del corredo sono bianco all'80% su quel fondo
 * (212): la soglia 33 separa l'inchiostro da tutto il resto.
 */
const INK_MAX = 33;
const BACKGROUND_VALUE = 40;

async function pixels(png) {
  const {data, info} = await sharp(png).removeAlpha().raw().toBuffer({resolveWithObject: true});
  return {
    width: info.width,
    height: info.height,
    at: (x, y) => data[(y * info.width + x) * info.channels],
  };
}

/** Estensione orizzontale dell'inchiostro su una riga, dentro [x0, x1). */
function inkSpan({at}, y, x0, x1) {
  let first = -1, last = -1, run = 0, bestRun = 0;
  for (let x = x0; x < x1; x++) {
    if (at(x, y) < INK_MAX) {
      if (first < 0) first = x;
      last = x;
      if (++run > bestRun) bestRun = run;
    } else run = 0;
  }
  return {first, last, width: first < 0 ? 0 : last - first + 1, bestRun};
}

/** Componenti connesse (4-vicini) dei pixel diversi dal fondo uniforme. */
function components({width, height, at}) {
  const seen = new Uint8Array(width * height);
  const found = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (seen[i] || at(x, y) === BACKGROUND_VALUE) continue;
    const stack = [i];
    seen[i] = 1;
    let size = 0, x0 = x, x1 = x, y0 = y, y1 = y;
    while (stack.length) {
      const p = stack.pop(), px = p % width, py = (p - px) / width;
      size++;
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const q = ny * width + nx;
        if (!seen[q] && at(nx, ny) !== BACKGROUND_VALUE) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    found.push({size, x0, x1, y0, y1});
  }
  return found.filter(c => c.size > 20);
}

describe('drawMapInfo', () => {
  const w = 600, h = 800;
  const rgb = Buffer.alloc(w * h * 3, BACKGROUND_VALUE); // fondo scuro uniforme
  const attributions = ['© OpenStreetMap', '© Webmapp'];
  const opzioni = {width: w, height: h, ...base, attributions};

  // Le costanti di impaginazione del modulo, ricopiate qui per sapere DOVE
  // guardare. Non sono cio' che si verifica: la barra si misura contro i metri
  // che l'etichetta dichiara, non contro il conto interno.
  const mm = base.dpi / 25.4;
  const margin = 4 * mm, pad = 1.5 * mm, digit = 3 * mm, thick = 1.6 * mm;
  const panelH = pad * 2 + thick + digit * 1.3;
  const py0 = h - margin - panelH;

  it('restituisce un PNG delle stesse dimensioni', async () => {
    const png = await drawMapInfo(rgb, opzioni);
    const m = await sharp(png).metadata();
    expect([m.format, m.width, m.height]).toEqual(['png', w, h]);
  });

  it('disegna qualcosa in basso e in alto a destra, lascia intatto il centro', async () => {
    const png = await drawMapInfo(rgb, opzioni);
    const img = await pixels(png);
    expect(img.at(w / 2, h / 2)).toBe(BACKGROUND_VALUE);
    expect(img.at(Math.round(w - 60), 60)).toBeGreaterThan(100);   // pannello del nord
    expect(img.at(60, h - 52)).toBeGreaterThan(100);               // pannello in basso
  });

  it('la barra disegnata e\' lunga quanto i metri che dichiara', async () => {
    // A z15, lat 44: 3,43651 m/px; un quarto di 600 px sono 150 px = 515 m,
    // quindi la barra dichiara 500 m, cioe' 145,5 px. Il conto e' fatto qui,
    // senza passare dal modulo.
    const mpp = 156543.03392804097 * Math.cos(44 * Math.PI / 180) / 2 ** 15;
    const attesi = 500 / mpp;
    const png = await drawMapInfo(rgb, opzioni);
    const img = await pixels(png);
    // la riga della barra e' quella col tratto d'inchiostro contiguo piu' lungo:
    // nessun glifo delle etichette ha una corsa orizzontale paragonabile
    let riga = -1, meglio = 0;
    for (let y = Math.round(py0); y < h; y++) {
      const s = inkSpan(img, y, 0, w);
      if (s.bestRun > meglio) {
        meglio = s.bestRun;
        riga = y;
      }
    }
    const s = inkSpan(img, riga, 0, w);
    expect(s.width).toBeGreaterThan(attesi - 4);
    expect(s.width).toBeLessThan(attesi + 4);
  });

  it('l\'ultima etichetta della barra di scala sta dentro il suo riquadro', async () => {
    // Le etichette della barra sono in NERETTO (`font-weight="bold"`), e DejaVu
    // Sans Bold arriva a 0,6955 em per carattere sulle stringhe corte di cifre
    // contro i 0,563 del chiaro: con un fattore unico di 0,62 la larghezza
    // dell'ultima etichetta era sottostimata e il riquadro, che su quella meta'
    // etichetta e' dimensionato, restava corto. Il `pad` lo copriva per fortuna,
    // non per progetto (review del Task 10). Qui si misura la containment, che
    // e' cio' che si vede sulla pagina.
    const png = await drawMapInfo(rgb, opzioni);
    const img = await pixels(png);
    // il riquadro della barra: la componente in basso a SINISTRA
    const riquadro = components(img)
      .filter(c => c.y1 > h - margin - 2 && c.x0 < margin + 2)
      .sort((a, b) => b.size - a.size)[0];
    expect(riquadro).toBeTruthy();
    // l'inchiostro piu' a destra nelle righe del riquadro: e' l'ultima etichetta
    let ix1 = -1;
    for (let y = riquadro.y0; y <= riquadro.y1; y++) {
      const s = inkSpan(img, y, riquadro.x0, riquadro.x1 + 1);
      if (s.last > ix1) ix1 = s.last;
    }
    expect(ix1).toBeGreaterThan(0);
    // Il margine fra l'inchiostro e il bordo del riquadro non dev'essere MENO
    // del `pad` dichiarato: se lo e', il riquadro e' stato dimensionato su una
    // stima della larghezza piu' stretta del testo vero.
    // Misure di questo stesso conto (300 dpi, 17,7 px = 1,5 mm di pad):
    //   - nel container (DejaVu Sans Bold), fattore 0,70: 1,86 mm — passa
    //   - nel container, fattore 0,62 (il difetto): 1,27 mm — FALLISCE
    //   - sul Mac (Helvetica, piu' stretto), fattore 0,70: 2,79 mm — passa
    // Sul Mac il difetto non si vedrebbe: per questo la suite gira anche dentro
    // l'immagine (.github/workflows/print.yml).
    expect(riquadro.x1 - ix1).toBeGreaterThanOrEqual(pad);
  });

  it('le attribuzioni hanno inchiostro in basso a destra e in nessun altro quadrante', async () => {
    const png = await drawMapInfo(rgb, opzioni);
    const img = await pixels(png);
    const inchiostro = (x0, y0, x1, y1) => {
      let n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (img.at(x, y) < INK_MAX) n++;
      return n;
    };
    // il riquadro delle attribuzioni: l'unica componente che tocca il bordo destro
    // nella meta' bassa della pagina
    const riquadro = components(img)
      .filter(c => c.y0 > h / 2 && c.x1 > w * 0.8)
      .sort((a, b) => b.size - a.size)[0];
    expect(riquadro).toBeTruthy();
    // il riquadro e' piu' largo che alto: una riga di testo, non una colonna
    expect(riquadro.x1 - riquadro.x0).toBeGreaterThan((riquadro.y1 - riquadro.y0) * 3);
    // e dentro c'e' davvero il testo
    expect(inchiostro(riquadro.x0, riquadro.y0, riquadro.x1 + 1, riquadro.y1 + 1))
      .toBeGreaterThan(400);
    // fuori dal riquadro, nella sua fascia di righe, non c'e' inchiostro
    expect(inchiostro(0, riquadro.y0, riquadro.x0, riquadro.y1 + 1)).toBe(0);
    expect(inchiostro(riquadro.x1 + 1, riquadro.y0, w, riquadro.y1 + 1)).toBe(0);
  });

  it('il testo delle attribuzioni e\' ancorato al bordo destro del riquadro', async () => {
    // La larghezza e' STIMATA (0,62 em per carattere, misurato su DejaVu Sans
    // nel container): un font ancora piu' largo deborda, e ancorato a destra
    // l'eccedenza cresce verso l'interno della mappa, non fuori pagina. Lo si
    // vede dal margine residuo: a destra resta `pad`, qualunque sia il font.
    const png = await drawMapInfo(rgb, opzioni);
    const img = await pixels(png);
    const riquadro = components(img)
      .filter(c => c.y0 > h / 2 && c.x1 > w * 0.8)
      .sort((a, b) => b.size - a.size)[0];
    let ix0 = Infinity, ix1 = -1;
    for (let y = riquadro.y0; y <= riquadro.y1; y++) {
      const s = inkSpan(img, y, riquadro.x0, riquadro.x1 + 1);
      if (s.first >= 0) {
        if (s.first < ix0) ix0 = s.first;
        if (s.last > ix1) ix1 = s.last;
      }
    }
    const gapDestro = riquadro.x1 - ix1, gapSinistro = ix0 - riquadro.x0;
    expect(gapDestro).toBeGreaterThan(pad - 4);
    expect(gapDestro).toBeLessThan(pad + 6);
    // e il testo sta DENTRO il riquadro: con la stima vecchia (0,52 em) in
    // container usciva di 4,1 mm a sinistra, fuori dallo sfondo che lo rende
    // leggibile sopra la mappa
    expect(gapSinistro).toBeGreaterThanOrEqual(0);
  });

  it('l\'apice della freccia del nord sta sopra la sua base', async () => {
    const png = await drawMapInfo(rgb, opzioni);
    const img = await pixels(png);
    const ns = 9 * mm, nSize = ns * 0.32;
    const nx = Math.round(w - margin - ns);
    // solo le righe sotto la N: li' c'e' la sola freccia
    const y0 = Math.round(margin + nSize * 1.35), y1 = Math.round(margin + ns);
    const righe = [];
    for (let y = y0; y < y1; y++) {
      const s = inkSpan(img, y, nx, w);
      if (s.width > 0) righe.push({y, width: s.width});
    }
    expect(righe.length).toBeGreaterThan(10);
    const apice = righe[0];
    const base_ = righe.reduce((a, b) => (b.width > a.width ? b : a));
    expect(base_.y).toBeGreaterThan(apice.y + (y1 - y0) / 4);
    expect(apice.width * 4).toBeLessThan(base_.width);
  });

  it('i tre riquadri del corredo restano separati anche su una pagina stretta', async () => {
    // 600 px di larghezza bastano a far toccare barra e attribuzioni: devono
    // restare tre componenti distinte (barra, attribuzioni, nord).
    const png = await drawMapInfo(rgb, opzioni);
    const img = await pixels(png);
    expect(components(img).length).toBe(3);
  });

  it('su un A4 a 300 dpi il corredo sta nella pagina', async () => {
    const aw = 2480, ah = 3508;
    const grande = Buffer.alloc(aw * ah * 3, BACKGROUND_VALUE);
    const png = await drawMapInfo(grande, {width: aw, height: ah, ...base, attributions});
    const img = await pixels(png);
    // nessun inchiostro sull'ultima colonna ne' sull'ultima riga: niente tagliato
    for (let y = 0; y < ah; y++) expect(img.at(aw - 1, y)).toBe(BACKGROUND_VALUE);
    for (let x = 0; x < aw; x++) expect(img.at(x, ah - 1)).toBe(BACKGROUND_VALUE);
    expect(components(img).length).toBe(3);
  });
});
