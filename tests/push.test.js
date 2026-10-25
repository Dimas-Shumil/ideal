import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { randomBytes, randomUUID, createECDH } from 'node:crypto';
import { readConfig } from '../server/config/env.js';
import { createApp } from '../server/app.js';
import { createDatabase } from '../server/db/client.js';
import { clearCrm } from './helpers/crm.js';
import { pushWorker } from '../server/modules/push/worker.js';
import { enqueueSchedulePush } from '../server/modules/push/events.js';
import { addDays, today } from '../server/modules/crm/dates.js';
import { clubDateTime } from '../server/modules/schedule/dates.js';
import webpush from 'web-push';
const base = readConfig();
if(base.NODE_ENV !== 'test' || !new URL(base.DATABASE_URL).pathname.endsWith('_test')) throw new Error('TEST_DB_REQUIRED');
const vapid=webpush.generateVAPIDKeys();
const config={...base,PUSH_PUBLIC_KEY:vapid.publicKey,PUSH_PRIVATE_KEY:vapid.privateKey,PUSH_SUBJECT:'mailto:test@example.org'};
const db=createDatabase(config.DATABASE_URL), p=db.prisma;
const password=randomBytes(24).toString('hex');
let app,store,users,owner,admin,trainer,other;
function subscription(suffix=randomUUID()) {
 const e=createECDH('prime256v1');e.generateKeys();
 return {endpoint:'https://fcm.googleapis.com/fcm/send/'+suffix,keys:{p256dh:e.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}};
}
async function login(name){
 const agent=request.agent(app), page=await agent.get('/login').expect(200);
 const _csrf=page.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
 await agent.post('/login').set('Origin',config.APP_ORIGIN).type('form').send({login:name,password,_csrf}).expect(303);
 const me=await agent.get('/api/auth/me').expect(200);return {agent,token:me.body.csrf};
}
const post=(s,path,data,status=200)=>s.agent.post(path).set('Origin',config.APP_ORIGIN).set('x-csrf-token',s.token).send(data).expect(status);
async function seed(user=trainer){
 const sub=subscription();const s=await login(user.login);await post(s,'/api/push/subscribe',sub);return {sub,s};
}
async function lesson(){
 const profile=await p.trainerProfile.upsert({where:{userId:trainer.id},create:{userId:trainer.id},update:{}});
 return p.lesson.create({data:{kind:'PERSONAL',title:'PRIVATE CRM',startsAt:clubDateTime(addDays(today(),3),'12:00'),endsAt:clubDateTime(addDays(today(),3),'13:00'),trainerId:profile.id,capacity:1,createdById:owner.id}});
}
async function event(l,action='LESSON_BOOKED',attention=false){
 await p.$transaction(tx=>enqueueSchedulePush(tx,{actorId:admin.id,key:randomUUID()},action,l.id,attention));
}
async function deliver(send,logs=[]){
 const w=pushWorker({prisma:p,config,send,log:x=>logs.push(x)});await w.tick();await w.stop();return logs;
}
before(async()=>{
 await clearCrm(p);await p.auditEvent.deleteMany();await p.authSession.deleteMany();await p.user.deleteMany();
 ({app,store,users}=await createApp({config,db}));
 for(const [loginName,role] of [['pushowner','OWNER'],['pushadmin','ADMIN'],['pushtrainer','TRAINER'],['pushother','TRAINER']]){
  const u=await users.create({login:loginName,displayName:loginName,role,password});
  if(role==='OWNER')owner=u;else if(role==='ADMIN')admin=u;else if(loginName==='pushtrainer')trainer=u;else other=u;
 }
});
beforeEach(async()=>{store.close();({app,store,users}=await createApp({config,db}));await p.pushDelivery.deleteMany();await p.pushSubscription.deleteMany();await p.scheduleEvent.deleteMany();await p.lessonBooking.deleteMany();await p.lesson.deleteMany();});
after(async()=>{store?.close();await clearCrm(p);await p.auditEvent.deleteMany();await p.authSession.deleteMany();await p.user.deleteMany();await db.close();});
test('push: guest page/API and mutations independently guarded',async()=>{
 await request(app).get('/notifications').expect(303);await request(app).get('/api/push/config').expect(401);
 for(const path of ['subscribe','unsubscribe','status'])await request(app).post('/api/push/'+path).send(subscription()).expect(401);
 for(const u of [owner,admin,trainer]){const s=await login(u.login);await s.agent.get('/notifications').expect(200);const r=await s.agent.get('/api/push/config').expect(200);assert.equal(r.body.publicKey,vapid.publicKey);assert.ok(!JSON.stringify(r.body).includes(vapid.privateKey));}
});
test('push: CSRF and strict Origin',async()=>{
 const s=await login(trainer.login),sub=subscription();
 await s.agent.post('/api/push/subscribe').set('Origin',config.APP_ORIGIN).send(sub).expect(403);
 await s.agent.post('/api/push/subscribe').set('Origin','https://evil.example').set('x-csrf-token',s.token).send(sub).expect(403);
 await s.agent.post('/api/push/subscribe').set('x-csrf-token',s.token).send(sub).expect(403);
 assert.equal(await p.pushSubscription.count(),0);
});
test('push: strict DTO rejects mass assignment, arbitrary destinations and malformed keys',async()=>{
 const s=await login(trainer.login);
 for(const extra of [{userId:owner.id},{ownerId:owner.id},{trainerId:other.id},{role:'OWNER'}])await post(s,'/api/push/subscribe',{...subscription(),...extra},400);
 for(const endpoint of ['http://fcm.googleapis.com/a','https://127.0.0.1/a','https://fcm.googleapis.com.evil.example/a','https://fcm.googleapis.com:444/a','https://user:pass@fcm.googleapis.com/a'])await post(s,'/api/push/subscribe',{...subscription(),endpoint},400);
 await post(s,'/api/push/subscribe',{...subscription(),keys:{auth:'bad',p256dh:'bad'}},400);
});
test('push: endpoint replay deduplicates and multiple devices are retained',async()=>{
 const {s,sub}=await seed();await post(s,'/api/push/subscribe',sub);await post(s,'/api/push/subscribe',subscription());
 assert.equal(await p.pushSubscription.count({where:{userId:trainer.id}}),2);
});
test('push: TRAINER ADMIN OWNER cannot claim, query as registered, or remove foreign endpoint',async()=>{
 const {sub}=await seed(other);
 for(const u of [trainer,admin,owner]){const s=await login(u.login);await post(s,'/api/push/subscribe',sub,403);await post(s,'/api/push/unsubscribe',{endpoint:sub.endpoint},403);const r=await post(s,'/api/push/status',{endpoint:sub.endpoint});assert.equal(r.body.registered,false);}
 assert.equal(await p.pushSubscription.count(),1);
});
test('push: unsubscribe is idempotent and cascades queued deliveries',async()=>{
 const {s,sub}=await seed();await event(await lesson());assert.equal(await p.pushDelivery.count(),1);
 await post(s,'/api/push/unsubscribe',{endpoint:sub.endpoint});await post(s,'/api/push/unsubscribe',{endpoint:sub.endpoint});assert.equal(await p.pushDelivery.count(),0);
});
test('push: server revoke works without JavaScript',async()=>{
 const {s}=await seed();await post(s,'/api/push/subscribe',subscription());
 await s.agent.post('/notifications/revoke').set('Origin',config.APP_ORIGIN).type('form').send({_csrf:s.token}).expect(303);assert.equal(await p.pushSubscription.count(),0);
});
test('push: event trainer scope, safe payload, all four event types',async()=>{
 await seed();await seed(other);const l=await lesson();
 for(const action of ['LESSON_BOOKED','BOOKING_CANCELLED','LESSON_CANCELLED','LESSON_MOVED'])await event(l,action);
 const rows=await p.pushDelivery.findMany();assert.equal(rows.length,4);assert.ok(rows.every(r=>r.userId===trainer.id));
 const text=JSON.stringify(rows.map(r=>r.payload));for(const value of ['PRIVATE CRM','phone','birthDate','price','comment',l.id])assert.ok(!text.includes(value));
 assert.ok(rows.every(r=>r.payload.url==='/trainer/lessons'));
});
test('push: administration receives only populated cancellation/move, excludes actor',async()=>{
 await seed(owner);await seed(admin);await seed();const l=await lesson();
 await event(l,'LESSON_BOOKED',true);await event(l,'LESSON_CANCELLED',false);await event(l,'LESSON_MOVED',true);
 assert.equal(await p.pushDelivery.count({where:{userId:owner.id}}),1);assert.equal(await p.pushDelivery.count({where:{userId:admin.id}}),0);
});
test('push: transaction rollback leaves no delivery',async()=>{
 await seed();const l=await lesson();await assert.rejects(p.$transaction(async tx=>{await enqueueSchedulePush(tx,{actorId:admin.id,key:randomUUID()},'LESSON_BOOKED',l.id);throw Error('rollback');}));assert.equal(await p.pushDelivery.count(),0);
});
test('push: real booking replay, cancellation/move events, provider failure leaves booking committed',async()=>{
 await seed();const s=await login(admin.login),l=await lesson();const c=await p.client.create({data:{name:'SECRET CLIENT',phone:'79999999999',birthDate:new Date('1990-01-01')}});
 const key=randomUUID(),data={_csrf:s.token,key,clientId:c.id,reason:''},path='/api/crm/schedule/'+l.id;
 const booked=await post(s,path+'/book',data);await post(s,path+'/book',data);assert.equal(await p.pushDelivery.count(),1);
 await deliver(async()=>{throw {statusCode:503,body:'SECRET',endpoint:'SECRET'};});assert.equal((await p.lessonBooking.findUnique({where:{id:booked.body.bookingId}})).status,'BOOKED');
 await post(s,path+'/move',{_csrf:s.token,key:randomUUID(),version:1,date:addDays(today(),4),startTime:'14:00',endTime:'15:00',room:'',reason:'Перенос'});
 await post(s,path+'/bookings/'+booked.body.bookingId+'/cancel',{_csrf:s.token,key:randomUUID(),reason:'Отмена'});
 await post(s,path+'/cancel',{_csrf:s.token,key:randomUUID(),version:2,reason:'Отмена занятия'});
 assert.equal(await p.pushDelivery.count(),4);
});
for(const status of [404,410])test('push: provider '+status+' removes endpoint without blocking other devices',async()=>{
 const {s}=await seed();await post(s,'/api/push/subscribe',subscription());await event(await lesson());let calls=0;
 await deliver(async()=>{if(++calls===1)throw {statusCode:status};});assert.equal(calls,2);assert.equal(await p.pushSubscription.count(),1);assert.equal(await p.pushDelivery.count({where:{status:'SENT'}}),1);
});
test('push: transient retry, bounded attempts, safe logs',async()=>{
 await seed();await event(await lesson());let calls=0;const logs=[];
 for(let i=0;i<6;i++){await p.pushDelivery.updateMany({where:{status:'PENDING'},data:{availableAt:new Date(0)}});await deliver(async()=>{calls++;throw {statusCode:503,message:vapid.privateKey,body:'SECRET_ENDPOINT'};},logs);}
 assert.equal(calls,5);assert.equal((await p.pushDelivery.findFirst()).status,'FAILED');assert.ok(!JSON.stringify(logs).includes(vapid.privateKey));assert.ok(!JSON.stringify(logs).includes('SECRET_ENDPOINT'));
});
test('push: success is not sent again on replayed worker tick',async()=>{
 await seed();await event(await lesson());let calls=0;const send=async()=>{calls++;};await deliver(send);await deliver(send);assert.equal(calls,1);assert.ok((await p.pushSubscription.findFirst()).lastSuccessAt);
});
test('push: inactive, authVersion and role mismatches skip queued messages',async()=>{
 for(const change of [{active:false},{authVersion:2},{role:'ADMIN'}]){
  await p.user.update({where:{id:trainer.id},data:{active:true,authVersion:1,role:'TRAINER'}});await seed();await event(await lesson());
  await p.user.update({where:{id:trainer.id},data:change});let calls=0;await deliver(async()=>{calls++;});assert.equal(calls,0);
  await p.pushSubscription.deleteMany();await p.lesson.deleteMany();
 }
 await p.user.update({where:{id:trainer.id},data:{active:true,authVersion:1,role:'TRAINER'}});
});
test('push: userService access changes revoke subscriptions and deliveries',async()=>{
 await seed(other);await users.change(other.id,{active:false});assert.equal(await p.pushSubscription.count({where:{userId:other.id}}),0);await users.change(other.id,{active:true});
});
test('push: concurrent worker claims deliver once per device',async()=>{
 await seed();await event(await lesson());let calls=0;await Promise.all([deliver(async()=>{calls++;}),deliver(async()=>{calls++;})]);assert.equal(calls,1);
});
test('push: service worker route is JS only and retains Push with bounded PWA caching',async()=>{
 const r=await request(app).get('/push-sw.js').expect(200);assert.match(r.headers['content-type'],/javascript/);assert.match(r.text,/notificationclick/);assert.match(r.text,/ideal-pwa-offline-/);assert.match(r.text,/request.method !== 'GET'/);
});
test('push: disabled configuration keeps page available but refuses new registration',async()=>{
 store.close();({app,store,users}=await createApp({config:{...config,PUSH_PUBLIC_KEY:'',PUSH_PRIVATE_KEY:''},db}));
 const s=await login(trainer.login);await s.agent.get('/notifications').expect(200);await post(s,'/api/push/subscribe',subscription(),503);assert.equal(await p.pushSubscription.count(),0);
});
test('push: provider permanent rejection and expired events never retry indefinitely',async()=>{
 await seed();await event(await lesson());await deliver(async()=>{throw {statusCode:400};});assert.equal((await p.pushDelivery.findFirst()).status,'FAILED');
 await p.pushDelivery.deleteMany();const l=await p.lesson.findFirst();await event(l);await p.pushDelivery.updateMany({data:{createdAt:new Date(Date.now()-2*86400000)}});let calls=0;await deliver(async()=>{calls++;});assert.equal(calls,0);assert.equal((await p.pushDelivery.findFirst()).status,'SKIPPED');
});
test('push: expired lease recovers and exhausted crashed claim becomes FAILED',async()=>{
 await seed();await event(await lesson());await p.pushDelivery.updateMany({data:{status:'SENDING',attempts:1,availableAt:new Date(0)}});let calls=0;await deliver(async()=>{calls++;});assert.equal(calls,1);
 await p.pushDelivery.updateMany({data:{status:'SENDING',attempts:5,availableAt:new Date(0)}});await deliver(async()=>{calls++;});assert.equal(calls,1);assert.equal((await p.pushDelivery.findFirst()).status,'FAILED');
});
