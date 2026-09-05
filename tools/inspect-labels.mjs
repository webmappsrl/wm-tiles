import {VectorTile} from '@mapbox/vector-tile';
import {PbfReader} from 'pbf';
import {getTile} from '../src/archive/store.js';
const dir='data/archives';
const V=process.argv[2];
const t=await getTile(dir,V,'osm',14,8661,5939);
const tile=new VectorTile(new PbfReader(t));
for (const [name, l] of Object.entries(tile.layers)) {
  if (!['transportation_name','waterway','water_name','place','poi'].includes(name)) continue;
  const found=[];
  for (let i=0;i<l.length;i++){
    const f=l.feature(i); const p=f.properties;
    if (p.name) found.push(`${p.name} [class=${p.class??'-'} subclass=${p.subclass??'-'} rank=${p.rank??'-'}]`);
  }
  if (found.length) console.log(`── ${name} (${found.length}):\n   ${found.slice(0,8).join('\n   ')}`);
}
