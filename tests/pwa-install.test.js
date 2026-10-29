import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../site/scripts/pwa-install.js',import.meta.url),'utf8');
function setup({stored={},standalone=false,blocked=false,hidden=false,ios=false}={}){
 const events={},timers=[],nodes=[],values=new Map(Object.entries(stored));
 class Node{
  constructor(tag){this.tag=tag;this.children=[];this.events={};this.hidden=false;}
  append(...children){this.children.push(...children);}
  setAttribute(){}
  addEventListener(n,f){this.events[n]=f;}
 }
 const document={hidden,body:{append:n=>nodes.push(n)},createElement:n=>new Node(n),addEventListener:(n,f)=>events[n]=f,removeEventListener:n=>delete events[n]};
 const window={isSecureContext:true,addEventListener:(n,f)=>events[n]=f};
 const localStorage={getItem:k=>{if(blocked)throw Error();return values.get(k)??null;},setItem:(k,v)=>{if(blocked)throw Error();values.set(k,v);}};
 vm.runInNewContext(source,{window,navigator:{serviceWorker:{},standalone,userAgent:ios?'iPhone':'Chrome',platform:'',maxTouchPoints:0},document,localStorage,matchMedia:()=>({matches:standalone}),setTimeout:(f,ms)=>timers.push({f,ms}),Date});
 return {events,timers,nodes,values,document,show:()=>timers[0].f(),button:()=>nodes[0].children[1].children[0],later:()=>nodes[0].children[1].children[1],hint:()=>nodes[0].children[0].children[2]};
}
test('public PWA: banner appears only after 10 seconds without focus transfer',()=>{
 const w=setup();assert.equal(w.nodes.length,0);assert.equal(w.timers[0].ms,10000);w.show();assert.equal(w.nodes.length,1);assert.doesNotMatch(source,/\.focus\(/);
});
test('public PWA: Later stores seven days and suppresses next page, expired cooldown permits banner',()=>{
 const w=setup();w.show();const now=Date.now();w.later().events.click();assert.equal(w.nodes[0].hidden,true);const until=Number(w.values.get('ideal-pwa-later-until'));assert.ok(until>=now+7*86400000&&until<=Date.now()+7*86400000);
 const next=setup({stored:{'ideal-pwa-later-until':String(until)}});next.show();assert.equal(next.nodes.length,0);
 const expired=setup({stored:{'ideal-pwa-later-until':'1'}});expired.show();assert.equal(expired.nodes.length,1);
});
test('public PWA: standalone, known installed and appinstalled suppress the banner',()=>{
 for(const options of [{standalone:true},{stored:{'ideal-pwa-installed':'1'}}]){const w=setup(options);w.show();assert.equal(w.nodes.length,0);}
 const w=setup();w.show();w.events.appinstalled();assert.equal(w.nodes[0].hidden,true);assert.equal(w.values.get('ideal-pwa-installed'),'1');
});
test('public PWA: native prompt requires explicit click; dismissal gets cooldown',async()=>{
 const w=setup();let calls=0,prevented=0;w.events.beforeinstallprompt({preventDefault:()=>prevented++,prompt:async()=>calls++,userChoice:Promise.resolve({outcome:'dismissed'})});w.show();assert.equal(calls,0);await w.button().events.click();assert.equal(calls,1);assert.equal(prevented,1);assert.equal(w.nodes[0].hidden,true);assert.ok(w.values.has('ideal-pwa-later-until'));
});
test('public PWA: missing or failed native prompt shows instructions, including iPhone',async()=>{
 const w=setup({ios:true});w.show();await w.button().events.click();assert.equal(w.hint().hidden,false);assert.match(w.hint().textContent,/На экран Домой/);
 const failed=setup();failed.events.beforeinstallprompt({preventDefault(){},prompt:async()=>{throw Error();}});failed.show();await failed.button().events.click();assert.equal(failed.hint().hidden,false);assert.equal(failed.button().disabled,false);
});
test('public PWA: storage denial is harmless; Escape dismisses within current page',()=>{
 const w=setup({blocked:true});w.show();w.nodes[0].events.keydown({key:'Escape',preventDefault(){}});assert.equal(w.nodes[0].hidden,true);
});
test('public PWA: background page waits for visibility; other-tab Later hides open banner',()=>{
 const w=setup({hidden:true});w.show();assert.equal(w.nodes.length,0);w.document.hidden=false;w.events.visibilitychange();assert.equal(w.nodes.length,1);w.values.set('ideal-pwa-later-until',String(Date.now()+86400000));w.events.storage({key:'ideal-pwa-later-until'});assert.equal(w.nodes[0].hidden,true);
});
test('public PWA: all public HTML and server shop include shared assets, no Push or form interception',async()=>{
 for(const page of ['index','about','trainers','trainer','shop','product','cart']){
 const html=await readFile(new URL('../'+page+'.html',import.meta.url),'utf8');assert.equal((html.match(/src="\/site\/scripts\/pwa-install.js"/g)||[]).length,1);assert.match(html,/href="\/manifest.webmanifest"/);}
 const shop=await readFile(new URL('../server/views/shop/head.ejs',import.meta.url),'utf8');assert.match(shop,/pwa-install.js/);
 assert.doesNotMatch(source,/requestPermission|pushManager|serviceWorker\.register|\.submit\(|fetch\(/);
});
