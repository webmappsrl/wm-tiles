import {VectorTile} from '@mapbox/vector-tile';
import {PbfReader} from 'pbf';
import {getTile} from '../src/archive/store.js';
const dir='data/archives';
const V=process.argv[2];
function t(lon,lat,z){const n=2**z;const x=Math.floor((lon+180)/360*n);
const r=lat*Math.PI/180;const y=Math.floor((1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*n);return[x,y];}
for (const z of [11,12,13]) {
  const [x,y]=t(10.25,44.22,z);
  const b=await getTile(dir,V,'osm',z,x,y);
  if (!b) { console.log(`  z${z}: tile assente`); continue; }
  const tile=new VectorTile(new PbfReader(b));
  const info=[];
  for (const [n,l] of Object.entries(tile.layers)) {
    if (!['transportation','transportation_name','place','mountain_peak','boundary'].includes(n)) continue;
    const cls={};
    for (let i=0;i<l.length;i++){ const f=l.feature(i);
      const k=f.properties.class ?? f.properties.admin_level ?? '-'; cls[k]=(cls[k]||0)+1; }
    info.push(`${n}(${l.length}): ${Object.entries(cls).slice(0,5).map(([k,v])=>k+'×'+v).join(' ')}`);
  }
  console.log(`  z${z} ${x}/${y}: ${b.length}B\n    ${info.join('\n    ')}`);
}
