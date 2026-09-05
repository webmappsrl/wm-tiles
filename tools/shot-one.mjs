import {chromium} from 'playwright';
const q = process.argv[2], out = process.argv[3];
const b = await chromium.launch({args:['--use-gl=angle','--enable-unsafe-swiftshader']});
const p = await (await b.newContext({viewport:{width:780,height:620}})).newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>m.type()==='error'&&errs.push(m.text()));
// la query passata deve poter sovrascrivere area e zoom
// i parametri della query passata devono SOVRASCRIVERE i default:
// con chiavi duplicate URLSearchParams.get() restituisce la prima.
const u = new URL('http://localhost:8080/preview/');
const params = new URLSearchParams('area=appennino&zoom=14&single=left');
for (const [k, v] of new URLSearchParams(q)) params.set(k, v);
u.search = params.toString();
await p.goto(u.toString(), {waitUntil:'networkidle', timeout:40000});
await p.waitForTimeout(4000);
await p.screenshot({path: out});
if (errs.length) console.log('  errori: '+errs.slice(0,4).join(' | '));
await b.close();
