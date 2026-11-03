import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import {randomUUID} from 'node:crypto';
import {pushRoutes} from '../server/modules/push/routes.js';
const endpoint='https://fcm.googleapis.com/fcm/send/test-device';
function fixture({foreign=false,stale=false}={}){
 const user={id:randomUUID(),role:'TRAINER',authVersion:2};let deliveryReads=0;
 const prisma={pushSubscription:{findFirst:async q=>{
  assert.deepEqual(q.where,{endpoint,userId:user.id});return foreign?null:{id:'subscription',role:'TRAINER',authVersion:stale?1:2};
 }},pushDelivery:{findFirst:async q=>{deliveryReads++;assert.equal(q.where.userId,user.id);assert.equal(q.where.subscriptionId,'subscription');assert.deepEqual(Object.keys(q.select).sort(),['eventKey','lastStatus','status']);return {eventKey:'PUSH_TEST:own',status:'SENT',lastStatus:201};}}};
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user=user;req.session={csrf:'a'.repeat(64)};next();});app.use(pushRoutes({config:{APP_ORIGIN:'http://localhost',PUSH_PUBLIC_KEY:'public',PUSH_PRIVATE_KEY:'private'},prisma}));app.use((e,req,res,next)=>res.sendStatus(e.status||(e.name==='ZodError'?400:500)));
 return {app,reads:()=>deliveryReads,send:()=>request(app).post('/api/push/status').set('Origin','http://localhost').set('x-csrf-token','a'.repeat(64)).send({endpoint})};
}
test('push status exposes current device result and no payload or foreign account information',async()=>{
 const f=fixture(),r=await f.send().expect(200);assert.deepEqual(r.body,{registered:true,owned:true,lastTest:{eventKey:'PUSH_TEST:own',status:'SENT',lastStatus:201}});assert.equal(f.reads(),1);
});
test('push status: a foreign or deleted endpoint has no delivery metadata',async()=>{
 const f=fixture({foreign:true}),r=await f.send().expect(200);assert.deepEqual(r.body,{registered:false,owned:false,lastTest:null});assert.equal(f.reads(),0);
});
test('push status: own outdated authVersion is repairable but not registered',async()=>{
 const f=fixture({stale:true}),r=await f.send().expect(200);assert.deepEqual(r.body,{registered:false,owned:true,lastTest:null});assert.equal(f.reads(),0);
});
test('push status retains strict Origin/CSRF; config exposes the configured public origin',async()=>{
 const f=fixture();await request(f.app).post('/api/push/status').send({endpoint}).expect(403);
 const r=await request(f.app).get('/api/push/config').expect(200);assert.equal(r.body.origin,'http://localhost');assert.equal(r.body.publicKey,'public');assert.doesNotMatch(JSON.stringify(r.body),/private/);
});
