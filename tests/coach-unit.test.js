import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import request from 'supertest';
import {coachFixture} from './helpers/coach-fixture.js';
import {coachRoutes} from '../server/modules/coach/routes.js';
import {monthRange,sessionBody,localDateTime} from '../server/modules/coach/schema.js';
import {clubParts} from '../server/modules/schedule/dates.js';
import {today} from '../server/modules/crm/dates.js';
import {enqueueCoachReminders,coachReminderIsCurrent,coachReminderKey,coachReminderSent} from '../server/modules/coach/reminders.js';
const clientInput={name:'Личный клиент',phone:'+7 (999) 123-45-67',notes:'Заметка',archived:'false'};
const taskInput={title:'Задача тренера',dueAt:'',reminderAt:'',comment:'',priority:'IMPORTANT',completed:'false'};
const expenseInput={title:'Инвентарь',category:'Оборудование',expenseDate:today(),amount:'500.25',comment:''};
async function client(f,i=0){return (await f.service.save(f.ctx(i),'clients',null,clientInput)).id;}
function sessionInput(clientId,delta=-2){const p=clubParts(new Date(Date.now()+delta*86400000));return {clientId,startsAt:p.date+'T10:00',endsAt:p.date+'T11:00',price:'2000.50',status:delta<0?'COMPLETED':'SCHEDULED',comment:'',reminderMinutes:'180'};}
test('coach schema: exact money, Abakan month boundaries, dates and no identity injection',()=>{
 const r=monthRange('2026-11');assert.equal(r.gte.toISOString(),'2026-10-31T17:00:00.000Z');assert.equal(r.lt.toISOString(),'2026-11-30T17:00:00.000Z');assert.throws(()=>monthRange('2026-13'));assert.throws(()=>monthRange('0000-01'));
 assert.equal(localDateTime.parse('2026-11-03T18:30').toISOString(),'2026-11-03T11:30:00.000Z');assert.throws(()=>localDateTime.parse('2026-02-30T12:00'));
 const d=sessionInput(randomUUID());assert.equal(sessionBody.parse(d).price,200050);
 for(const extra of [{price:'-1'},{price:'2.001'},{endsAt:d.startsAt},{userId:randomUUID()},{status:'INVALID'}])assert.equal(sessionBody.safeParse({...d,...extra}).success,false);
 assert.equal(sessionBody.safeParse({...sessionInput(randomUUID(),10),status:'COMPLETED'}).success,false);
});
test('coach writes: identical replay, stale form, cross-trainer IDs and audit rollback',async()=>{
 const f=coachFixture(),id=await client(f),c=f.ctx(0,{version:1});
 await f.service.save(c,'clients',id,{...clientInput,name:'Исправлено'});await f.service.save(c,'clients',id,{...clientInput,name:'Исправлено'});assert.equal(f.state.coachClient[0].version,2);assert.equal(f.state.audits.length,2);
 await assert.rejects(()=>f.service.save(c,'clients',id,clientInput),e=>e.status===409);
 await assert.rejects(()=>f.service.save(f.ctx(0,{version:1}),'clients',id,clientInput),e=>e.status===409);
 await assert.rejects(()=>f.service.save(f.ctx(1,{version:2}),'clients',id,clientInput),e=>e.status===404);
 await assert.rejects(()=>f.service.form(f.ctx(1),null,'clients',id),e=>e.status===404);
 await assert.rejects(()=>f.service.page(f.ctx(1),f.state.user[0].id,'clients',{}),e=>e.status===404);
 f.state.auditDown=true;await assert.rejects(()=>f.service.save(f.ctx(),'tasks',null,taskInput),/AUDIT_DOWN/);assert.equal(f.state.coachTask.length,0);
});
test('coach sessions: foreign client forbidden, own and club collisions, different coaches independent',async()=>{
 const f=coachFixture(),a=await client(f),b=await client(f,1),d=sessionInput(a,10);
 await assert.rejects(()=>f.service.save(f.ctx(),'sessions',null,{...d,clientId:b}),e=>e.status===404);await f.service.save(f.ctx(),'sessions',null,d);
 await assert.rejects(()=>f.service.save(f.ctx(),'sessions',null,d),e=>e.status===409);
 f.state.lesson.push({id:randomUUID(),trainer:{userId:f.state.user[1].id},startsAt:localDateTime.parse(d.startsAt),endsAt:localDateTime.parse(d.endsAt),status:'SCHEDULED'});
 await assert.rejects(()=>f.service.save(f.ctx(1),'sessions',null,{...d,clientId:b}),e=>e.status===409);
 f.state.lesson=[];await f.service.save(f.ctx(1),'sessions',null,{...d,clientId:b});assert.equal(f.state.coachSession.length,2);
});
test('coach finances: own completed income and expenses, owner summaries; ADMIN denied',async()=>{
 const f=coachFixture(),a=await client(f),b=await client(f,1),d=sessionInput(a);
 await f.service.save(f.ctx(),'sessions',null,d);await f.service.save(f.ctx(1),'sessions',null,{...d,clientId:b,price:'9999'});await f.service.save(f.ctx(),'expenses',null,expenseInput);
 const month=d.startsAt.slice(0,7),p=await f.service.page(f.ctx(),null,'overview',{month});assert.equal(p.stats.incomeCents,200050);assert.equal(p.stats.expenseCents,month===today().slice(0,7)?50025:0);
 assert.equal((await f.service.page(f.ctx(1),null,'overview',{month})).stats.incomeCents,999900);
 const list=await f.service.owners(f.ctx(2),{month});assert.equal(list.rows.length,2);assert.equal(list.rows.find(x=>x.id===f.state.user[0].id).stats.incomeCents,200050);
 assert.equal((await f.service.page(f.ctx(2),f.state.user[0].id,'clients',{})).items.length,1);
 await assert.rejects(()=>f.service.owners(f.ctx(0),{}),e=>e.status===403);await assert.rejects(()=>f.service.page(f.ctx(3),f.state.user[0].id,'overview',{}),e=>e.status===403);await assert.rejects(()=>f.service.save(f.ctx(2),'clients',null,clientInput),e=>e.status===403);
});
test('coach reads/writes recheck role, authVersion, active account and session',async()=>{
 for(const change of ['inactive','role','version','session']){const f=coachFixture(),c=f.ctx();if(change==='inactive')f.state.user[0].active=false;if(change==='role')f.state.user[0].role='ADMIN';if(change==='version')f.state.user[0].authVersion++;if(change==='session')f.state.sessionActive=false;await assert.rejects(()=>f.service.save(c,'clients',null,clientInput),e=>e.status===403);await assert.rejects(()=>f.service.page(c,null,'clients',{}),e=>e.status===403);assert.equal(f.state.coachClient.length,0);}
});
test('coach tasks/expenses: complete and delete need owner, current version and explicit confirm',async()=>{
 const f=coachFixture(),t=await f.service.save(f.ctx(),'tasks',null,taskInput);await f.service.save(f.ctx(0,{version:1}),'tasks',t.id,{...taskInput,completed:'true'});assert.ok(f.state.coachTask[0].completedAt);
 await assert.rejects(()=>f.service.save(f.ctx(1,{version:2}),'tasks',t.id,{confirm:'DELETE'},true),e=>e.status===404);await assert.rejects(()=>f.service.save(f.ctx(0,{version:2}),'tasks',t.id,{confirm:'yes'},true));await f.service.save(f.ctx(0,{version:2}),'tasks',t.id,{confirm:'DELETE'},true);assert.equal(f.state.coachTask.length,0);
 const e=await f.service.save(f.ctx(),'expenses',null,expenseInput);await f.service.save(f.ctx(0,{version:1}),'expenses',e.id,{confirm:'DELETE'},true);assert.equal(f.state.coachExpense.length,0);
 const id=await client(f);await f.service.save(f.ctx(0,{version:1}),'clients',id,{...clientInput,archived:'true'});assert.equal((await f.service.page(f.ctx(),null,'clients',{})).total,0);assert.equal((await f.service.page(f.ctx(),null,'clients',{archived:'true'})).total,1);
});
function appFixture(f,index){const a=express();a.set('views','server/views');a.set('view engine','ejs');a.use(express.urlencoded({extended:false}));a.use(express.json());a.use((req,res,next)=>{if(index!==null)req.user=f.state.user[index];req.session={csrf:'a'.repeat(64)};req.sessionID='valid';res.locals.currentPath=req.path;next();});a.use(coachRoutes({config:{APP_ORIGIN:'http://localhost'},prisma:f.prisma}));a.use((req,res)=>res.sendStatus(404));a.use((e,req,res,next)=>{if(!e.status&&e.name!=='ZodError')console.error(e);res.sendStatus(e.status||(e.name==='ZodError'?400:500));});return a;}
test('coach HTTP: protected SSR pages and forms, strict query and CSRF, owner read-only views',async()=>{
 const f=coachFixture(),id=await client(f);await client(f,1);const a=appFixture(f,0),b=appFixture(f,1),o=appFixture(f,2),admin=appFixture(f,3),guest=appFixture(f,null),path='/api/trainer/workspace/clients';
 await request(guest).get(path).expect(401);await request(admin).get(path).expect(403);await request(a).get(path+'?userId='+f.state.user[1].id).expect(400);await request(b).get(path+'/'+id).expect(404);
 for(const p of ['','/clients','/sessions','/expenses','/tasks','/calendar','/statistics','/clients/new','/sessions/new','/expenses/new','/tasks/new']){const r=await request(a).get('/trainer/workspace'+p).expect(200);assert.match(r.text,/staff-manifest.webmanifest/);assert.doesNotMatch(r.text,/Работа тренеров|Тренер Б|ownerId/);}
 const ownerPath='/admin/trainer-workspaces/'+f.state.user[0].id;await request(a).get(ownerPath).expect(403);await request(admin).get(ownerPath).expect(403);await request(o).get(ownerPath).expect(200);await request(o).get('/admin/trainer-workspaces').expect(200);
 const form=await request(o).get(ownerPath+'/clients/'+id).expect(200);assert.match(form.text,/<fieldset disabled>/);assert.doesNotMatch(form.text,/Сохранить изменения/);
 await request(a).post(path).send({_csrf:'a'.repeat(64),key:randomUUID(),...clientInput}).expect(403);
 const send=values=>request(a).post(path).set('Origin','http://localhost').send({_csrf:'a'.repeat(64),key:randomUUID(),...values});await send({...clientInput,userId:f.state.user[1].id}).expect(400);await send({...clientInput,name:'Добавлен через API'}).expect(200);
 await request(o).post('/api'+ownerPath+'/clients').expect(404);
});
test('coach reminders: own devices only, deduplication, persistent sent marker and stale cancellation',async()=>{
 const f=coachFixture(),now=new Date(),row={id:randomUUID(),userId:f.state.user[0].id,startsAt:new Date(now.getTime()+3600000),reminderMinutes:120,reminderSentAt:null,status:'SCHEDULED'};f.state.coachSession.push(row);f.state.coachTask.push({id:randomUUID(),userId:row.userId,title:'PRIVATE_TASK',completed:false,reminderAt:new Date(now.getTime()-60000),reminderSentAt:null});f.state.subscriptions.push({id:'a',userId:row.userId,role:'TRAINER',authVersion:1},{id:'b',userId:f.state.user[1].id,role:'TRAINER',authVersion:1});
 assert.equal(await enqueueCoachReminders(f.prisma,now),2);assert.equal(await enqueueCoachReminders(f.prisma,now),0);assert.ok(f.state.deliveries.every(d=>d.subscriptionId==='a'));assert.doesNotMatch(JSON.stringify(f.state.deliveries.map(x=>x.payload)),/PRIVATE_TASK|price|phone/);
 const d=f.state.deliveries.find(d=>d.eventKey===coachReminderKey('SESSION',row));assert.equal(await coachReminderIsCurrent(f.prisma,d,now),true);row.status='CANCELLED';assert.equal(await coachReminderIsCurrent(f.prisma,d,now),false);row.status='SCHEDULED';await coachReminderSent(f.prisma,d,now);assert.ok(row.reminderSentAt);assert.equal(await enqueueCoachReminders(f.prisma,now),0);row.startsAt=new Date(row.startsAt.getTime()+3600000);assert.equal(await coachReminderIsCurrent(f.prisma,d,now),false);
});
