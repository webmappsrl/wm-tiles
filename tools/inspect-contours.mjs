import {VectorTile} from '@mapbox/vector-tile';
import {PbfReader} from 'pbf';
import {getTile} from '../src/archive/store.js';
const dir='data/archives';
function t(lon,lat,z){const n=2**z;const x=Math.floor((lon+180)/360*n);
const r=lat*Math.PI/180;const y=Math.floor((1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*n);return[x,y];}
for (const z of [11,12,13,14]) {
  const [x,y]=t(10.31,44.28,z);
  const buf=await getTile(dir,'dem','contours',z,x,y);
  if (!buf) { console.log(`z${z}: assente`); continue; }
  const tile=new VectorTile(new PbfReader(buf));
  const l=tile.layers.contour;
  const eles=[]; const idx=[];
  for (let i=0;i<l.length;i++) { const f=l.feature(i); eles.push(f.properties.ele); idx.push(f.properties.index); }
  const uniq=[...new Set(eles)].sort((a,b)=>a-b);
  const steps=uniq.slice(1).map((v,i)=>v-uniq[i]);
  console.log(`z${z}: ${l.length} linee, ${uniq.length} quote distinte, equidistanza=${[...new Set(steps)].join('/')} m, indice=${idx.filter(v=>v===1).length}`);
  console.log(`     quote: ${uniq.slice(0,12).join(', ')}${uniq.length>12?' …':''}`);
}
