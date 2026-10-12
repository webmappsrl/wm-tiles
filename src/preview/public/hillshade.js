/**
 * Ombreggiatura calcolata sulla GPU e composta in `multiply`.
 *
 * Perche' non il layer `hillshade` dello Style Spec: in OpenLayers non e'
 * regolabile. `hillshade-exaggeration` viene ignorato del tutto (0,3 e 1,4
 * danno immagini identiche) e l'alpha dei colori sposta la luminosita' di due
 * punti su diciotto che l'ombra costa. Il risultato era una fascia z14-z16
 * scura di tredici punti senza alcuna leva per correggerla.
 *
 * Con `ol/layer/WebGLTile` la pendenza si calcola dai canali del DEM, e la
 * composizione in `multiply` si ottiene con `mix-blend-mode` sul canvas del
 * layer: e' esattamente `raster-comp-op: multiply` con `raster-opacity` del
 * riferimento, non una sua approssimazione. L'opacita' cambia per fascia di
 * zoom come nel riferimento (0,2 fino a z10; 0,18 fino a z13; 0,3 oltre).
 *
 * NON si puo' usare `globalCompositeOperation` in `prerender`, che e' la
 * tecnica valida per i layer Canvas: un layer WebGL riceve un contesto WebGL
 * e la chiamata falla con "e.context.save is not a function". OpenLayers
 * rende ogni layer WebGL in un canvas suo, quindi la composizione si governa
 * dal CSS di quell'elemento — da qui `className`.
 *
 * Il calcolo dipende da WebGL, ma la dipendenza c'era gia': anche il layer
 * `hillshade` e' reso sulla GPU. Senza WebGL la mappa resta completa e
 * corretta, solo piatta — verificato con tools/webgl-check.mjs.
 *
 * Questo modulo e' scritto per essere riusato dal connettore map-core: non
 * dipende dalla preview, prende la sorgente e le fasce e restituisce il layer.
 */

/**
 * Differenza di quota fra due pixel, calcolata canale per canale.
 *
 * NON si costruiscono le due quote per poi sottrarle: la codifica Terrarium
 * porta il canale rosso a pesare 65280, e negli shader WebGL1 la precisione
 * disponibile a quell'ordine di grandezza e' molto grossolana. Fra pixel
 * vicini la quota cambia di frazioni di metro, e quella differenza viene
 * quantizzata: l'ombreggiatura mostra un tratteggio fitto e regolare, che
 * sembra un difetto del DEM e non lo e'.
 *
 * Sottraendo prima i canali, i termini restano fra -1 e 1 e il calcolo
 * conserva la precisione. L'offset -32768 si annulla nella differenza.
 */
/**
 * Gradiente con la formula di Horn su finestra 3x3, come `gdaldem`.
 *
 *   dz/dx = ((c + 2f + i) - (a + 2d + g)) / (8 * passo)
 *
 * con a..i i nove vicini. E' l'algoritmo del riferimento, e la ragione per cui
 * l'ombreggiatura di GDAL sullo stesso DEM e' liscia mentre la nostra a due
 * campioni mostrava strisce: la finestra pesata media il rumore e smorza
 * l'aliasing, che con un solo campione per lato resta tutto.
 *
 * Si combinano DIFFERENZE, mai quote: `dQuota` e' esatta anche quando il
 * canale blu avvolge (la differenza canale per canale e' lineare), mentre
 * mediare le quote decodificate — o lasciar interpolare la texture — sbaglia a
 * ogni giro del blu e disegna strisce con il periodo di un metro di dislivello.
 */
const dQuotaHorn = (orizzontale, P = 1) => (orizzontale
  // dz/dx: colonna SINISTRA meno colonna DESTRA
  ? ['+',
      dQuota(-P, -P, P, -P),
      ['*', 2, dQuota(-P, 0, P, 0)],
      dQuota(-P, P, P, P)]
  /**
   * dz/dy: riga SOPRA meno riga SOTTO (`dy` cresce verso il basso).
   *
   * I due segni vanno insieme. Invertirne uno solo SPECCHIA l'esposizione
   * invece di ruotarla, e la correlazione con `gdaldem` crolla senza diventare
   * negativa: sembra un problema di qualita' quando invece e' un segno.
   * Invertirli entrambi ruota di 180 gradi — e' il caso in cui le vette si
   * leggono come valli, senza alcun errore e senza scarti nelle medie.
   * `tools/ombra-vs-gdal.mjs` distingue i due casi.
   */
  : ['+',
      dQuota(-P, -P, -P, P),
      ['*', 2, dQuota(0, -P, 0, P)],
      dQuota(P, -P, P, P)]);

const dQuota = (ax, ay, bx, by) =>
  ['-', ['band', 1, ax, ay], ['band', 1, bx, by]];

/**
 * Grigio dell'incidenza della luce: 1 dove il versante e' illuminato, verso 0
 * dove e' in ombra. Moltiplicato sul disegno sottostante da' il rilievo.
 */
function grigioIncidenza({sunAzimuth = 315}) {
  // il passo di campionamento segue la risoluzione, cosi' la pendenza non
  // dipende dallo zoom e il rilievo non "monta" ingrandendo
  /**
   * Passo di campionamento 2, non 1.
   *
   * Gli offset di `band` sono in TEXEL della texture del DEM. Quando texel e
   * pixel dello schermo non sono allineati — e non lo sono quasi mai — un
   * offset di 1 cade sullo stesso texel per certe colonne e su quello accanto
   * per altre: il campionamento `nearest` (obbligatorio sulle quote
   * codificate) produce allora strisce verticali regolari, ben visibili dove
   * il rilievo e' dolce. Il DEM non c'entra: ombreggiato con `gdaldem` e'
   * pulito. Allargare il passo mette i due campioni sempre su texel distinti.
   */
  // Horn: la somma pesata vale 8 volte il passo (vedi dQuotaHorn)
  /**
   * Il passo e' la risoluzione del DEM, non quella della vista.
   *
   * Gli offset di `band` sono in TEXEL: finche' DEM e schermo sono 1:1 le due
   * risoluzioni coincidono, ma oltre il maxzoom del DEM (z16) un texel copre
   * piu' pixel di vista. Dividendo per `['resolution']` il gradiente cresce
   * come l'ingrandimento, satura e disegna bande nere verticali — a z17 era
   * illeggibile. `passoDem` viene aggiornato in JS dal livello di tile
   * realmente usato.
   */
  const dp = ['*', 8, ['var', 'passoDem']];
  // `vert` e' una VARIABILE di stile, non una costante: cambia per fascia di
  // zoom e il layer si costruisce una volta sola. Scritta come costante,
  // restava quella della prima fascia e la taratura non aveva effetto.
  const vert = ['var', 'vert'];
  const dzdx = ['/', ['*', vert, dQuotaHorn(true)], dp];
  const dzdy = ['/', ['*', vert, dQuotaHorn(false)], dp];

  const pendenza = ['atan', ['^', ['+', ['^', dzdx, 2], ['^', dzdy, 2]], 0.5]];
  const esposizione = ['clamp', ['atan', ['-', 0, dzdy], dzdx], -Math.PI, Math.PI];

  // Profondita' delle ombre, senza toccare le zone illuminate.
  //
  // Il grigio d'incidenza vale 1 dove il versante guarda il sole e scende
  // verso 0 dove e' in ombra. Elevarlo a una potenza > 1 abbassa i valori
  // intermedi e bassi lasciando 1 invariato: le ombre si approfondiscono e le
  // luci restano dove sono. Alzare `vert` invece accentua tutto e scurisce
  // anche i versanti illuminati.
  //
  // L'elevazione del sole e' una VARIABILE di stile (`sinEl`, `cosEl`), come
  // `vert`: cambia per livello. Da z14 TGen schiarisce i pianori e scurisce i
  // versanti ripidi quasi a prescindere dall'esposizione (il suo `#slope10m`),
  // e una luce piu' alta e' cio' che lo riproduce; scritta come costante,
  // restava quella del primo livello per tutta la scala.
  // L'azimut e' GEOGRAFICO (0 = Nord, in senso orario), come in gdaldem e nel
  // riferimento: -az 315 significa luce da Nord-Ovest. L'esposizione qui sopra
  // e' invece un angolo matematico (0 = Est, antiorario), quindi va convertito.
  // Passando 315 direttamente la luce arriva da Sud-Est e il rilievo si legge
  // in negativo: le vette sembrano valli.
  const az = ((90 - sunAzimuth) * Math.PI) / 180;
  const incidenza = [
    '+',
    ['*', ['var', 'sinEl'], ['cos', pendenza]],
    ['*', ['var', 'cosEl'], ['sin', pendenza], ['cos', ['-', az, esposizione]]],
  ];
  // il clamp serve prima della potenza: sui versanti opposti al sole
  // l'incidenza e' negativa e una potenza su un negativo non e' definita
  const luce = ['^', ['clamp', incidenza, 0, 1], ['var', 'gamma']];

  /**
   * Componente di pendenza, indipendente dalla direzione della luce.
   *
   * Il riferimento da z14 somma all'ombreggiatura un secondo strato
   * (`#slope10m`, opacity 0,15, comp-op overlay) che scurisce i versanti
   * ripidi ovunque siano orientati. Senza, il rilievo risulta piatto: a z16
   * la deviazione standard del riferimento e' 30 contro la nostra 19, e la
   * differenza non si recupera con la sola luce radente.
   */
  return ['*', luce, ['-', 1, ['*', ['var', 'slope'], ['sin', pendenza]]]];
}


/**
 * Grigio della sola pendenza, centrato sul neutro.
 *
 * Composto in `overlay`, un valore sopra la meta' SCHIARISCE e sotto
 * SCURISCE: i pianori si alzano e i versanti ripidi si abbassano, e
 * l'escursione dei toni cresce senza spostare la luminosita' media. E' cio'
 * che il riferimento ottiene con `#slope10m` in `comp-op: overlay`.
 */
function grigioPendenza() {
  /**
   * La pendenza si campiona a distanza 2, non 1.
   *
   * L'ombreggiatura usa gia' la derivata prima della quota; comporre sopra
   * anche la pendenza ne amplifica le irregolarita', e il nostro DEM nasce da
   * un dato a 30 m interpolato, quindi quelle irregolarita' ci sono. A
   * distanza 1 il risultato mostra strisce sottili e regolari, ben visibili
   * dove il rilievo e' dolce. Allargare la base di calcolo le toglie senza
   * cambiare la pendenza che si sta misurando: a questa scala e' la stessa.
   */
  /**
   * Il passo e' la risoluzione del DEM, non quella della vista.
   *
   * Gli offset di `band` sono in TEXEL: finche' DEM e schermo sono 1:1 le due
   * risoluzioni coincidono, ma oltre il maxzoom del DEM (z16) un texel copre
   * piu' pixel di vista. Dividendo per `['resolution']` il gradiente cresce
   * come l'ingrandimento, satura e disegna bande nere verticali — a z17 era
   * illeggibile. `passoDem` viene aggiornato in JS dal livello di tile
   * realmente usato.
   */
  /**
   * La pendenza si calcola su una finestra piu' larga della luce.
   *
   * E' il MODULO del gradiente: non avendo la direzionalita' della luce a
   * mascherare le irregolarita', e composta in `overlay` con un peso alto, le
   * amplifica. Con la stessa finestra della luce disegnava strisce diagonali
   * parallele alle curve di livello, ben visibili con i soli layer d'ombra
   * accesi — mentre la luce, da sola, era gia' liscia.
   */
  const P = 3;
  const dp = ['*', 8 * P, ['var', 'passoDem']];
  const vert = ['var', 'vert'];
  const dzdx = ['/', ['*', vert, dQuotaHorn(true, P)], dp];
  const dzdy = ['/', ['*', vert, dQuotaHorn(false, P)], dp];
  const pendenza = ['atan', ['^', ['+', ['^', dzdx, 2], ['^', dzdy, 2]], 0.5]];
  // 0,35 e' la pendenza attorno a cui il contributo si annulla
  return ['clamp', ['+', 0.5, ['*', ['var', 'slope'], ['-', 0.35, ['sin', pendenza]]]], 0, 1];
}

/**
 * @param {object} ol           il namespace OpenLayers
 * @param {object} sourceDef    la sorgente `terrain` dello style.json
 * @param {Array} fasce         metadata['wm:hillshade'].fasce
 * @returns {{layer: object, aggiornaOpacita: (zoom: number) => void}}
 */
/**
 * Sorgente del DEM con le quote GIA' DECODIFICATE, in virgola mobile.
 *
 * Il PNG Terrarium codifica la quota come `R*256 + G + B/256`, e il canale
 * blu avvolge a ogni METRO di dislivello. La GPU pero' interpola le texture,
 * e a ogni giro del blu l'interpolazione produce un valore privo di senso: su
 * un versante regolare quei giri cadono a distanza regolare e disegnano
 * strisce parallele alle curve di livello. Non si puo' nemmeno spegnere
 * l'interpolazione — l'opzione `interpolate` non ha effetto su `WebGLTile`,
 * verificato misurando: acceso o spento, gli stessi numeri.
 *
 * La cura e' decodificare in JS, una volta per tile: nel `Float32Array` che ne
 * esce la quota e' un numero solo, monotono, e interpolarlo e' lecito. Lo
 * shader legge `['band', 1]` e non deve piu' ricomporre nulla.
 */
function sorgenteQuote(ol, sourceDef) {
  const dimensione = sourceDef.tileSize ?? 256;
  const url = sourceDef.tiles[0];
  const tela = document.createElement('canvas');
  tela.width = tela.height = dimensione;
  const ctx2d = tela.getContext('2d', {willReadFrequently: true});

  return new ol.source.DataTile({
    minZoom: sourceDef.minzoom ?? 0,
    maxZoom: sourceDef.maxzoom ?? 14,
    tileSize: dimensione,
    bandCount: 1,
    /**
     * Ora l'interpolazione e' LECITA, ed e' quella che serve in overzoom.
     *
     * Sulla texture RGB non lo era: il canale blu avvolge a ogni metro e
     * interpolarlo produceva strisce. Qui i valori sono quote in virgola
     * mobile, monotone, e mediarne due adiacenti da' una quota sensata. Serve
     * oltre il maxzoom del DEM, dove un texel copre piu' pixel: senza, i suoi
     * bordi diventano un reticolo (a z17 meta' delle righe e delle colonne).
     */
    interpolate: true,
    attributions: sourceDef.attribution,
    loader: (z, x, y) => new Promise(risolvi => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      // fuori copertura il server risponde 404: si restituisce quota 0, cosi'
      // il bordo dell'area generata non diventa un muro nell'ombreggiatura
      img.onerror = () => risolvi(new Float32Array(dimensione * dimensione));
      img.onload = () => {
        ctx2d.clearRect(0, 0, dimensione, dimensione);
        ctx2d.drawImage(img, 0, 0, dimensione, dimensione);
        const px = ctx2d.getImageData(0, 0, dimensione, dimensione).data;
        const quote = new Float32Array(dimensione * dimensione);
        for (let k = 0, p = 0; k < quote.length; k++, p += 4) {
          quote[k] = px[p] * 256 + px[p + 1] + px[p + 2] / 256 - 32768;
        }
        risolvi(quote);
      };
      img.src = url.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    }),
  });
}

/** Seno e coseno dell'elevazione del sole di un set, per le variabili dello shader. */
const elevazione = f => {
  const el = ((f.sunElevation ?? 45) * Math.PI) / 180;
  return {sinEl: Math.sin(el), cosEl: Math.cos(el)};
};

export function hillshadeGpu(ol, sourceDef, fasce) {
  const primo = fasce[0] ?? {opacity: 0.25};
  const grigio = grigioIncidenza(primo);

  const layer = new ol.layer.WebGLTile({
    source: sorgenteQuote(ol, sourceDef),
    style: {
      variables: {vert: primo.vert ?? 1, gamma: primo.gamma ?? 1, slope: primo.slope ?? 0, passoDem: 1, ...elevazione(primo)},
      color: ['color', ['*', 255, grigio], ['*', 255, grigio], ['*', 255, grigio]],
    },
    opacity: primo.opacity,
    // La classe decide come il layer si compone: `multiply` scurisce soltanto,
    // `overlay` scurisce le zone scure e SCHIARISCE quelle chiare — che e'
    // quello che fa il riferimento da z14 con `#slope10m`. Con il solo
    // multiply, alzare l'ombra per avere contrasto affonda la luminosita':
    // a z16 il contrasto passava da -9,6 a -5,8 ma la luminosita' da -5 a -19.
    className: `ol-layer wm-hillshade wm-blend-${primo.blend ?? 'multiply'}`,
    properties: {'wm-hillshade': true},
  });

  /** Opacita', esagerazione e modo di composizione seguono le fasce. */
  /**
   * Metri per texel del DEM al livello di tile realmente usato.
   *
   * Oltre il maxzoom del DEM la vista continua a ingrandire ma i texel
   * restano quelli dell'ultimo livello disponibile: il passo di campionamento
   * si ferma li'. Senza questo, a z17 il gradiente raddoppiava a ogni livello
   * e saturava in bande nere.
   */
  const passoDelDem = zoom => {
    const tg = layer.getSource().getTileGrid();
    const zMax = tg.getMaxZoom();
    const z = Math.min(Math.max(Math.round(zoom), tg.getMinZoom()), zMax);
    return tg.getResolution(z);
  };

  /**
   * La fascia del livello; fuori dalle fasce, la piu' vicina. Prima si cadeva
   * sempre sull'ULTIMA, quella pensata per z17+: sotto z8 la mappa prendeva
   * l'ombra di z16 (composizione normale a 0,3), un velo grigio al posto del
   * `multiply` di TGen, senza errori.
   */
  const fasciaDi = z => fasce.find(x => z >= x.zmin && z <= x.zmax)
    ?? (fasce.length && z < fasce[0].zmin ? fasce[0] : fasce.at(-1)) ?? primo;

  const aggiornaOpacita = zoom => {
    const z = Math.round(zoom);
    const f = fasciaDi(z);
    if (layer.getOpacity() !== f.opacity) layer.setOpacity(f.opacity);
    const vert = f.vert ?? 1;
    const gamma = f.gamma ?? 1;
    const slope = f.slope ?? 0;
    const passoDem = passoDelDem(zoom);
    const el = f.sunElevation ?? 45;
    if (layer.get('wm-vert') !== vert || layer.get('wm-gamma') !== gamma
        || layer.get('wm-slope') !== slope || layer.get('wm-passo') !== passoDem
        || layer.get('wm-el') !== el) {
      layer.set('wm-vert', vert);
      layer.set('wm-gamma', gamma);
      layer.set('wm-slope', slope);
      layer.set('wm-passo', passoDem);
      layer.set('wm-el', el);
      layer.updateStyleVariables({vert, gamma, slope, passoDem, ...elevazione(f)});
    }
    layer.set('wm-blend', f.blend ?? 'multiply');
    allineaBlend();
  };

  /**
   * La classe di composizione va sul canvas del layer, che esiste solo dopo il
   * primo disegno. Quando la vista nasce gia' al livello giusto (?c=, gli
   * scatti di misura e di rendering) la prima chiamata non trova il canvas:
   * prima si segnava la composizione come applicata e non si riprovava piu',
   * e da z14 l'ombra restava in `multiply` invece che `normal` senza alcun
   * errore. Ora la classe si riallinea dopo ogni disegno finche' non coincide.
   */
  const allineaBlend = () => {
    const blend = layer.get('wm-blend') ?? 'multiply';
    // In OpenLayers 7 la classe del layer sta sul canvas WebGL stesso, che si
    // raggiunge dall'helper del renderer: `getRenderer().getCanvas()` non
    // esiste, e cercarlo faceva fallire il cambio in silenzio. Il cambio di
    // composizione fra livelli non ha mai funzionato finche' tutti i set
    // erano `multiply`, e nessuno se n'era accorto.
    const r = layer.getRenderer?.();
    const target = r?.helper?.getCanvas?.() ?? null;
    if (!target || target.classList.contains(`wm-blend-${blend}`)) return;
    target.classList.remove('wm-blend-multiply', 'wm-blend-overlay', 'wm-blend-soft-light', 'wm-blend-normal');
    target.classList.add(`wm-blend-${blend}`);
  };
  layer.on('postrender', allineaBlend);

  /**
   * Secondo layer, per la sola pendenza, composto in `overlay`.
   *
   * Serve un layer a parte perche' il modo di composizione sta nel CSS della
   * classe e non si cambia a runtime: assegnarlo dopo la creazione non ha
   * effetto (provato: la luminosita' crollava perche' restava `multiply`).
   */
  const gp = grigioPendenza();
  const pendenzaLayer = new ol.layer.WebGLTile({
    source: layer.getSource(),
    style: {
      variables: {vert: primo.vert ?? 1, slope: primo.slope ?? 0, passoDem: 1},
      color: ['color', ['*', 255, gp], ['*', 255, gp], ['*', 255, gp]],
    },
    opacity: primo.slope ? 1 : 0,
    className: 'ol-layer wm-blend-overlay',
    properties: {'wm-hillshade-slope': true},
  });

  const aggiornaPendenza = zoom => {
    const z = Math.round(zoom);
    const f = fasciaDi(z);
    const slope = f.slope ?? 0;
    const passoDem = passoDelDem(zoom);
    pendenzaLayer.setOpacity(slope > 0 ? 1 : 0);
    if (pendenzaLayer.get('wm-slope') !== slope || pendenzaLayer.get('wm-passo') !== passoDem) {
      pendenzaLayer.set('wm-slope', slope);
      pendenzaLayer.set('wm-passo', passoDem);
      pendenzaLayer.updateStyleVariables({vert: f.vert ?? 1, slope, passoDem});
    }
  };

  const aggiorna = zoom => { aggiornaOpacita(zoom); aggiornaPendenza(zoom); };
  return {layer, pendenzaLayer, aggiornaOpacita: aggiorna};
}
