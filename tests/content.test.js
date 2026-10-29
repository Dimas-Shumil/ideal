// Integration checks use only the isolated test database provided by run-tests.mjs.
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {randomUUID,randomBytes} from 'node:crypto';
import sharp from 'sharp';
import {readConfig} from '../server/config/env.js';
import {createDatabase} from '../server/db/client.js';
import {createApp} from '../server/app.js';
import {clearCrm} from './helpers/crm.js';
const config=readConfig();
if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('_test'))throw Error('TEST_DB_REQUIRED');
const db=createDatabase(config.DATABASE_URL);
let app,store,users,session;
const state=html=>({csrf:html.match(/name="_csrf" value="([a-f0-9]{64})"/)?.[1],key:html.match(/name="key" value="([0-9a-f-]{36})"/)?.[1],version:Number(html.match(/name="version" value="(\d+)"/)?.[1])});
const page=async path=>(await session.get(path).expect(200)).text;
const post=async(path,fields)=>{
 const form=state(await page(path.substring(0,path.lastIndexOf('/'))));
 return session.post(path).set('Origin',config.APP_ORIGIN).type('form').send({...form,_csrf:form.csrf,...fields}).expect(303);
};
before(async()=>{
 await clearCrm(db.prisma);
 await db.prisma.auditEvent.deleteMany();
 await db.prisma.authSession.deleteMany();
 await db.prisma.user.deleteMany();
 ({app,store,users}=await createApp({config,db}));
 const password=randomBytes(24).toString('hex');
 await users.create({login:'contentowner',displayName:'Владелец',role:'OWNER',password},{bootstrap:true});
 session=request.agent(app);
 const loginPage=await session.get('/login').expect(200);
 const csrf=loginPage.text.match(/name="_csrf" value="([a-f0-9]{64})"/)[1];
 await session.post('/login').set('Origin',config.APP_ORIGIN).type('form').send({login:'contentowner',password,_csrf:csrf}).expect(303);
});
after(async()=>{store?.close();await db.close();});
test('owner CMS is accessible while unauthenticated visitors are redirected',async()=>{
 await request(app).get('/admin/content').expect(303);
 const html=await page('/admin/content');
 assert.match(html,/Контент сайта/);
 assert.match(html,/Контакты/);
 assert.match(await page('/admin/content/contacts'),/Сохранить изменения/);
});
test('saving contacts changes live homepage, footer and shop without restarting',async()=>{
 const html=await page('/admin/content/contacts');
 const {csrf,key,version}=state(html);
 assert.ok(csrf&&key&&version);
 await session.post('/admin/content/contacts/save').set('Origin',config.APP_ORIGIN).type('form').send({_csrf:csrf,key,version,publicOrder:0,address:'Абакан, улица Тестовая, 10',hours:'Ежедневно с 09:00 до 21:00',phone:'+7 (3902) 28-73-86',map:'https://2gis.ru/abakan/firm/9711414977502434',vk:'',telegram:''}).expect(303);
 const editor=await page('/admin/content/contacts?saved=1');
 assert.match(editor,/Сохранено/);
 assert.match(editor,/09:00 до 21:00/);
 const home=await request(app).get('/').expect(200);
 assert.match(home.text,/Ежедневно с 09:00 до 21:00/);
 assert.match(home.text,/улица Тестовая, 10/);
 assert.match(home.text,/tel:\+73902287386/);
 const shop=await request(app).get('/shop.html').expect(200);
 assert.match(shop.text,/Ежедневно с 09:00 до 21:00/);
 assert.equal((await db.prisma.contentEntry.findUnique({where:{key:'contacts'}})).visible,true);
 assert.doesNotMatch(editor,/Публикация раздела/); // contacts never need a second publish action
});
test('invalid phone shows field-specific error and retains form values',async()=>{
 const html=await page('/admin/content/contacts');
 const {csrf,key,version}=state(html);
 const response=await session.post('/admin/content/contacts/save').set('Origin',config.APP_ORIGIN).type('form')
  .send({_csrf:csrf,key,version,publicOrder:0,address:'Абакан, ул. Бограда, 135',hours:'Ежедневно с 08:00 до 22:00',phone:'номер-неверный',map:'',vk:'',telegram:''}).expect(400);
 assert.match(response.text,/Не сохранено/);
 assert.match(response.text,/Телефон/);
 assert.match(response.text,/номер-неверный/);
 assert.equal((await db.prisma.contentEntry.findUnique({where:{key:'contacts'}})).version,version);
});
test('editor explains a rejected Origin instead of silently losing input',async()=>{
 const html=await page('/admin/content/contacts');
 const {csrf,key,version}=state(html);
 const result=await session.post('/admin/content/contacts/save').set('Origin','http://example.invalid')
  .type('form').send({_csrf:csrf,key,version,publicOrder:0,address:'Абакан',hours:'08:00–22:00',phone:'+73902287386',map:'',vk:'',telegram:''}).expect(403);
 assert.match(result.text,/APP_ORIGIN/);
 assert.equal((await db.prisma.contentEntry.findUnique({where:{key:'contacts'}})).version,version);
});
test('owner publishes a direction, its updated texts appear, and hiding removes it',async()=>{
 const editor=await page('/admin/content/gym');const {csrf,key,version}=state(editor);
 await session.post('/admin/content/gym/save').set('Origin',config.APP_ORIGIN).type('form').send({_csrf:csrf,key,version,title:'Тренировки с тренером',summary:'Наши занятия в зале',body:'Полный текст про направление.',publicOrder:0}).expect(303);
 const current=state(await page('/admin/content/gym'));
 await session.post('/admin/content/gym/publish').set('Origin',config.APP_ORIGIN).type('form').send({_csrf:current.csrf,key:randomUUID(),version:current.version,visible:'true',confirm:'PUBLIC'}).expect(303);
 assert.match((await request(app).get('/').expect(200)).text,/Тренировки с тренером/);
 assert.match((await request(app).get('/directions/gym').expect(200)).text,/Полный текст про направление/);
 const latest=state(await page('/admin/content/gym'));
 await session.post('/admin/content/gym/publish').set('Origin',config.APP_ORIGIN).type('form').send({_csrf:latest.csrf,key:randomUUID(),version:latest.version,visible:'false',confirm:'PUBLIC'}).expect(303);
 await request(app).get('/directions/gym').expect(404);
});

test('owner adds, publishes and deletes a club photo; public URL disappears after deletion',async()=>{
 const form=state(await page('/admin/content/about'));
 const png=await sharp({create:{width:14,height:14,channels:3,background:{r:160,g:180,b:200}}}).png().toBuffer();
 await session.post('/admin/content/about/photos/facade/upload').set('Origin',config.APP_ORIGIN)
  .field('_csrf',form.csrf).field('key',form.key).field('version',String(form.version))
  .attach('image',png,{filename:'facade.png',contentType:'image/png'}).expect(303);
 const photo=await db.prisma.contentPhoto.findFirst({where:{entry:{key:'about'}},select:{id:true,publicKey:true}});
 assert.ok(photo);
 const latest=state(await page('/admin/content/about'));
 await session.post('/admin/content/about/photos/'+photo.id+'/meta').set('Origin',config.APP_ORIGIN).type('form')
  .send({_csrf:latest.csrf,key:randomUUID(),version:latest.version,alt:'Фото клуба ИДЕАЛ',caption:'',publicOrder:0,visible:'true',confirm:'PUBLIC'}).expect(303);
 const photoUrl='/content/photos/'+photo.publicKey;
 await request(app).get(photoUrl).expect(404); // Parent entry is still hidden.
 const now=state(await page('/admin/content/about'));
 await session.post('/admin/content/about/publish').set('Origin',config.APP_ORIGIN).type('form')
  .send({_csrf:now.csrf,key:randomUUID(),version:now.version,visible:'true',confirm:'PUBLIC'}).expect(303);
 assert.match((await request(app).get('/about.html').expect(200)).text,new RegExp(photoUrl));
 await request(app).get(photoUrl).expect(200);
 const beforeRemove=state(await page('/admin/content/about'));
 await session.post('/admin/content/about/photos/'+photo.id+'/delete').set('Origin',config.APP_ORIGIN).type('form')
  .send({_csrf:beforeRemove.csrf,key:randomUUID(),version:beforeRemove.version,confirm:'DELETE'}).expect(303);
 await request(app).get(photoUrl).expect(404);
});
