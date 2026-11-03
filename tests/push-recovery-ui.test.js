import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../site/scripts/notifications.js',import.meta.url),'utf8');
async function fixture({mismatch=false,registered=true,owned=registered,origin='http://localhost:3000',result='sent'}={}){
 const nodes=Object.fromEntries(['[role="status"]','[data-enable]','[data-disable]','[data-reset]','[data-test]'].map(k=>[k,{hidden:true,events:{},addEventListener(n,f){this.events[n]=f;}}]));
 const key=new Uint8Array([4,12,34,56]),calls=[],state={registered,afterTest:false,subscribed:0,unsubscribed:0,permissionRequests:0};
 const makeSub=actual=>({endpoint:'https://fcm.googleapis.com/fcm/send/'+(actual===key?'new':'old'),options:{applicationServerKey:actual},toJSON(){return {endpoint:this.endpoint,keys:{p256dh:'safe',auth:'safe'}};},async unsubscribe(){state.unsubscribed++;sub=null;return true;}});
 let sub=makeSub(mismatch?new Uint8Array([4,9,9,9]):key);
 const registration={pushManager:{getSubscription:async()=>sub,subscribe:async opts=>{state.subscribed++;assert.deepEqual([...opts.applicationServerKey],[...key]);sub=makeSub(key);return sub;}}};
 const config={enabled:true,publicKey:Buffer.from(key).toString('base64url'),origin};
 const Notification={permission:'granted',requestPermission:async()=>{state.permissionRequests++;return 'granted';}};
 await vm.runInNewContext(source,{document:{querySelector:()=>({dataset:{csrf:'safe'},querySelector:s=>nodes[s]})},window:{isSecureContext:true,PushManager:{},Notification,location:{origin:'http://localhost:3000'}},navigator:{serviceWorker:{getRegistration:async()=>registration,register:async()=>registration,ready:Promise.resolve(registration)}},Notification,Uint8Array,ArrayBuffer,atob,setTimeout:cb=>queueMicrotask(cb),fetch:async(url,opts)=>{
  const endpoint=url.split('/').at(-1);calls.push({endpoint,body:opts.body&&JSON.parse(opts.body)});
  let data={};
  if(endpoint==='config')data=config;
  if(endpoint==='status'){
   if(state.afterTest&&result==='expired')state.registered=false;
   data={registered:state.registered,owned,lastTest:state.afterTest&&result==='sent'?{eventKey:'test-current',status:'SENT',lastStatus:201}:null};
  }
  if(endpoint==='unsubscribe')state.registered=false;
  if(endpoint==='subscribe')state.registered=true;
  if(endpoint==='test'){state.afterTest=true;data={queued:true,eventKey:'test-current'};}
  return {ok:true,json:async()=>data};
 }});
 return {state,calls,nodes,click:key=>nodes['[data-'+key+']'].events.click(),text:()=>nodes['[role="status"]'].textContent};
}
test('push UI: stale VAPID key is detected, no silent permission request, click replaces subscription',async()=>{
 const f=await fixture({mismatch:true});assert.match(f.text(),/Ключ сервера изменился/);assert.equal(f.state.subscribed,0);assert.equal(f.state.permissionRequests,0);assert.equal(f.nodes['[data-test]'].hidden,true);
 await f.click('enable');assert.equal(f.state.unsubscribed,1);assert.equal(f.state.subscribed,1);assert.equal(f.nodes['[data-test]'].hidden,false);
});
test('push UI: provider removes expired subscription; test reports repair and reconnect creates a fresh one',async()=>{
 const f=await fixture({result:'expired'});await f.click('test');assert.match(f.text(),/Подписка больше недействительна/);assert.equal(f.nodes['[data-enable]'].hidden,false);assert.equal(f.nodes['[data-reset]'].hidden,false);
 // Stop simulating expiry on subsequent state reads.
 f.state.afterTest=false;await f.click('reset');assert.equal(f.state.unsubscribed,1);assert.equal(f.state.subscribed,1);
});
test('push UI: explicit replacement of unregistered browser subscription does not remove foreign server records',async()=>{
 const f=await fixture({registered:false});await f.click('enable');assert.equal(f.calls.some(c=>c.endpoint==='unsubscribe'),false);assert.equal(f.state.unsubscribed,1);assert.equal(f.state.subscribed,1);
});
test('push UI: queued test is distinguished from provider acceptance',async()=>{
 const f=await fixture();await f.click('test');assert.match(f.text(),/Push-сервис принял/);assert.equal(f.nodes['[data-test]'].disabled,false);
});
test('push UI: different APP_ORIGIN explains configuration mismatch before registration',async()=>{
 const f=await fixture({origin:'http://127.0.0.1:3000'});assert.match(f.text(),/APP_ORIGIN/);assert.equal(f.calls.length,1);assert.equal(f.state.subscribed,0);
});

test('push UI: own stale authVersion subscription is removed before replacement',async()=>{
 const f=await fixture({registered:false,owned:true});await f.click('enable');assert.equal(f.calls.some(c=>c.endpoint==='unsubscribe'),true);assert.equal(f.state.subscribed,1);
});
