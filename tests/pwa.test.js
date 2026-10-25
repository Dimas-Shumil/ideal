import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const read = p => readFile(new URL('../'+p,import.meta.url),'utf8');
const source=await read('server/modules/push/sw.js');
function worker({network=async()=>new Response('network'),stored=new Map(),names=[]}={}) {
 const listeners={},deleted=[],writes=[];
 const cache={match:async key=>stored.get(key)?.clone(),put:async(key,value)=>{writes.push(key);stored.set(key,value);}};
 const self={location:{origin:'https://ideal.example'},addEventListener:(n,f)=>listeners[n]=f};
 vm.runInNewContext(source,{self,URL,Set,Response,fetch:network,caches:{open:async()=>cache,keys:async()=>names,delete:async n=>deleted.push(n)}});
 return {listeners,deleted,writes,stored};
}
function request(w,{method='GET',path='/admin',mode='navigate'}={}) {
 let response;w.listeners.fetch({request:{method,url:'https://ideal.example'+path,mode},respondWith:p=>response=p});return response;
}
test('PWA manifest: stable identity, public start, root scope and real PNG dimensions',async()=>{
 const m=JSON.parse(await read('server/modules/pwa/manifest.json'));
 assert.equal(m.start_url,'/');assert.equal(m.scope,'/');assert.equal(m.display,'standalone');assert.equal(m.id,'/employee-app');
 for(const i of [...m.icons,{src:'/site/img/pwa/apple-touch-180.png',sizes:'180x180'}]){
  const b=await readFile(new URL('..'+i.src,import.meta.url));assert.equal(b.subarray(1,4).toString(),'PNG');assert.equal(b.readUInt32BE(16),Number(i.sizes.split('x')[0]));
 }
 assert.ok(m.icons.some(i=>i.purpose==='maskable'));
});
test('PWA install caches exactly session-free allowlist and rejects no-store',async()=>{
 const w=worker();let p;w.listeners.install({waitUntil:v=>p=v});await p;assert.deepEqual(w.writes,['/offline.html','/site/css/pwa.css']);
 for(const response of [new Response('private',{headers:{'Cache-Control':'no-store'}}),new Response('bad',{status:500})]){
 const bad=worker({network:async()=>response});bad.listeners.install({waitUntil:v=>p=v});await assert.rejects(p);assert.equal(bad.writes.length,0);
 }
});
test('PWA offline navigation shows neutral fallback, never stores private HTML',async()=>{
 const w=worker({network:async()=>{throw Error('offline');},stored:new Map([['/offline.html',new Response('offline')]])});
 for(const path of ['/admin','/login','/trainer/lessons','/cart.html','/shop/orders/receipt','/shop.html']) assert.equal(await (await request(w,{path})).text(),'offline');
 assert.equal(w.writes.length,0);
});
test('PWA online no-store and HTTP errors are returned intact without writes',async()=>{
 for(const status of [200,401,403,500,503]){
 const w=worker({network:async()=>new Response('server',{status,headers:{'Cache-Control':'no-store'}})});
 assert.equal((await request(w)).status,status);assert.equal(w.writes.length,0);
 }
});
test('PWA does not intercept mutations, API fetches, images or cross-origin requests',()=>{
 const w=worker();for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal(request(w,{method}),undefined);
 for(const path of ['/api/auth/me','/site/img/x.png','/api/shop/cart']) assert.equal(request(w,{path,mode:'cors'}),undefined);
 let intercepted=false;w.listeners.fetch({request:{method:'GET',url:'https://evil.example/',mode:'navigate'},respondWith:()=>intercepted=true});assert.equal(intercepted,false);
});
test('PWA activation cleans only older own caches; update never forces takeover',async()=>{
 const w=worker({names:['other-app-v1','ideal-pwa-offline-v0','ideal-pwa-offline-v1','ideal-pwa-offline-v2']});let p;w.listeners.activate({waitUntil:v=>p=v});await p;assert.deepEqual(w.deleted,['ideal-pwa-offline-v0','ideal-pwa-offline-v1']);
 assert.doesNotMatch(source,/self\.skipWaiting\s*\(|clients\.claim\s*\(/);
});
test('PWA client uses same root worker and has no Push consent, subscription or reload',async()=>{
 const s=await read('site/scripts/pwa.js');assert.match(s,/register\('\/push-sw.js', \{scope: '\/'/);assert.doesNotMatch(s,/requestPermission|pushManager|\.reload\(|skipWaiting|\.subscribe\(/);
 const app=await read('server/app.js');assert.match(app,/app.get\('\/application', requireAuth, requireRole\('OWNER', 'ADMIN', 'TRAINER'\)/);
});
test('PWA fallback contains no templates, identity, automatic retries or form mutations',async()=>{
 const s=await read('server/modules/pwa/offline.html');assert.doesNotMatch(s,/<%|<form|<script|csrf|displayName/);assert.match(s,/результат операции неизвестен/);
});
test('PWA HTTP: public manifest/offline/icons/SW, private application and no repository exposure',async()=>{
 const {createApp}=await import('../server/app.js');const {readConfig}=await import('../server/config/env.js');const {default:supertest}=await import('supertest');
 const config=readConfig({NODE_ENV:'test',APP_ORIGIN:'http://127.0.0.1:3000',DATABASE_URL:'postgresql://unused:unused@127.0.0.1/unused_test',SESSION_SECRET:'x'.repeat(80)});
 const {app,store}=await createApp({config,db:{pool:{query:async()=>{throw Error('Unexpected database access');}},prisma:{}}});
 try{
 const req=supertest(app);const m=await req.get('/manifest.webmanifest').expect(200);assert.match(m.headers['content-type'],/application\/manifest\+json/);assert.equal(m.headers['set-cookie'],undefined);
 for(const icon of JSON.parse(m.text).icons)await req.get(icon.src).expect(200).expect('Content-Type',/image\/png/);
 await req.get('/offline.html').expect(200);await req.get('/push-sw.js').expect(200).expect('Cache-Control','no-cache');
 await req.get('/application').expect(303).expect('Location','/login').expect('Cache-Control','no-store');
 for(const path of ['/server/modules/pwa/manifest.json','/docs/PWA.md','/.env'])await req.get(path).expect(404);
 }finally{store.close();}
});
