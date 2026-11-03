import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import ejs from 'ejs';
import {randomUUID} from 'node:crypto';
import {authRoutes} from '../server/modules/auth/routes.js';
import {trainerRoutes} from '../server/modules/trainer/routes.js';
test('TRAINER account and both password endpoints are denied before database/password operations',async()=>{
 let reads=0;const app=express(),id=randomUUID();app.use(express.json());
 app.use((req,res,next)=>{req.user={id,role:req.get('X-Role')||'TRAINER',login:'trainer',displayName:'Тренер'};req.session={csrf:'a'.repeat(64)};next();});
 app.use(await authRoutes({config:{APP_ORIGIN:'http://localhost'},prisma:{user:{findUnique:async()=>{reads++;throw Error('UNEXPECTED_DB');}}},store:{},users:{}}));app.use(trainerRoutes());app.use((e,req,res,next)=>res.sendStatus(e.status||500));
 await request(app).get('/trainer/account').expect(403);
 for(const path of ['/api/auth/password','/trainer/account/password','/admin/account/password'])await request(app).post(path).set('Origin','http://localhost').send({_csrf:'a'.repeat(64),currentPassword:'valid-current-password',newPassword:'valid-new-password'}).expect(403);
 assert.equal(reads,0);
 // OWNER/ADMIN still reach normal validation in their own shared password endpoint.
 for(const role of ['OWNER','ADMIN'])await request(app).post('/api/auth/password').set('X-Role',role).set('Origin','http://localhost').send({_csrf:'a'.repeat(64),currentPassword:'',newPassword:''}).expect(400);
});
test('navigation removes the trainer account entry and retains OWNER/ADMIN account links',async()=>{
 for(const role of ['TRAINER','OWNER','ADMIN']){
  const html=await ejs.renderFile('server/views/partials/panel-nav.ejs',{user:{role},currentPath:'/trainer'});
  assert.equal(html.includes('href="/trainer/account"'),false);
  assert.equal(html.includes('href="/admin/account"'),role!=='TRAINER');
 }
});
