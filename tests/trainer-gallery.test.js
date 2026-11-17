import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import sharp from 'sharp';
import ejs from 'ejs';
import { galleryService } from '../server/modules/trainer-gallery/service.js';
import { trainerGalleryRoutes } from '../server/modules/trainer-gallery/routes.js';
import { publicTrainerRoutes } from '../server/modules/public/trainers.js';
function fixture() {
  const trainerId = randomUUID(), actorId = randomUUID(), own = randomUUID(), foreign = randomUUID();
  const rows = [{ id: own, trainerId, caption: '', data: Buffer.from('own') }, { id: foreign, trainerId: randomUUID(), caption: '', data: Buffer.from('foreign') }];
  const operations = new Map();
  let active = true, session = true, visible = true;
  const matches = (row, where) => row.id === where.id && (where.trainerId ? row.trainerId === where.trainerId : visible && row.trainerId === trainerId && where.trainer.publicKey === 'a'.repeat(32));
  const tx = {
    $executeRaw: async () => {},
    trainerProfile: { findFirst: async ({ where }) => active && where.userId === actorId && where.user.role === 'TRAINER' && where.user.authVersion === 1 ? { id: trainerId, publicKey: 'a'.repeat(32), publicName: 'Тренер', publicVisible: visible } : null },
    authSession: { findFirst: async () => session ? {} : null },
    crmOperation: { findUnique: async ({ where }) => operations.get(where.actorId_key.key), create: async ({ data }) => operations.set(data.key, data) },
    auditEvent: { create: async () => {} },
    trainerGalleryPhoto: {
      findMany: async ({ where }) => rows.filter(r => r.trainerId === where.trainerId),
      findFirst: async ({ where }) => rows.find(r => matches(r, where)),
      count: async ({ where }) => rows.filter(r => r.trainerId === where.trainerId).length,
      create: async ({ data }) => { const r = { id: randomUUID(), ...data }; rows.push(r); return r; },
      updateMany: async ({ where, data }) => { const r = rows.find(r => matches(r, where)); if (r) Object.assign(r, data); return { count: r ? 1 : 0 }; },
      deleteMany: async ({ where }) => { const i = rows.findIndex(r => matches(r, where)); if(i >= 0) rows.splice(i, 1); return { count: i >= 0 ? 1 : 0 }; },
    },
  };
  let queue = Promise.resolve();
  const db = { ...tx, $transaction: callback => { const result = queue.then(() => callback(tx)); queue = result.catch(() => {}); return result; } };
  const ctx = () => ({ actorId, authVersion: 1, sessionId: 'session', key: randomUUID() });
  return { db, ctx, rows, own, foreign, trainerId, actorId, disable: () => { active = false; }, revoke: () => { session = false; }, hide: () => { visible = false; } };
}
test('gallery isolates private reads, captions and deletion by trainer', async () => {
  const f=fixture(), s=galleryService(f.db);
  assert.equal((await s.list(f.ctx())).photos.length,1);
  await assert.rejects(s.image(f.ctx(),f.foreign), {status:404});
  await assert.rejects(s.change(f.ctx(),f.foreign,'caption',{caption:'чужое'}), {status:404});
  await assert.rejects(s.change(f.ctx(),f.foreign,'delete',{confirm:'DELETE'}), {status:404});
  await s.change(f.ctx(),f.own,'caption',{caption:' Тренировка '});
  assert.equal(f.rows[0].caption,'Тренировка');
  assert.throws(()=>s.change(f.ctx(),f.own,'delete',{}));
  await s.change(f.ctx(),f.own,'delete',{confirm:'DELETE'});
  assert.equal(f.rows.length,1);
});
test('upload retry is idempotent, limit holds across concurrent submissions', async () => {
  const f=fixture(), s=galleryService(f.db), ctx=f.ctx();
  await s.add(ctx,Buffer.from('photo')); await s.add(ctx,Buffer.from('photo'));
  assert.equal(f.rows.length,3);
  await assert.rejects(s.add(ctx,Buffer.from('different')),{status:409});
  while(f.rows.filter(r=>r.trainerId===f.trainerId).length<19) f.rows.push({id:randomUUID(),trainerId:f.trainerId});
  const results=await Promise.allSettled([s.add(f.ctx(),Buffer.from('a')),s.add(f.ctx(),Buffer.from('b'))]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(f.rows.filter(r=>r.trainerId===f.trainerId).length,20);
});
test('inactive accounts and revoked sessions cannot mutate gallery',async()=>{
  const f=fixture(),s=galleryService(f.db); f.revoke();
  await assert.rejects(s.add(f.ctx(),Buffer.from('x')),{status:403});
  f.disable(); await assert.rejects(s.list(f.ctx()),{status:404});
});
test('routes enforce role, Origin, CSRF, validate image and expose only published photos',async()=>{
  const f=fixture(), app=express(), token='a'.repeat(64);
  app.use(express.urlencoded({extended:false}));
  app.use((req,res,next)=>{req.user={id:f.actorId,role:req.get('x-role')||'TRAINER',authVersion:1,displayName:'Тренер'}; req.session={csrf:token};req.sessionID='session';next();});
  app.use(trainerGalleryRoutes({config:{APP_ORIGIN:'http://localhost'},prisma:f.db}));
  app.use(publicTrainerRoutes({config:{},prisma:f.db}));
  app.use((err,req,res,next)=>res.status(err.status||500).send('error'));
  app.set('views',fileURLToPath(new URL('../server/views',import.meta.url)));app.set('view engine','ejs');
  await request(app).get('/trainer/gallery').set('x-role','ADMIN').expect(403);
  await request(app).post('/trainer/gallery/upload').expect(403);
  await request(app).post('/trainer/gallery/'+f.own+'/delete').set('Origin','http://localhost').type('form').send({_csrf:'bad',key:randomUUID(),confirm:'DELETE'}).expect(403);
  const photo=await sharp({create:{width:12,height:12,channels:3,background:'#ff8800'}}).png().toBuffer();
  await request(app).post('/trainer/gallery/upload').set('Origin','http://localhost').field('_csrf',token).field('key',randomUUID()).attach('image',photo,'image.png').expect(303);
  await request(app).get('/trainer/gallery/'+f.foreign+'/image').expect(404);
  await request(app).get('/trainers/'+'a'.repeat(32)+'/gallery/'+f.own).expect(200).expect('Content-Type',/image\/webp/);
  await request(app).get('/trainers/'+'a'.repeat(32)+'/gallery/'+f.foreign).expect(404);
  f.hide(); await request(app).get('/trainers/'+'a'.repeat(32)+'/gallery/'+f.own).expect(404);
});
test('public template hides empty gallery and escapes captions',async()=>{
  const base={seo:{title:'Тренер',description:'Описание',robots:'noindex',canonical:'',jsonLd:[]},unavailable:false,profile:{name:'Тренер',photoUrl:'/photo',hasPhoto:true,gallery:[]}};
  const file=fileURLToPath(new URL('../server/views/public/trainer.ejs',import.meta.url));
  const empty=await ejs.renderFile(file,base);
  assert.ok(!empty.includes('id="gallery-title"'));
  const html=await ejs.renderFile(file,{...base,profile:{...base.profile,gallery:[{url:'/photo',caption:'<script>alert(1)</script>'}]}});
  assert.ok(html.includes('id="gallery-title"'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>alert(1)</script>'));
});
