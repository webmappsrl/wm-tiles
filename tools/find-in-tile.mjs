import {VectorTile} from '@mapbox/vector-tile';
import {PbfReader} from 'pbf';
import {getTile} from '../src/archive/store.js';
const dir='data/archives';
const [V, archive, layer] = process.argv.slice(2);
function t(lon,lat,z){const n=2**z;const x=Math.floor((lon+180)/360*n);
const r=lat*Math.PI/180;const y=Math.floor((1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*n);return[x,y];}
for (const z of [13,14]) {
  const [x0,y0]=t(10.31,44.28,z);
  for (let dx=-1;dx<=1;dx++) for (let dy=-1;dy<=1;dy++) {
    const b=await getTile(dir,V,archive,z,x0+dx,y0+dy);
    if (!b) continue;
    const tile=new VectorTile(new PbfReader(b));
    const l=tile.layers[layer]; if (!l) continue;
    const found=[];
    for (let i=0;i<l.length;i++){ const f=l.feature(i);
      if (f.properties.name) found.push(`${f.properties.name} (${f.properties.kind??f.properties.class??'-'})`); }
    if (found.length) console.log(`  z${z} ${x0+dx}/${y0+dy}: ${found.slice(0,10).join(' · ')}`);
  }
}
