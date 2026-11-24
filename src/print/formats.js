/**
 * Formati di pagina per la stampa. I lati sono in millimetri e nell'orientamento
 * verticale, che e' la forma canonica: `landscape` scambia i due lati.
 */
export const PAGE_FORMATS = {
  a4: {widthMm: 210, heightMm: 297},
  a5: {widthMm: 148, heightMm: 210},
};

const ORIENTATIONS = ['portrait', 'landscape'];

/**
 * Pixel di una pagina a una data densita'. Un formato, un orientamento o un
 * dpi sconosciuti sono errori: nessun valore predefinito silenzioso, e
 * il messaggio nomina il campo senza riportarne il contenuto.
 */
export function pageSize({format, orientation, dpi} = {}) {
  if (!Object.hasOwn(PAGE_FORMATS, format)) {
    throw new Error(`format non valido (ammessi: ${Object.keys(PAGE_FORMATS).join(', ')})`);
  }
  if (!ORIENTATIONS.includes(orientation)) {
    throw new Error(`orientation non valido (ammessi: ${ORIENTATIONS.join(', ')})`);
  }
  if (typeof dpi !== 'number' || !Number.isFinite(dpi) || dpi <= 0) {
    throw new Error('dpi obbligatorio: deve essere un numero positivo');
  }
  const {widthMm, heightMm} = PAGE_FORMATS[format];
  const px = mm => Math.round((mm * dpi) / 25.4);
  const width = px(widthMm);
  const height = px(heightMm);
  return orientation === 'landscape' ? {width: height, height: width} : {width, height};
}
