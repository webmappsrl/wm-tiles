import {describe, expect, it} from 'vitest';
import {maschereTile, percorso, rasterizza, tileSorgente, valuta} from '../src/revisione/maschere.js';

const somma = a => a.reduce((s, v) => s + v, 0);

/** Una tile vettoriale finta: quanto basta a maschereTile. */
const vtFinta = layers => ({layers: Object.fromEntries(Object.entries(layers).map(([nome, feats]) => [nome, {
  extent: 4096, length: feats.length,
  feature: i => ({type: feats[i].type, properties: feats[i].properties, loadGeometry: () => feats[i].geom}),
}]))});
const quadrato = (x0, y0, x1, y1) => [[{x: x0, y: y0}, {x: x1, y: y0}, {x: x1, y: y1}, {x: x0, y: y1}, {x: x0, y: y0}]];

describe('tileSorgente', () => {
  it('sotto il maxzoom e\' la tile stessa', () => {
    expect(tileSorgente({z: 12, x: 5, y: 7}, 14)).toEqual({z: 12, x: 5, y: 7, k: 1, ox: 0, oy: 0});
  });
  it('oltre il maxzoom e\' il genitore, con la posizione dentro di esso', () => {
    expect(tileSorgente({z: 16, x: 34639, y: 23768}, 14))
      .toEqual({z: 14, x: 8659, y: 5942, k: 4, ox: 3, oy: 0});
  });
});

describe('rasterizza', () => {
  it('un quadrato pieno di meta\' lato copre un quarto della tile', async () => {
    const d = percorso(quadrato(0, 0, 2048, 2048), 4096, {k: 1, ox: 0, oy: 0}, true);
    const m = await rasterizza([d], {tipo: 'pieno'});
    expect(somma(m) / 65536).toBeCloseTo(0.25, 2);
  });
  it('oltre il maxzoom ritaglia il quarto giusto del genitore', async () => {
    // quadrato nel quarto in basso a destra del genitore; la figlia (ox 1, oy 1) e' tutta piena
    const d = percorso(quadrato(2048, 2048, 4096, 4096), 4096, {k: 2, ox: 1, oy: 1}, true);
    const m = await rasterizza([d], {tipo: 'pieno'});
    expect(somma(m) / 65536).toBeGreaterThan(0.98);
    const vuota = percorso(quadrato(2048, 2048, 4096, 4096), 4096, {k: 2, ox: 0, oy: 0}, true);
    expect(somma(await rasterizza([vuota], {tipo: 'pieno'}))).toBe(0);
  });
});

describe('valuta', () => {
  it('valuta a zoom - 1, come ol-mapbox-style', () => {
    const layer = {type: 'line', paint: {'line-width': ['step', ['zoom'], 1, 12, 4]}};
    expect(valuta(layer, 'line-width', 12)).toBe(1);
    expect(valuta(layer, 'line-width', 13)).toBe(4);
  });
});

describe('maschereTile', () => {
  const vt = vtFinta({
    landcover: [{type: 3, properties: {class: 'wood'}, geom: quadrato(0, 0, 4096, 4096)}],
    place: [{type: 1, properties: {name: 'Agliano'}, geom: [[{x: 2048, y: 2048}]]}],
  });
  const layers = [
    {id: 'bosco', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['==', ['get', 'class'], 'wood']},
    {id: 'prati', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['==', ['get', 'class'], 'grass']},
    {id: 'paesi', type: 'symbol', source: 'omt', 'source-layer': 'place'},
  ];
  const tileVettoriale = async () => ({vt, sorgente: {maxzoom: 14}});

  it('applica il filtro del layer', async () => {
    const {maschere} = await maschereTile({z: 12, x: 0, y: 0}, {layers, tileVettoriale});
    expect(maschere.map(m => m.id)).toEqual(['bosco']); // prati: nessuna feature
    expect(somma(maschere[0].data)).toBe(65536);
  });
  it('i layer symbol diventano zone etichetta, non maschere', async () => {
    const {maschere, etichette} = await maschereTile({z: 12, x: 0, y: 0}, {layers, tileVettoriale});
    expect(maschere.find(m => m.id === 'paesi')).toBeUndefined();
    expect(etichette[128 * 256 + 128]).toBe(1);
    expect(etichette[0]).toBe(0);
  });
  it('ogni layer symbol ha anche la sua zona, per misurarne l\'inchiostro', async () => {
    const {zone} = await maschereTile({z: 12, x: 0, y: 0}, {layers, tileVettoriale});
    expect(zone.map(q => q.id)).toEqual(['paesi']);
    expect(zone[0].data[128 * 256 + 128]).toBe(1);
  });
  it('review 6: un\'etichetta di poligono ha la zona all\'interno, non sul bordo', async () => {
    const vtP = vtFinta({park: [{type: 3, properties: {}, geom: quadrato(1024, 1024, 3072, 3072)}]});
    const {etichette} = await maschereTile({z: 12, x: 0, y: 0}, {
      layers: [{id: 'nomi-parchi', type: 'symbol', source: 'omt', 'source-layer': 'park'}],
      tileVettoriale: async () => ({vt: vtP, sorgente: {maxzoom: 14}}),
    });
    expect(etichette[128 * 256 + 128]).toBe(1); // il centro
    expect(etichette[128 * 256 + 64]).toBe(0);  // il bordo, a 64 px dal centro
  });
  it('review 7: ogni linea ha la sua larghezza, e una larga 0 non ha maschera', async () => {
    const riga = y => [[{x: 0, y: y * 16}, {x: 4096, y: y * 16}]];
    const vtL = vtFinta({transportation: [
      {type: 2, properties: {class: 'major'}, geom: riga(64)},
      {type: 2, properties: {class: 'service'}, geom: riga(192)},
    ]});
    const {maschere} = await maschereTile({z: 12, x: 0, y: 0}, {
      layers: [{id: 'strade', type: 'line', source: 'omt', 'source-layer': 'transportation',
        paint: {'line-width': ['match', ['get', 'class'], 'major', 10, 0]}}],
      tileVettoriale: async () => ({vt: vtL, sorgente: {maxzoom: 14}}),
    });
    const m = maschere[0].data;
    expect(m[192 * 256 + 128]).toBe(0);
    let spessore = 0;
    for (let y = 40; y < 90; y++) spessore += m[y * 256 + 128];
    expect(spessore).toBeGreaterThanOrEqual(9);
    expect(spessore).toBeLessThanOrEqual(11);
  });
  it('oltre il maxzoom le zone etichetta seguono il ritaglio', async () => {
    const vt16 = vtFinta({place: [{type: 1, properties: {}, geom: [[{x: 3900, y: 3900}]]}]});
    const tv = async () => ({vt: vt16, sorgente: {maxzoom: 14}});
    const paesi = [layers[2]];
    // il punto e' nel quarto in basso a destra del genitore z14: cade nella figlia 3,3
    const giusta = await maschereTile({z: 16, x: 3, y: 3}, {layers: paesi, tileVettoriale: tv});
    const sbagliata = await maschereTile({z: 16, x: 0, y: 0}, {layers: paesi, tileVettoriale: tv});
    expect(somma(giusta.etichette)).toBeGreaterThan(0);
    expect(somma(sbagliata.etichette)).toBe(0);
  });
});
