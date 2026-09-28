import {readdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
async function files(dir){let out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())out.push(...await files(p));else out.push(p);}return out;}
const assets=(await files('dist')).filter(p=>!p.endsWith('sw.js')&&!p.includes('sample.mp4')&&!p.includes('ffmpeg/')&&!p.endsWith('.map')).map(p=>'./'+p.slice(5));
const hash=(await import('node:crypto')).createHash('sha256');for(const p of assets)hash.update(await readFile('dist/'+p.slice(2)));
const cache='tempo-'+hash.digest('hex').slice(0,12);
await writeFile('dist/sw.js',`const CACHE=${JSON.stringify(cache)};const FILES=${JSON.stringify(assets)};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('tempo-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==location.origin||e.request.headers.has('range'))return;e.respondWith(fetch(e.request).then(r=>{if(r.ok&&FILES.some(p=>new URL(p,self.registration.scope).href===e.request.url)){const clone=r.clone();caches.open(CACHE).then(c=>c.put(e.request,clone));}return r;}).catch(()=>caches.match(e.request).then(r=>r||e.request.mode==='navigate'&&caches.match('./index.html')||Response.error())));});
`);
