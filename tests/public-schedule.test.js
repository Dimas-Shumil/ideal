import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import { publicSchedule, publicScheduleRange, publicScheduleRoutes, publicLessonSelect } from '../server/modules/public/schedule.js';
import { clubDateTime, clubParts } from '../server/modules/schedule/dates.js';
import { publicationBody, publicTrainerBody } from '../server/modules/schedule/schema.js';
const now = new Date('2026-10-25T18:00:00Z'); // Monday in Abakan, still Sunday in UTC.
const row = { title: '<script>PRIVATE_TITLE</script>', startsAt: clubDateTime('2026-10-26', '10:00'), endsAt: clubDateTime('2026-10-26', '11:00'), status: 'SCHEDULED', publicPreviousStartsAt: null, publicPreviousEndsAt: null, trainer: { publicName: 'Публичное имя', user: { displayName: 'PRIVATE_STAFF' } }, cancelReason: 'PRIVATE_REASON', bookings: [{ client: { name: 'PRIVATE_CLIENT', phone: 'PRIVATE_PHONE' } }], createdById: 'PRIVATE_ID' };
test('public schedule: Abakan week boundary, four bounded weeks and strict query', () => {
  assert.deepEqual(publicScheduleRange({}, now), { week: 0, today: '2026-10-26', from: '2026-10-26', to: '2026-11-01' });
  assert.equal(publicScheduleRange({ week: '3' }, now).from, '2026-11-16');
  for (const q of [{week:'4'}, {week:'-1'}, {week:['0','1']}, {from:'2026-01-01'}, {trainer:'x'}]) assert.throws(() => publicScheduleRange(q, now));
});
test('public schedule: query allowlist excludes personal/hidden/inactive staff and uses exclusive end', async () => {
  let args;
  await publicSchedule({lesson:{findMany: async q => { args=q; return []; }}}, {}, now);
  assert.equal(args.where.kind,'GROUP'); assert.equal(args.where.publicVisible,true);
  assert.deepEqual(args.where.trainer,{user:{active:true,role:'TRAINER'}});
  assert.equal(args.where.startsAt.lt.toISOString(),'2026-11-01T17:00:00.000Z');
  assert.deepEqual(args.select,publicLessonSelect);
  assert.deepEqual(Object.keys(args.select.trainer.select),['publicName']);
  for (const field of ['bookings','visits','events','room','capacity','cancelReason','createdById','version','seriesId']) assert.equal(args.select[field],undefined);
});
test('public schedule: DTO strips extra entities and never falls back to staff displayName', async () => {
  const data=await publicSchedule({lesson:{findMany:async()=>[{...row, trainer:{ publicName:'', user:{displayName:'PRIVATE_STAFF'} }}]}},{},now);
  assert.equal(data.items[0].trainerName,'');
  for(const secret of ['PRIVATE_CLIENT','PRIVATE_PHONE','PRIVATE_STAFF','PRIVATE_REASON','PRIVATE_ID']) assert.equal(JSON.stringify(data).includes(secret),false);
  assert.deepEqual(Object.keys(data.items[0]).sort(),['title','date','startTime','endTime','trainerName','cancelled','previous'].sort());
});
test('public schedule: cancellation and previous public time DTO contain no journal/reason', async () => {
  const data=await publicSchedule({lesson:{findMany:async()=>[{...row,status:'CANCELLED',publicPreviousStartsAt:clubDateTime('2026-10-25','12:00'),publicPreviousEndsAt:clubDateTime('2026-10-25','13:00')}]}},{},now);
  assert.equal(data.items[0].cancelled,true);
  assert.deepEqual(data.items[0].previous,{date:'2026-10-25',startTime:'12:00',endTime:'13:00'});
  assert.equal(JSON.stringify(data).includes('PRIVATE_REASON'),false);
});
function fixture(prisma) {
  const app=express(); app.set('view engine','ejs'); app.set('views',path.resolve('server/views')); app.use(helmet());
  app.use(publicScheduleRoutes({config:{},prisma}));
  app.use((req,res)=>res.sendStatus(404));
  app.use((e,req,res,next)=>res.status(e.name==='ZodError'?400:500).send('Ошибка'));
  return app;
}
test('public schedule HTTP fixture: SSR, escaping, no cookie, no-store, CSP and no public mutations/API',async()=>{
  const date = clubParts(new Date()).date;
  const app=fixture({lesson:{findMany:async()=>[{...row, startsAt:clubDateTime(date,'10:00'), endsAt:clubDateTime(date,'11:00')}]}});
  const res=await request(app).get('/schedule.html').expect(200);
  assert.match(res.text,/&lt;script&gt;PRIVATE_TITLE&lt;\/script&gt;/);
  assert.match(res.text,/Публичное имя/); assert.equal(res.headers['set-cookie'],undefined);
  assert.equal(res.headers['cache-control'],'no-store'); assert.match(res.headers['content-security-policy'],/default-src 'self'/);
  assert.equal(res.headers['x-robots-tag'],'noindex,follow');
  for (const secret of ['PRIVATE_CLIENT','PRIVATE_PHONE','PRIVATE_STAFF','PRIVATE_REASON','PRIVATE_ID']) assert.equal(res.text.includes(secret),false);
  assert.doesNotMatch(res.text,/name="(?:clientId|_csrf|key)"/);
  await request(app).post('/schedule.html').expect(404); await request(app).get('/api/public/schedule').expect(404);
});
test('public schedule HTTP fixture: empty is 200, unavailable is 503, bad query is 400 without DB query',async()=>{
  const empty=await request(fixture({lesson:{findMany:async()=>[]}})).get('/schedule.html').expect(200);
  assert.match(empty.text,/На эту неделю расписание пока не опубликовано/);
  assert.equal((empty.text.match(/Нет опубликованных занятий/g)||[]).length,7);
  const failed=fixture({lesson:{findMany:async()=>{throw Error('PRIVATE_DATABASE_ERROR');}}});
  const unavailable=await request(failed).get('/schedule.html').expect(503);
  assert.match(unavailable.text,/Расписание временно недоступно/); assert.doesNotMatch(unavailable.text,/PRIVATE_DATABASE_ERROR|На эту неделю расписание пока/);
  await request(failed).get('/schedule.html?week=4').expect(400);
  await request(failed).get('/schedule.html?week=0&week=1').expect(400);
});
test('public schedule: publication requires explicit selected versions and confirmation; trainer name is independent',()=>{
  const id='11111111-1111-4111-8111-111111111111';
  assert.deepEqual(publicationBody.parse({visible:'true',lessons:id+':1',confirm:'PUBLIC'}).lessons,[id+':1']);
  for(const value of [{visible:'true',lessons:[] ,confirm:'PUBLIC'},{visible:'true',lessons:id+':1'},{visible:'true',lessons:id+':1',confirm:'PUBLIC',kind:'PERSONAL'}]) assert.throws(()=>publicationBody.parse(value));
  assert.deepEqual(publicTrainerBody.parse({publicName:'  Имя  ',publicVersion:'1'}),{publicName:'Имя',publicVersion:1});
  assert.throws(()=>publicTrainerBody.parse({publicName:'Имя',publicVersion:1,displayName:'private'}));
});
test('public schedule: shared links regenerated, offline allowlist unchanged',async()=>{
  for(const file of ['components/header.html','components/menu.html','server/views/public/header.ejs','server/views/public/footer.ejs','server/views/shop/header.ejs','server/views/shop/footer.ejs','index.html','about.html','trainers.html','trainer.html','shop.html','product.html','cart.html']) {
    const html=await readFile(file,'utf8'); assert.match(html,/href="\/schedule.html"/); assert.doesNotMatch(html,/data-preview="Расписание"/);
  }
  const worker=await readFile('server/modules/push/sw.js','utf8'); assert.doesNotMatch(worker,/public-schedule|schedule\.html/);
});
