import {VectorTile} from '@mapbox/vector-tile';
import {PbfReader} from 'pbf';
import {getTile} from '../src/archive/store.js';
const dir='data/archives';
const [V, lon, lat, z] = [process.argv[2], +process.argv[3], +process.argv[4], +process.argv[5]];
const n=2**z, x=Math.floor((lon+180)/360*n);
const r=lat*Math.PI/180, y=Math.floor((1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*n);
const b=await getTile(dir,V,'osm',z,x,y);
if (!b) { console.log(`  tile z${z} ${x}/${y} assente`); process.exit(0); }
const tile=new VectorTile(new PbfReader(b));
console.log(`  tile z${z} ${x}/${y}: ${b.length} byte`);
for (const [name,l] of Object.entries(tile.layers)) {
  const cls={}; let named=0; const esempi=[];
  for (let i=0;i<l.length;i++){ const f=l.feature(i);
    const k=f.properties.class ?? f.properties.admin_level ?? '-';
    cls[k]=(cls[k]||0)+1;
    if (f.properties.name){ named++; if(esempi.length<3) esempi.push(f.properties.name); } }
  console.log(`    ${name.padEnd(20)} ${String(l.length).padStart(4)}  con nome: ${String(named).padStart(3)}  ${Object.entries(cls).slice(0,4).map(([k,v])=>k+'×'+v).join(' ')}${esempi.length?'  es. '+esempi.join(', '):''}`);
}
