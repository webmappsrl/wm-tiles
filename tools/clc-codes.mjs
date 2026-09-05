import {VectorTile} from '@mapbox/vector-tile';
import {PbfReader} from 'pbf';
import {getTile} from '../src/archive/store.js';
const dir='data/archives';
const V=process.argv[2];
const MAPPED=new Set(['111','112','121','122','123','124','131','132','133','141','142','211','212','213','221','222','223','231','241','242','243','244','311','312','313','321','322','323','324','331','332','333','334','335','411','412','421','422','423','511','512','521','522','523']);
const c={};
for (const [x,y] of [[541,371],[540,371],[541,372],[540,372]]) {
  const b=await getTile(dir,V,'clc',10,x,y);
  if (!b) continue;
  const l=new VectorTile(new PbfReader(b)).layers.clc;
  for (let i=0;i<(l?.length??0);i++){ const k=l.feature(i).properties.code; c[k]=(c[k]||0)+1; }
}
const all=Object.entries(c).sort((a,b)=>b[1]-a[1]);
console.log('  codici presenti:', all.map(([k,v])=>k+'×'+v).join(' '));
const miss=all.filter(([k])=>!MAPPED.has(String(k)));
console.log('  NON mappati:', miss.length ? miss.map(([k,v])=>k+'×'+v).join(' ') : 'nessuno');
