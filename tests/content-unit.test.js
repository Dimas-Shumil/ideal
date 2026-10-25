import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import helmet from 'helmet';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {entryBody,normalizedData,photoMeta,safeLink} from '../server/modules/content/schema.js';
import {contentPublicRoutes,publicContacts,renderHomeContent,publicEntrySelect,publicDirectionWhere,directions,featuredTrainer,directionDto} from '../server/modules/content/public.js';
import {contentManagementRoutes} from '../server/modules/content/routes.js';
const row={key:'gym',data:{title:'Название <img>',summary:'Кратко',body:'Описание',login:'PRIVATE_LOGIN'},photos:[{publicKey:'a'.repeat(32),slot:'cover',alt:'Фото <клуба>',caption:'Подпись',data:'PRIVATE_BYTES',entryId:'PRIVATE_ID'}],version:15};
const contactData={address:'АДРЕС <клуба>',phone:'+79991234567',hours:'ЧАСЫ',map:'https://2gis.ru/abakan',vk:'https://vk.com/club',telegram:'https://t.me/club'};
function fixture(prisma,load=true){const app=express();app.set('views','server/views');app.set('view engine','ejs');app.use(helmet());if(load)app.use(publicContacts(prisma));app.use(contentPublicRoutes({prisma,config:{}}));app.use((req,res)=>res.sendStatus(404));app.use((e,req,res,next)=>res.status(e.status|| (e.name==='ZodError'?400:503)).send('Ошибка'));return app;}
test('content schema: fixed structures, no business categories, prices or arbitrary HTML fields',()=>{
 const d={title:' Зал ',summary:'Кратко',body:'Текст'};
 assert.equal(entryBody('gym').parse(d).title,'Зал');
 for(const extra of [{kind:'GROUP'},{price:100},{userId:randomUUID()},{html:'<script>'}]) assert.throws(()=>entryBody('gym').parse({...d,...extra}));
 assert.throws(()=>entryBody('GROUP'));assert.throws(()=>entryBody('gym').parse({...d,body:'x'.repeat(6001)}));
 assert.throws(()=>photoMeta.parse({alt:' ',caption:'',publicOrder:0,visible:'true',confirm:'PUBLIC'}));
 assert.throws(()=>photoMeta.parse({alt:'Зал',caption:'',publicOrder:-1,visible:'false',confirm:'PUBLIC'}));
});
test('contacts schema: approved HTTPS hosts only, safe phone and explicit DTO projection',()=>{
 assert.deepEqual(entryBody('contacts').parse(contactData),contactData);
 for(const url of ['javascript:alert(1)','http://vk.com/club','https://vk.com.evil.test','https://user:pass@vk.com','https://vk.com:444/a'])assert.equal(safeLink(url,'vk'),false);
 assert.throws(()=>entryBody('contacts').parse({...contactData,phone:'8 999 123'}));
 const d=normalizedData('contacts',{...contactData,password:'PRIVATE'});assert.doesNotMatch(JSON.stringify(d),/PRIVATE/);
});
test('content public projection: ordered published entries and photos, minimal DTO without raw JSON or private fields',async()=>{
 let call;const p={contentEntry:{findMany:async q=>{call=q;return [row];}}};
 const data=await directions(p);assert.deepEqual(call.where,publicDirectionWhere);assert.deepEqual(call.select,publicEntrySelect);
 assert.deepEqual(call.select.photos.where,{visible:true,alt:{not:''}});
 assert.deepEqual(call.orderBy,[{publicOrder:'asc'},{key:'asc'}]);
 assert.deepEqual(Object.keys(data[0]).sort(),['title','summary','body','url','photos'].sort());assert.doesNotMatch(JSON.stringify(data),/PRIVATE|version|entryId|login/);
 assert.equal(directionDto(row).photos[0].url,'/content/photos/'+'a'.repeat(32));
});
test('featured trainer: empty selection never queries staff; selected source uses public predicate and card projection',async()=>{
 let calls=0,query;
 const p={contentEntry:{findFirst:async()=>({data:{trainerId:''}})},trainerProfile:{findFirst:async q=>{query=q;calls++;return null;}}};
 assert.equal(await featuredTrainer(p),null);assert.equal(calls,0);
 const id=randomUUID();p.contentEntry.findFirst=async()=>({data:{trainerId:id}});assert.equal(await featuredTrainer(p),null);
 assert.deepEqual(query.where,{publicVisible:true,publicName:{not:''},user:{active:true,role:'TRAINER'},id,photo:{isNot:null}});
 assert.equal(query.select.user,undefined);assert.equal(query.select.publicVersion,undefined);
});
test('public content HTTP fixture: SSR escaped text, common contacts, no cookie, no-store/noindex and photo access predicate',async()=>{
 let photoQuery;
 const p={contentEntry:{findFirst:async q=>q.where.key==='contacts'?{data:contactData}:q.where.key==='about'?{...row,key:'about',data:{body:'Рассказ <script>',title:'О клубе'}}:row},contentPhoto:{findFirst:async q=>{photoQuery=q;return {data:Buffer.from('WEBP')};}}};
 const app=fixture(p);
 for(const path of ['/about.html','/directions/gym']){
  const r=await request(app).get(path).expect(200);assert.equal(r.headers['set-cookie'],undefined);assert.equal(r.headers['cache-control'],'no-store');assert.equal(r.headers['x-robots-tag'],'noindex,follow');assert.match(r.text,/АДРЕС &lt;клуба&gt;/);assert.doesNotMatch(r.text,/PRIVATE|<script>/);
  assert.match(r.text,/href="\/#contacts"><span>Связаться/);
 }
 await request(app).get('/content/photos/'+'a'.repeat(32)).expect(200).expect('Content-Type',/image\/webp/);
 assert.equal(photoQuery.where.entry.visible,true);assert.equal(photoQuery.where.visible,true);assert.equal(photoQuery.select.data,true);
 await request(app).post('/directions/gym').expect(404);await request(app).get('/api/public/content').expect(404);
});
test('public content HTTP fixture: hidden or unknown is 404, empty about is honest, errors are not empty success',async()=>{
 const p={contentEntry:{findFirst:async()=>null},contentPhoto:{findFirst:async()=>null}};
 const app=fixture(p);assert.match((await request(app).get('/about.html').expect(200)).text,/готовится к публикации/);
 await request(app).get('/directions/gym').expect(404);await request(app).get('/directions/GROUP').expect(404);await request(app).get('/content/photos/'+'b'.repeat(32)).expect(404);
 await request(app).get('/directions/gym?private=1').expect(400);await request(app).get('/about.html?userId=1').expect(400);
 const down=fixture({contentEntry:{findFirst:async()=>{throw Error('PRIVATE_DB');}}});const r=await request(down).get('/about.html').expect(503);assert.doesNotMatch(r.text,/PRIVATE_DB|готовится к публикации/);
});
test('content management HTTP fixture: OWNER boundary guards each route before upload/data access',async()=>{
 for(const role of ['ADMIN','TRAINER']){
  const app=express();app.use((req,res,next)=>{req.user={id:randomUUID(),role};next();});app.use(contentManagementRoutes({prisma:{},config:{}}));app.use((e,req,res,next)=>res.sendStatus(e.status||500));
  for(const path of ['/admin/content','/admin/content/about','/admin/content/about/photos/'+randomUUID()])await request(app).get(path).expect(403);
  for(const path of ['save','publish','photos/cover/upload','photos/cover/'+randomUUID()+'/replace','photos/'+randomUUID()+'/meta','photos/'+randomUUID()+'/delete'])await request(app).post('/admin/content/gym/'+path).expect(403);
 }
 const app=express();app.use(contentManagementRoutes({prisma:{},config:{}}));app.use((e,req,res,next)=>res.sendStatus(e.status||500));await request(app).get('/admin/content').expect(303);
});
test('home render fixture: no duplicate schedule or preview, generic trainer fallback and contacts without JS',async()=>{
 const p={contentEntry:{findMany:async()=>[],findFirst:async()=>null}};
 const html=await renderHomeContent(p,await readFile('index.html','utf8'),contactData);
 assert.match(html,/Направления пока не опубликованы/);assert.match(html,/href="\/schedule.html">Смотреть расписание/);
 assert.doesNotMatch(html,/ПН · СР|PILATES|data-preview=|Место для фотографии тренера/);
 assert.match(html,/АДРЕС &lt;клуба&gt;/);assert.match(html,/Нейтральный силуэт тренера/);
});
test('content offline and component sync boundary: no content paths cached, generated contacts remain dynamic',async()=>{
 const sw=await readFile('server/modules/push/sw.js','utf8');assert.doesNotMatch(sw,/ContentPhoto|\/content\/|\/directions\//);
 for(const file of ['server/views/public/footer.ejs','server/views/shop/footer.ejs'])assert.match(await readFile(file,'utf8'),/include\('\.\.\/content\/contacts'\)/);
});

// Transaction fixtures below cover rollback and policies, not real DB locking.
import {contentFixture} from './helpers/content-fixture.js';
import {normalizeImage} from '../server/modules/shop/images.js';
import sharp from 'sharp';
const values={title:'Зал',summary:'Кратко',body:'Подробно',publicOrder:3};
test('content mutation fixture: publication is explicit, requires descriptions, hide preserves materials',async()=>{
 const f=contentFixture();await assert.rejects(()=>f.service.publish(f.ctx(),'gym',{visible:'true',confirm:'PUBLIC'}),e=>e.status===409);
 await f.service.save(f.ctx(),'gym',values);assert.equal(f.state.entries[0].visible,false);
 await f.service.publish(f.ctx(),'gym',{visible:'true',confirm:'PUBLIC'});
 await assert.rejects(()=>f.service.save(f.ctx(),'gym',{...values,title:''}),e=>e.status===409);
 await f.service.publish(f.ctx(),'gym',{visible:'false',confirm:'PUBLIC'});assert.deepEqual(f.state.entries[0].data,{title:'Зал',summary:'Кратко',body:'Подробно'});
});
test('content mutation fixture: stale versions, request replay and changed fingerprints',async()=>{
 const f=contentFixture(),ctx=f.ctx();await f.service.save(ctx,'gym',values);await f.service.save(ctx,'gym',values);
 assert.equal(f.state.entries[0].version,2);assert.equal(f.state.audits.length,1);
 await assert.rejects(()=>f.service.save(ctx,'gym',{...values,title:'Другое'}),e=>e.status===409);
 await assert.rejects(()=>f.service.save({...ctx,key:randomUUID()},'gym',values),e=>e.status===409);
 assert.equal(f.state.operations.length,1);
});
test('content mutation fixture: transaction rechecks OWNER, live session, authVersion even for replay',async()=>{
 const f=contentFixture(),ctx=f.ctx();await f.service.save(ctx,'gym',values);
 for(const change of [{authVersion:2},{sessionId:''},{sessionId:'missing'}])await assert.rejects(()=>f.service.save({...ctx,...change},'gym',values),e=>e.status===403);
 f.actor.role='ADMIN';await assert.rejects(()=>f.service.save(ctx,'gym',values),e=>e.status===403);f.actor.role='OWNER';
 f.actor.active=false;await assert.rejects(()=>f.service.save(ctx,'gym',values),e=>e.status===403);f.actor.active=true;f.state.liveSession=false;
 await assert.rejects(()=>f.service.save(ctx,'gym',values),e=>e.status===403);
});
test('content mutation fixture: failed audit rolls back fields, version, operation and binary photo',async()=>{
 const f=contentFixture();f.state.auditDown=true;
 await assert.rejects(()=>f.service.save(f.ctx(),'gym',values),/AUDIT_DOWN/);
 assert.equal(f.state.entries[0].version,1);assert.deepEqual(f.state.entries[0].data,{});
 await assert.rejects(()=>f.service.upload(f.ctx(),'gym','cover',null,Buffer.from('WEBP')),/AUDIT_DOWN/);
 assert.equal(f.state.photos.length,0);assert.equal(f.state.operations.length,0);assert.equal(f.state.entries[0].version,1);
});
test('content mutation fixture: photo quota, explicit alt/publication, replacement replay, cross-entry and confirmed deletion',async()=>{
 const f=contentFixture();await f.service.upload(f.ctx(),'gym','cover',null,Buffer.from('FIRST'));
 let photo=f.state.photos[0];assert.equal(photo.visible,false);
 await assert.rejects(()=>f.service.upload(f.ctx(),'gym','cover',null,Buffer.from('EXTRA')),e=>e.status===409);
 await f.service.metadata(f.ctx(),'gym',photo.id,{alt:'Зал',caption:'Вид',visible:'true',publicOrder:2,confirm:'PUBLIC'});
 const ctx=f.ctx();await f.service.upload(ctx,'gym','cover',photo.id,Buffer.from('SECOND'));await f.service.upload(ctx,'gym','cover',photo.id,Buffer.from('SECOND'));
 photo=f.state.photos[0];assert.equal(Buffer.from(photo.data).toString(),'SECOND');assert.equal(photo.caption,'Вид');assert.equal(photo.visible,true);
 await assert.rejects(()=>f.service.metadata(f.ctx('about'),'about',photo.id,{alt:'Чужое',caption:'',visible:'true',publicOrder:0,confirm:'PUBLIC'}),e=>e.status===404);
 await assert.rejects(()=>f.service.remove(f.ctx(),'gym',photo.id,{confirm:'NO'}));
 await f.service.remove(f.ctx(),'gym',photo.id,{confirm:'DELETE'});assert.equal(f.state.photos.length,0);
});
test('content mutation fixture: featured choice must be eligible; empty clears choice without touching profile',async()=>{
 const f=contentFixture(),id=randomUUID();await assert.rejects(()=>f.service.save(f.ctx('home'),'home',{trainerId:id,publicOrder:0}),e=>e.status===409);
 f.state.eligibleTrainer=true;await f.service.save(f.ctx('home'),'home',{trainerId:id,publicOrder:0});assert.equal(f.state.entries[4].data.trainerId,id);
 await f.service.save(f.ctx('home'),'home',{trainerId:'',publicOrder:0});assert.equal(f.state.entries[4].data.trainerId,'');
});
test('content upload HTTP fixture: Origin/CSRF, corrupt raster, duplicate fields, success/replace/delete and normalized metadata',async()=>{
 const f=contentFixture(),origin='http://localhost',token='a'.repeat(64),app=express();app.set('view engine','ejs');app.set('views','server/views');
 app.use((req,res,next)=>{req.user=f.actor;req.session={csrf:token};req.sessionID='valid';next();});app.use(contentManagementRoutes({prisma:f.prisma,config:{APP_ORIGIN:origin}}));app.use((e,req,res,next)=>res.sendStatus(e.status||400));
 const bytes=await sharp({create:{width:30,height:40,channels:3,background:'#345678'}}).png().toBuffer(),path='/admin/content/gym/photos/cover/upload';
 const upload=(csrf=token)=>request(app).post(path).set('Origin',origin).field('_csrf',csrf).field('key',randomUUID()).field('version','1');
 await request(app).post(path).expect(403);
 await upload('b'.repeat(64)).attach('image',bytes,{filename:'x.png',contentType:'image/png'}).expect(403);
 await upload().attach('image',Buffer.from('<svg/>'),{filename:'x.png',contentType:'image/png'}).expect(400);
 await upload().field('key',randomUUID()).attach('image',bytes,{filename:'x.png',contentType:'image/png'}).expect(400);
 await upload().attach('image',Buffer.alloc(5*1024*1024+1),{filename:'x.png',contentType:'image/png'}).expect(400);
 assert.equal(f.state.photos.length,0);await upload().attach('image',bytes,{filename:'../../photo.png',contentType:'image/png'}).expect(303);
 const normalized=await sharp(f.state.photos[0].data).metadata();assert.equal(normalized.format,'webp');assert.equal(normalized.exif,undefined);assert.equal(f.state.entries[0].version,2);
});
