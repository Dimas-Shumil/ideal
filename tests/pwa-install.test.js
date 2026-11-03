import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../site/scripts/pwa-install.js',import.meta.url),'utf8');
function setup({stored={},standalone=false,blocked=false,hidden=false,ios=false,staff=false}={}){
 const events={},timers=[],nodes=[],values=new Map(Object.entries(stored));
 class Node{
  constructor(tag){this.tag=tag;this.children=[];this.events={};this.dataset={};this.hidden=false;this.scrollHeight=100;this.clientHeight=100;}
  append(...children){this.children.push(...children);}
  click(){return this.events.click?.();}
  setAttribute(){}
  addEventListener(n,f){this.events[n]=f;}
 }
 const document={currentScript:{hasAttribute:()=>staff},documentElement:{hasAttribute:()=>false,classList:{contains:()=>false}},hidden,body:{append:n=>nodes.push(n)},createElement:n=>new Node(n),addEventListener:(n,f)=>events[n]=f,removeEventListener:n=>delete events[n]};
 const window={isSecureContext:true,setInterval:()=>0,addEventListener:(n,f)=>events[n]=f};
 const localStorage={getItem:k=>{if(blocked)throw Error();return values.get(k)??null;},setItem:(k,v)=>{if(blocked)throw Error();values.set(k,v);}};
 vm.runInNewContext(source,{window,navigator:{serviceWorker:{},standalone,userAgent:ios?'iPhone':'Chrome',platform:'',maxTouchPoints:0},document,localStorage,matchMedia:()=>({matches:standalone}),setTimeout:(f,ms)=>timers.push({f,ms}),Date});
 return {events,timers,nodes,values,document,show:()=>timers[0].f(),button:()=>nodes[0].children[1].children[0],later:()=>nodes[0].children[1].children[1],close:()=>nodes[0].children[2],hint:()=>nodes[0].children[0].children[2]};
}
test('public PWA: banner appears only after 10 seconds without focus transfer',()=>{
 const w=setup();assert.equal(w.nodes.length,0);assert.equal(w.timers[0].ms,10000);w.show();assert.equal(w.nodes.length,1);assert.doesNotMatch(source,/\.focus\(/);
});
test('public PWA: Later dismisses this page; next visit ignores legacy seven-day cooldown',()=>{
 const stored={'ideal-pwa-later-until':String(Date.now()+7*86400000)};
 const w=setup({stored});w.show();assert.equal(w.nodes.length,1);w.later().events.click();assert.equal(w.nodes[0].hidden,true);
 assert.equal(w.values.get('ideal-pwa-later-until'),stored['ideal-pwa-later-until']);
 const next=setup({stored:Object.fromEntries(w.values)});next.show();assert.equal(next.nodes.length,1);
});
test('public PWA: standalone, known installed and appinstalled suppress the banner',()=>{
 for(const options of [{standalone:true},{stored:{'ideal-pwa-installed':'1'}}]){const w=setup(options);w.show();assert.equal(w.nodes.length,0);}
 const w=setup();w.show();w.events.appinstalled();assert.equal(w.nodes[0].hidden,true);assert.equal(w.values.get('ideal-pwa-installed'),'1');
});
test('public PWA: native prompt requires explicit click; dismissal is page-local',async()=>{
 const w=setup();let calls=0,prevented=0;w.events.beforeinstallprompt({preventDefault:()=>prevented++,prompt:async()=>calls++,userChoice:Promise.resolve({outcome:'dismissed'})});w.show();assert.equal(calls,0);await w.button().events.click();assert.equal(calls,1);assert.equal(prevented,1);assert.equal(w.nodes[0].hidden,true);assert.equal(w.values.has('ideal-pwa-later-until'),false);const next=setup({stored:Object.fromEntries(w.values)});next.show();assert.equal(next.nodes.length,1);
});
test('public PWA: missing or failed native prompt shows instructions, including iPhone',async()=>{
 const w=setup({ios:true});w.show();await w.button().events.click();assert.equal(w.hint().hidden,false);assert.match(w.hint().textContent,/На экран Домой/);
 const failed=setup();failed.events.beforeinstallprompt({preventDefault(){},prompt:async()=>{throw Error();}});failed.show();await failed.button().events.click();assert.equal(failed.hint().hidden,false);assert.equal(failed.button().disabled,false);
});
test('public PWA: storage denial is harmless; Escape dismisses within current page',()=>{
 const w=setup({blocked:true});w.show();w.nodes[0].events.keydown({key:'Escape',preventDefault(){}});assert.equal(w.nodes[0].hidden,true);
});
test('public PWA: background page waits for visibility; installation in another tab hides banner',()=>{
 const w=setup({hidden:true});w.show();assert.equal(w.nodes.length,0);w.document.hidden=false;w.events.visibilitychange();assert.equal(w.nodes.length,1);w.values.set('ideal-pwa-installed','1');w.events.storage({key:'ideal-pwa-installed'});assert.equal(w.nodes[0].hidden,true);
});
test('public PWA: all public HTML and server shop include shared assets, no Push or form interception',async()=>{
 for(const page of ['index','about','trainers','trainer','shop','product','cart']){
 const html=await readFile(new URL('../'+page+'.html',import.meta.url),'utf8');assert.equal((html.match(/src="\/site\/scripts\/pwa-install.js"/g)||[]).length,1);assert.match(html,/href="\/manifest.webmanifest"/);}
 const shop=await readFile(new URL('../server/views/shop/head.ejs',import.meta.url),'utf8');assert.match(shop,/pwa-install.js/);
 assert.doesNotMatch(source,/requestPermission|pushManager|serviceWorker\.register|\.submit\(|fetch\(/);
});

test('public PWA: native availability overrides stale installed mark',()=>{
 const w=setup({stored:{'ideal-pwa-installed':'1'}});
 w.events.beforeinstallprompt({preventDefault(){}});w.show();assert.equal(w.nodes.length,1);
});
test('public PWA: close button hides banner without persisting refusal',()=>{
 const w=setup();w.show();w.close().events.click();assert.equal(w.nodes[0].hidden,true);assert.equal(w.values.size,0);
});
function swipe(w,dx,dy,{button=false,multiple=false,cancel=false}={}){
 const banner=w.nodes[0];
 banner.events.touchstart({touches:[{clientX:150,clientY:150}],target:{closest:()=>button}});
 if(multiple)banner.events.touchmove({touches:[{},{}]});
 if(cancel)banner.events.touchcancel();
 banner.events.touchend({touches:[],changedTouches:[{clientX:150+dx,clientY:150+dy}]});
}
test('public PWA: swipe up or either side closes banner and next page shows it again',()=>{
 for(const [dx,dy] of [[0,-80],[80,0],[-80,0]]){
  const w=setup();w.show();swipe(w,dx,dy);assert.equal(w.nodes[0].hidden,true);assert.equal(w.values.size,0);
  const next=setup();next.show();assert.equal(next.nodes.length,1);
 }
});
test('public PWA: short/diagonal/down gestures, buttons and multitouch do not dismiss',()=>{
 for(const [dx,dy,options] of [[10,-10,{}],[60,-60,{}],[0,80,{}],[80,0,{button:true}],[80,0,{multiple:true}],[80,0,{cancel:true}]]){
  const w=setup();w.show();swipe(w,dx,dy,options);assert.equal(w.nodes[0].hidden,false);
 }
});
test('public PWA: overflowing instructions retain vertical scrolling and horizontal dismissal',()=>{
 const w=setup();w.show();w.nodes[0].scrollHeight=300;swipe(w,0,-80);assert.equal(w.nodes[0].hidden,false);
 swipe(w,80,0);assert.equal(w.nodes[0].hidden,true);
});

test('staff PWA: separate installed state and staff label; public app does not suppress staff install',()=>{
 const w=setup({staff:true,stored:{'ideal-pwa-installed':'1'}});w.show();
 assert.equal(w.nodes.length,1);
 assert.equal(w.nodes[0].children[0].children[0].textContent,'ИДЕАЛ — Управление клубом');
 assert.equal(w.nodes[0].dataset.pwaPhase,'day');
 w.events.appinstalled();
 assert.equal(w.values.get('ideal-staff-pwa-installed'),'1');
 assert.equal(w.nodes[0].hidden,true);
 const installed=setup({staff:true,stored:{'ideal-staff-pwa-installed':'1'}});installed.show();assert.equal(installed.nodes.length,0);
});

test('staff PWA: application screen requests the same native prompt, banner is created only once',async()=>{
 const w=setup({staff:true});let calls=0;
 w.events.beforeinstallprompt({preventDefault(){},prompt:async()=>{calls++;},userChoice:Promise.resolve({outcome:'dismissed'})});
 assert.equal(calls,0);w.events['ideal-staff-install']();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls,1);assert.equal(w.nodes.length,1);assert.equal(w.nodes[0].hidden,true);
 w.show();assert.equal(w.nodes.length,1);
});
