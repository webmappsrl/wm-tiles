import {VectorTile} from '@mapbox/vector-tile';
import {PbfReader} from 'pbf';
import {getTile} from '../src/archive/store.js';
const dir='data/archives';
const V=process.argv[2];
const COL={fondogiallo:[252,248,233],bianco:[254,251,248],bosco:[190,203,174],
  pascolo:[236,243,224],arbusti:[213,226,202],zumide:[218,237,232],
  acquefondo:[220,231,247],ghiacciai:[243,250,251],verdeneutro:[250,250,234]};
let tot=0; const c={};
for (const [x,y] of [[8661,5939],[8660,5939],[8661,5940],[8660,5940]]) {
  const t=await getTile(dir,V,'landcover',14,x,y);
  if (!t) continue;
  const tile=new VectorTile(new PbfReader(t));
  const l=tile.layers.landcover; if (!l) continue;
  for (let i=0;i<l.length;i++){
    const k=l.feature(i).properties.coduso;
    c[k]=(c[k]||0)+1; tot++;
  }
}
const entries=Object.entries(c).sort((a,b)=>b[1]-a[1]);
console.log('  classi nella vista (per numero di poligoni):');
let R=0,G=0,B=0,n=0;
for (const [k,v] of entries) {
  const p=(100*v/tot).toFixed(1);
  console.log(`    ${k.padEnd(14)} ${String(v).padStart(5)}  ${p}%`);
  const col=COL[k]; if (col){ R+=col[0]*v; G+=col[1]*v; B+=col[2]*v; n+=v; }
}
console.log(`  media pesata dei colori: rgb(${(R/n).toFixed(0)},${(G/n).toFixed(0)},${(B/n).toFixed(0)})  r-b = ${((R-B)/n).toFixed(1)}`);
console.log('  TGEN misurato:           rgb(190,197,181)  r-b = 9.0');
