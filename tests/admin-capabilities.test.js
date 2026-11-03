// In-memory transaction and HTTP fixtures. These do not replace PostgreSQL integration tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import request from 'supertest';
import {contentService} from '../server/modules/content/service.js';
import {crmService} from '../server/modules/crm/service.js';
import {shopService} from '../server/modules/shop/service.js';
import {scheduleService} from '../server/modules/schedule/service.js';
import {trainerProfileService} from '../server/modules/trainers/service.js';
import {trainerFields,profileBody} from '../server/modules/trainers/schema.js';
import {trainerManagementRoutes} from '../server/modules/trainers/routes.js';
import {contentManagementRoutes} from '../server/modules/content/routes.js';
import {crmRoutes} from '../server/modules/crm/routes.js';
import {shopRoutes} from '../server/modules/shop/routes.js';
import {scheduleRoutes} from '../server/modules/schedule/routes.js';
import {ownerRoutes} from '../server/modules/owner/routes.js';

const profileInput={...Object.fromEntries(Object.keys(trainerFields).map(k=>[k,''])),publicName:'Тренер',publicOrder:0,phone:'+7 (999) 123-45-67',vkUrl:'https://vk.com/coach',maxUrl:'https://max.ru/u/coach'};
const planInput={name:'Тестовый тариф',kind:'GYM',price:'3000',months:'1',days:'0',visits:'0',weekdays:'1,2,3,4,5,6,7',fromTime:'08:00',toTime:'22:00',giftGym:'false',duo:'false',active:'true',publicVisible:'true',publicOrder:0};
function fixture(role='ADMIN'){
 const actor={id:randomUUID(),role,active:true,authVersion:1,displayName:'Администратор'};
 const id=randomUUID(), writes=[],audits=[];
 const row={id,version:1,publicVersion:1,key:'gym',kind:'GROUP',status:'SCHEDULED',startsAt:new Date(Date.now()+3600000),endsAt:new Date(Date.now()+7200000),trainerId:randomUUID(),user:{role:'TRAINER',active:true}};
 const model={findUnique:async()=>({...row}),findFirst:async()=>({...row}),findMany:async()=>[],count:async()=>0,create:async({data})=>{writes.push(data);return {...row,...data};},update:async({data})=>{writes.push(data);return {...row,...data};}};
 const tx={$executeRaw:async()=>1,user:{findUnique:async()=>actor,findMany:async()=>[],count:async()=>0},authSession:{findFirst:async()=>({})},crmOperation:{findUnique:async()=>null,create:async()=>{}},auditEvent:{create:async({data})=>audits.push(data)},crmEvent:{create:async()=>{}},scheduleEvent:{create:async()=>{}},contentEntry:model,trainerProfile:model,membershipPlan:model,shopProduct:model,lesson:model};
 const prisma={...tx,$transaction:async cb=>Array.isArray(cb)?Promise.all(cb):cb(tx)};
 const ctx=()=>({actorId:actor.id,authVersion:1,sessionId:'session',version:1,key:randomUUID()});
 const actions=[
  ()=>contentService(prisma).save(ctx(),'gym',{publicOrder:0,title:'Зал',summary:'Описание',body:'Подробности'}),
  ()=>crmService(prisma).savePlan(ctx(),null,planInput),
  ()=>shopService(prisma).saveProduct(ctx(),null,{name:'Товар',category:'Категория',description:'',characteristics:'',active:'true'}),
  ()=>trainerProfileService(prisma).save(ctx(),id,profileInput),
  ()=>scheduleService(prisma).publish(ctx(),id,{visible:'true',lessons:id+':1',confirm:'PUBLIC'}),
 ];
 return {actor,id,prisma,tx,actions,writes,audits};
}
test('ADMIN saves public content, products, tariffs and contacts, and publishes schedule with audit',async()=>{
 const f=fixture();for(const action of f.actions)await action();
 assert.equal(f.audits.length,5);
 assert.ok(f.writes.some(v=>v.vkUrl===profileInput.vkUrl));
 assert.ok(f.writes.some(v=>v.publicVisible===true));
});
test('all newly allowed mutations recheck TRAINER, inactive account, authVersion and revoked session',async()=>{
 for(const patch of [{role:'TRAINER'},{active:false},{authVersion:2},{expired:true}]){
  const f=fixture();Object.assign(f.actor,patch);
  if(patch.expired) f.tx.authSession.findFirst=async()=>null;
  for(const action of f.actions)await assert.rejects(action,e=>e.status===403);
  assert.equal(f.writes.length,0);assert.equal(f.audits.length,0);
 }
});
test('public contact validation rejects scripts, wrong hosts, credentials, ports and invalid phones',()=>{
 assert.equal(profileBody.parse(profileInput).phone,profileInput.phone);
 for(const vkUrl of ['javascript:alert(1)','https://vk.com.evil.test/coach','http://vk.com/coach','https://x@vk.com/coach','https://vk.com:444/coach'])assert.equal(profileBody.safeParse({...profileInput,vkUrl}).success,false);
 assert.equal(profileBody.safeParse({...profileInput,maxUrl:'https://t.me/coach'}).success,false);
 assert.equal(profileBody.safeParse({...profileInput,phone:'<script>'}).success,false);
 assert.equal(profileBody.parse({...profileInput,phone:'',vkUrl:'',maxUrl:''}).phone,'');
});
test('ADMIN HTTP: editor pages and API work; employee list, create and privilege changes remain forbidden',async()=>{
 const f=fixture();const app=express();app.set('views','server/views');app.set('view engine','ejs');
 app.use(express.urlencoded({extended:false}));
 app.use((req,res,next)=>{req.user=f.actor;req.session={csrf:'a'.repeat(64)};req.sessionID='session';res.locals.currentPath=req.path;next();});
 const deps={config:{APP_ORIGIN:'http://localhost'},prisma:f.prisma,users:{}};
 app.use(contentManagementRoutes(deps));app.use(crmRoutes(deps));app.use(scheduleRoutes(deps));app.use(shopRoutes(deps));app.use(trainerManagementRoutes(deps));app.use(ownerRoutes(deps));
 app.use((err,req,res,next)=>res.sendStatus(err.status||500));
 for(const path of ['/admin/content','/admin/public-trainers','/crm/plans/new','/shop-panel/products/new','/admin/account']){
  const r=await request(app).get(path).expect(200);
  assert.match(r.text,/staff-manifest.webmanifest/);assert.match(r.text,/data-pwa-staff/);
  assert.doesNotMatch(r.text,/href="\/admin\/employees"/);
 }
 await request(app).get('/api/shop-panel/products').expect(200);
 for(const path of ['/admin/employees','/admin/employees/new','/admin/employees/'+f.id,'/api/admin/employees'])await request(app).get(path).expect(403);
 for(const path of ['/admin/employees','/api/admin/employees',...['name','role','active'].map(x=>'/api/admin/employees/'+f.id+'/'+x)])await request(app).post(path).expect(403);
});
