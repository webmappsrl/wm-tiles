/**
 * Genera i glifi PBF per MapLibre dai font TTF.
 * I glifi sono serviti da /glyphs/{fontstack}/{range}.pbf e referenziati
 * dallo style.json: nessuna dipendenza da CDN esterni, e sono gli stessi
 * che dovranno finire nella cache offline nel ciclo successivo.
 *
 * Uso: node pipeline/make-glyphs.mjs <dir-ttf> [out-dir]
 */
import fontnik from 'fontnik';
import {mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {basename, join} from 'node:path';

const SRC = process.argv[2] ?? '/tmp/fonts';
const OUT = process.argv[3] ?? 'style/glyphs';

/** Il nome del fontstack va scritto come lo referenzia lo stile: "Noto Sans Regular". */
function fontstackName(file) {
  return basename(file, '.ttf').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/-/g, ' ');
}

const files = readdirSync(SRC).filter(f => f.endsWith('.ttf'));
if (files.length === 0) {
  console.error(`nessun .ttf in ${SRC}`);
  process.exit(1);
}

for (const file of files) {
  const name = fontstackName(file);
  const dir = join(OUT, name);
  mkdirSync(dir, {recursive: true});
  const buf = readFileSync(join(SRC, file));
  let written = 0;
  for (let start = 0; start < 65536; start += 256) {
    const end = start + 255;
    const res = await new Promise((resolve, reject) =>
      fontnik.range({font: buf, start, end}, (err, out) => (err ? reject(err) : resolve(out))),
    );
    writeFileSync(join(dir, `${start}-${end}.pbf`), res);
    written++;
  }
  console.log(`${name}: ${written} range in ${dir}`);
}
