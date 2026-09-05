import {VectorTile} from '@mapbox/vector-tile';
import {PbfReader} from 'pbf';
import {getTile} from '../src/archive/store.js';
const dir='data/archives';
const [V, lon, lat] = [process.argv[2], +process.argv[3], +process.argv[4]];
for (const z of [10,11,12,13,14]) {
  const n=2**z, x=Math.floor((lon+180)/360*n);
  const r=lat*Math.PI/180, y=Math.floor((1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*n);
  const b=await getTile(dir,V,'landcover',z,x,y);
  if (!b) { console.log(`  z${z}: assente`); continue; }
  const l=new VectorTile(new PbfReader(b)).layers.landcover;
  const c={};
  for (let i=0;i<(l?.length??0);i++) { const k=l.feature(i).properties.coduso; c[k]=(c[k]||0)+1; }
  const top=Object.entries(c).sort((a,b)=>b[1]-a[1]).slice(0,6);
  console.log(`  z${z} ${x}/${y}: ${b.length}B  ${l?.length??0} poligoni  ${top.map(([k,v])=>k+'×'+v).join(' ')}`);
}
