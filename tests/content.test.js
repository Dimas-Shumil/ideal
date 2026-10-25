// Runs only through the guarded runner against a separate PostgreSQL *_test DB.
import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import sharp from 'sharp';
import {randomUUID,randomBytes} from 'node:crypto';
import {readConfig} from '../server/config/env.js';
import {createDatabase} from '../server/db/client.js';
import {createApp} from '../server/app.js';
import {clearCrm} from './helpers/crm.js';
import {contentService} from '../server/modules/content/service.js';
import {normalizedData} from '../server/modules/content/schema.js';
const config=readConfig();if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('_test'))throw Error('TEST_DB_REQUIRED');
const db=createDatabase(config.DATABASE_URL),p=db.prisma,pw=randomBytes(24).toString('hex'),origin=config.APP_ORIGIN;
let app,store,users,owner,admin,trainer,os,as,ts,bytes;
async function login(name){const agent=request.agent(app),r=await agent.get('/login').expect(200);const token=r.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];await agent.post('/login').set('Origin',origin).type('form').send({_csrf:token,login:name,password:pw}).expect(303);return {agent,token:(await agent.get('/api/auth/me')).body.csrf};}
const entry=key=>p.contentEntry.findUniqueOrThrow({where:{key}});
async function post(key,action,data={},status=303,s=os,op=randomUUID(),version){return s.agent.post('/admin/content/'+key+'/'+action).set('Origin',origin).type('form').send({_csrf:s.token,key:op,version:version??(await entry(key)).version,...data}).expect(status);}
const direction={title:'Зал <клуба>',summary:'Согласованное описание',body:'Подробное описание',publicOrder:'2'};
async function publish(key='gym'){await post(key,'save',direction);await post(key,'publish',{visible:'true',confirm:'PUBLIC'});}
async function upload(key,slot,id,version,raw=bytes,status=303,op=randomUUID()){
 return os.agent.post('/admin/content/'+key+'/photos/'+slot+(id?'/'+id+'/replace':'/upload')).set('Origin',origin).field('_csrf',os.token).field('key',op).field('version',String(version??(await entry(key)).version)).attach('image',raw,{filename:'photo.png',contentType:'image/png'}).expect(status);
}
async function photoMeta(key,id,visible='true'){return post(key,'photos/'+id+'/meta',{alt:'Фотография зала',caption:'Подпись',publicOrder:1,visible,confirm:'PUBLIC'});}
async function context(key){const session=await p.authSession.findFirstOrThrow({where:{userId:owner.id}});return {actorId:owner.id,authVersion:owner.authVersion,sessionId:session.sid,key:randomUUID(),version:(await entry(key)).version};}
before(async()=>{
 await clearCrm(p);await p.auditEvent.deleteMany();await p.authSession.deleteMany();await p.user.deleteMany();
 ({app,store,users}=await createApp({config,db}));
 owner=await users.create({login:'contentowner',displayName:'PRIVATE_OWNER',role:'OWNER',password:pw});
 admin=await users.create({login:'contentadmin',displayName:'PRIVATE_ADMIN',role:'ADMIN',password:pw});
 trainer=await users.create({login:'contenttrainer',displayName:'PRIVATE_TRAINER',role:'TRAINER',password:pw});
 owner=await p.user.findUniqueOrThrow({where:{id:owner.id}});admin=await p.user.findUniqueOrThrow({where:{id:admin.id}});trainer=await p.user.findUniqueOrThrow({where:{id:trainer.id}});
 os=await login('contentowner');as=await login('contentadmin');ts=await login('contenttrainer');
 bytes=await sharp({create:{width:40,height:60,channels:3,background:'#345678'}}).png().toBuffer();
});
beforeEach(async()=>{await p.contentPhoto.deleteMany();await p.contentEntry.updateMany({data:{data:{},visible:false,publicOrder:0,version:1}});await p.crmOperation.deleteMany();await p.auditEvent.deleteMany();});
after(async()=>{store?.close();await db.close();});
test('content DB: only OWNER can read/change content, no guest upload, CSRF and Origin independently enforced',async()=>{
 await request(app).get('/admin/content').expect(303);await request(app).post('/admin/content/gym/photos/cover/upload').expect(303);
 for(const s of [as,ts]){await s.agent.get('/admin/content').expect(403);await s.agent.get('/admin/content/about').expect(403);await post('gym','save',direction,403,s);await post('gym','publish',{visible:'true',confirm:'PUBLIC'},403,s);await s.agent.post('/admin/content/gym/photos/cover/upload').expect(403);}
 await os.agent.post('/admin/content/gym/save').type('form').send({_csrf:os.token,key:randomUUID(),version:1,...direction}).expect(403);
 await os.agent.post('/admin/content/gym/save').set('Origin',origin).type('form').send({key:randomUUID(),version:1,...direction}).expect(403);
 assert.equal((await entry('gym')).version,1);await os.agent.get('/admin/content').expect(200);await os.agent.get('/admin/content/about').expect(200);
});
test('content DB: fields do not publish, explicit publication, hidden URL and gallery return 404, materials persist',async()=>{
 await post('gym','publish',{visible:'true',confirm:'PUBLIC'},409);await post('gym','save',direction);
 await request(app).get('/directions/gym').expect(404);await post('gym','publish',{visible:'true',confirm:'PUBLIC'});
 const r=await request(app).get('/directions/gym').expect(200);assert.match(r.text,/Зал &lt;клуба&gt;/);assert.doesNotMatch(r.text,/PRIVATE_|name="_csrf"/);assert.equal(r.headers['set-cookie'],undefined);
 await post('gym','publish',{visible:'false',confirm:'PUBLIC'});await request(app).get('/directions/gym').expect(404);assert.equal((await entry('gym')).data.body,direction.body);
});
test('content DB: stale edit and exact replay, changed payload conflicts without duplicate audit',async()=>{
 const key=randomUUID();await post('gym','save',direction,303,os,key,1);await post('gym','save',direction,303,os,key,1);
 await post('gym','save',{...direction,title:'Подмена'},409,os,key,1);await post('gym','save',direction,409,os,randomUUID(),1);
 assert.equal((await entry('gym')).version,2);assert.equal(await p.auditEvent.count({where:{action:'CONTENT_SAVE'}}),1);
});
test('content DB: concurrent same-version writes serialize, one succeeds and one conflicts',async()=>{
 const ctx=await context('gym'),service=contentService(p);const r=await Promise.allSettled([service.save(ctx,'gym',direction),service.save({...ctx,key:randomUUID()},'gym',{...direction,title:'Другой'})]);
 assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(r.find(x=>x.status==='rejected').reason.status,409);assert.equal((await entry('gym')).version,2);
});
test('content DB: upload normalizes bytes, hides by default, publishes alt, replaces in place and deletes explicitly',async()=>{
 await publish();await upload('gym','cover');let photo=await p.contentPhoto.findFirstOrThrow();const url='/content/photos/'+photo.publicKey;
 assert.equal((await sharp(Buffer.from(photo.data)).metadata()).format,'webp');assert.equal(photo.visible,false);await request(app).get(url).expect(404);
 await photoMeta('gym',photo.id);await request(app).get(url).expect(200).expect('Cache-Control','no-store').expect('X-Robots-Tag','noindex,follow');
 const ctxVersion=(await entry('gym')).version,key=randomUUID();await upload('gym','cover',photo.id,ctxVersion,bytes,303,key);await upload('gym','cover',photo.id,ctxVersion,bytes,303,key);
 const after=await p.contentPhoto.findUniqueOrThrow({where:{id:photo.id}});assert.equal(after.publicKey,photo.publicKey);assert.equal(after.alt,'Фотография зала');assert.equal(after.visible,true);
 await post('gym','photos/'+photo.id+'/delete',{confirm:'DELETE'});await request(app).get(url).expect(404);assert.equal(await p.contentPhoto.count(),0);
});
test('content DB: invalid upload and cross-entry photo cannot alter bytes/versions; hidden parent protects published photo',async()=>{
 await upload('gym','cover');const photo=await p.contentPhoto.findFirstOrThrow(),version=(await entry('gym')).version;
 await upload('gym','cover',photo.id,undefined,Buffer.from('<svg/>'),400);assert.equal((await entry('gym')).version,version);
 await post('about','photos/'+photo.id+'/meta',{alt:'Другой',caption:'',publicOrder:0,visible:'true',confirm:'PUBLIC'},404);
 await photoMeta('gym',photo.id);await request(app).get('/content/photos/'+photo.publicKey).expect(404);
 await post('gym','save',direction);await post('gym','publish',{visible:'true',confirm:'PUBLIC'});await request(app).get('/content/photos/'+photo.publicKey).expect(200);
 await post('gym','publish',{visible:'false',confirm:'PUBLIC'});await request(app).get('/content/photos/'+photo.publicKey).expect(404);
});
test('content DB: fixed photo quotas cannot be bypassed by repeat requests',async()=>{
 await upload('gym','cover');await upload('gym','cover',null,undefined,bytes,409);
 for(let i=0;i<4;i++)await upload('gym','gallery');await upload('gym','gallery',null,undefined,bytes,409);
 await upload('about','facade');await upload('about','facade',null,undefined,bytes,409);
 await os.agent.post('/admin/content/contacts/photos/cover/upload').set('Origin',origin).field('_csrf',os.token).field('key',randomUUID()).field('version','1').attach('image',bytes,{filename:'x.png',contentType:'image/png'}).expect(400);
});
test('content DB: shared contacts render in hero/menu/footer/about/catalog; clear and hide have no hardcoded fallback',async()=>{
 const data={...normalizedData('contacts',{}),address:'НОВЫЙ АДРЕС',hours:'НОВЫЕ ЧАСЫ',phone:'+79991234567',map:'https://2gis.ru/abakan',vk:'https://vk.com/club',telegram:'https://t.me/club',publicOrder:0};
 await post('contacts','save',data);await post('contacts','publish',{visible:'true',confirm:'PUBLIC'});
 for(const path of ['/','/about.html','/trainers.html','/schedule.html','/shop.html']){const r=await request(app).get(path).expect(200);assert.match(r.text,/НОВЫЙ АДРЕС/);assert.match(r.text,/tel:\+79991234567/);assert.doesNotMatch(r.text,/Бограда, 135|с 07:00/);}
 await post('contacts','publish',{visible:'false',confirm:'PUBLIC'});const r=await request(app).get('/').expect(200);assert.doesNotMatch(r.text,/НОВЫЙ АДРЕС|79991234567|Бограда, 135/);assert.match(r.text,/Контакты пока не опубликованы/);
});
test('content DB: featured trainer uses one profile; hiding, blank name, removed photo, deactivation or role change give generic block',async()=>{
 const profile=await p.trainerProfile.create({data:{userId:trainer.id,publicName:'ЕДИНОЕ ИМЯ',publicVisible:true,photo:{create:{data:bytes}}}});
 await post('home','save',{trainerId:profile.id,publicOrder:0});await post('home','publish',{visible:'true',confirm:'PUBLIC'});
 assert.match((await request(app).get('/').expect(200)).text,new RegExp('/trainers/'+profile.publicKey+'/photo'));
 for(const change of [{publicVisible:false},{publicName:''}]){await p.trainerProfile.update({where:{id:profile.id},data:change});const r=await request(app).get('/').expect(200);assert.match(r.text,/Нейтральный силуэт/);assert.doesNotMatch(r.text,/ЕДИНОЕ ИМЯ/);await p.trainerProfile.update({where:{id:profile.id},data:{publicVisible:true,publicName:'ЕДИНОЕ ИМЯ'}});}
 await p.trainerPhoto.deleteMany({where:{trainerId:profile.id}});assert.match((await request(app).get('/').expect(200)).text,/Нейтральный силуэт/);
 await p.trainerPhoto.create({data:{trainerId:profile.id,data:bytes}});for(const change of [{active:false},{role:'ADMIN'}]){await p.user.update({where:{id:trainer.id},data:change});assert.match((await request(app).get('/').expect(200)).text,/Нейтральный силуэт/);await p.user.update({where:{id:trainer.id},data:{active:true,role:'TRAINER'}});}
 assert.equal((await entry('home')).data.trainerId,profile.id);await post('home','save',{trainerId:'',publicOrder:0});
 await p.trainerProfile.delete({where:{id:profile.id}});
});
test('content DB: about empty sections omitted, ordered captions escaped, publication switch preserves bytes',async()=>{
 let r=await request(app).get('/about.html').expect(200);assert.match(r.text,/готовится к публикации/);assert.doesNotMatch(r.text,/about-gallery__grid|Фотография клуба появится/);
 await post('about','save',{...normalizedData('about',{}),title:'О НАШЕМ КЛУБЕ',body:'История <script>',publicOrder:0});await post('about','publish',{visible:'true',confirm:'PUBLIC'});
 await upload('about','gallery');const photo=await p.contentPhoto.findFirstOrThrow();await photoMeta('about',photo.id);
 r=await request(app).get('/about.html').expect(200);assert.match(r.text,/История &lt;script&gt;/);assert.match(r.text,/Подпись/);
 await post('about','publish',{visible:'false',confirm:'PUBLIC'});await request(app).get('/content/photos/'+photo.publicKey).expect(404);assert.equal(await p.contentPhoto.count(),1);
});
test('content DB: audit failure rolls back save and operation; session/authVersion changes close direct service mutation',async()=>{
 const service=contentService(p),ctx=await context('gym');
 const proxy={$transaction:fn=>p.$transaction(tx=>fn(new Proxy(tx,{get(target,key){if(key==='auditEvent')return {create:async()=>{throw Error('AUDIT_DOWN');}};return target[key];}})))};
 await assert.rejects(()=>contentService(proxy).save(ctx,'gym',direction),/AUDIT_DOWN/);assert.equal((await entry('gym')).version,1);assert.equal(await p.crmOperation.count(),0);
 await assert.rejects(()=>service.save({...ctx,authVersion:ctx.authVersion+1},'gym',direction),e=>e.status===403);
 await assert.rejects(()=>service.save({...ctx,sessionId:'missing'},'gym',direction),e=>e.status===403);
 await assert.rejects(()=>service.save({...ctx,actorId:admin.id,authVersion:admin.authVersion},'gym',direction),e=>e.status===403);
});
test('content DB: direction order, no private data, invalid query, no public JSON/mutations or offline caching',async()=>{
 for(const key of ['gym','group','personal']){await post(key,'save',{...direction,title:key,publicOrder:key==='personal'?0:key==='gym'?1:2});await post(key,'publish',{visible:'true',confirm:'PUBLIC'});}
 const r=await request(app).get('/').expect(200);assert.ok(r.text.indexOf('/directions/personal')<r.text.indexOf('/directions/gym'));assert.ok(r.text.indexOf('/directions/gym')<r.text.indexOf('/directions/group'));
 assert.doesNotMatch(r.text,/PRIVATE_|publicVersion|authVersion|data-preview=|ПН · СР|Демо-корзина/);
 await request(app).get('/directions/gym?clientId=private').expect(400);await request(app).get('/api/public/content').expect(404);await request(app).post('/directions/gym').expect(404);
 const sitemap=await request(app).get('/sitemap.xml').expect(200);assert.doesNotMatch(sitemap.text,/directions|content\/photos/);
});
