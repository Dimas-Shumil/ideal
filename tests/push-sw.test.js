import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../server/modules/push/sw.js',import.meta.url),'utf8');
function worker(){
 const listeners={},shown=[],opened=[];
 const self={location:{origin:'https://ideal.example'},addEventListener:(name,fn)=>listeners[name]=fn,registration:{showNotification:async(...args)=>shown.push(args)},clients:{matchAll:async()=>[],openWindow:async url=>opened.push(url)}};
 vm.runInNewContext(source,{self,URL,Set});return {listeners,shown,opened};
}
test('push SW: invalid JSON still displays a safe notification',async()=>{
 const w=worker();let wait;w.listeners.push({data:{json(){throw Error('invalid');}},waitUntil:p=>wait=p});await wait;assert.equal(w.shown[0][1].data.url,'https://ideal.example/notifications');
});
test('push SW: notification click refuses external, credentials, javascript and non-allowlisted URLs',async()=>{
 for(const url of ['https://evil.example/trainer/lessons','//evil.example/crm/schedule','javascript:alert(1)','https://u:p@ideal.example/crm/schedule','/api/admin/check','/trainer/lessons/../../../logout']){
 const w=worker();let wait;w.listeners.notificationclick({notification:{data:{url},close(){}},waitUntil:p=>wait=p});await wait;assert.equal(w.opened[0],'https://ideal.example/notifications');}
});
test('push SW: internal navigation strips query and fragment',async()=>{
 const w=worker();let wait;w.listeners.notificationclick({notification:{data:{url:'/trainer/lessons?private=true#x'},close(){}},waitUntil:p=>wait=p});await wait;assert.equal(w.opened[0],'https://ideal.example/trainer/lessons');
});
