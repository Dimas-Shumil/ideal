// PostgreSQL integration suite. Run via npm test with a separate *_test database.
import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {randomBytes,randomUUID} from 'node:crypto';
import {readConfig} from '../server/config/env.js';
import {createDatabase} from '../server/db/client.js';
import {createApp} from '../server/app.js';
import {clearCrm} from './helpers/crm.js';
import {clubDateTime} from '../server/modules/schedule/dates.js';
import {today,addDays} from '../server/modules/crm/dates.js';
const config=readConfig();
if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('_test'))throw Error('TEST_DB_REQUIRED');
const db=createDatabase(config.DATABASE_URL),password=randomBytes(24).toString('hex');
let app,store,users;const people={};
const input={name:'Персональный клиент',phone:'+79991112233',notes:'Личная заметка',archived:'false'};
async function login(name){const agent=request.agent(app),page=await agent.get('/login');const csrf=page.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];await agent.post('/login').set('Origin',config.APP_ORIGIN).type('form').send({_csrf:csrf,login:name,password}).expect(303);return {agent,csrf:(await agent.get('/api/auth/me').expect(200)).body.csrf};}
const post=(s,path,data={},code=200)=>s.agent.post('/api/trainer/workspace/'+path).set('Origin',config.APP_ORIGIN).send({_csrf:s.csrf,key:randomUUID(),...data}).expect(code);
before(async()=>{
 await clearCrm(db.prisma);await db.prisma.auditEvent.deleteMany();await db.prisma.authSession.deleteMany();await db.prisma.user.deleteMany();({app,store,users}=await createApp({config,db}));
 for(const [name,role]of [['coachowner','OWNER'],['coacha','TRAINER'],['coachb','TRAINER'],['coachadmin','ADMIN']])people[name]=await users.create({login:name,displayName:name,role,password});
});
beforeEach(async()=>{await clearCrm(db.prisma);await db.prisma.user.updateMany({where:{id:{in:[people.coacha.id,people.coachb.id]}},data:{role:'TRAINER',active:true}});});
after(async()=>{store?.close();await clearCrm(db.prisma);await db.prisma.auditEvent.deleteMany();await db.prisma.authSession.deleteMany();await db.prisma.user.deleteMany();await db.close();});
test('coach PostgreSQL: independent clients, all read/mutation boundaries and readonly owner',async()=>{
 const a=await login('coacha'),b=await login('coachb'),o=await login('coachowner'),admin=await login('coachadmin');
 const created=await post(a,'clients',input),id=created.body.id;
 await b.agent.get('/api/trainer/workspace/clients/'+id).expect(404);await post(b,'clients/'+id,{...input,version:1},404);
 assert.equal((await b.agent.get('/api/trainer/workspace/clients').expect(200)).body.total,0);
 await a.agent.get('/api/trainer/workspace/clients?userId='+people.coachb.id).expect(400);
 await post(a,'clients',{...input,userId:people.coachb.id},400);
 const path='/api/admin/trainer-workspaces/'+people.coacha.id+'/clients';
 await a.agent.get(path).expect(403);await admin.agent.get(path).expect(403);assert.equal((await o.agent.get(path).expect(200)).body.items[0].id,id);
 await o.agent.post(path).set('Origin',config.APP_ORIGIN).send({_csrf:o.csrf,key:randomUUID(),...input}).expect(404);
 await admin.agent.get('/api/trainer/workspace/clients').expect(403);
});
test('coach PostgreSQL: composite FK and amount checks reject direct mismatched writes',async()=>{
 const p=db.prisma,c=await p.coachClient.create({data:{userId:people.coacha.id,name:'Клиент А'}});
 const data={userId:people.coachb.id,clientId:c.id,startsAt:clubDateTime(today(),'12:00'),endsAt:clubDateTime(today(),'13:00'),priceCents:1000};
 await assert.rejects(p.coachSession.create({data}));
 await assert.rejects(p.coachExpense.create({data:{userId:people.coacha.id,title:'Неверный расход',category:'Тест',expenseDate:new Date(),amountCents:-1}}));
});
test('coach PostgreSQL: completed income, month totals and stale concurrent forms',async()=>{
 const a=await login('coacha'),b=await login('coachb'),o=await login('coachowner');
 const ca=(await post(a,'clients',input)).body.id,cb=(await post(b,'clients',input)).body.id,day=addDays(today(),-1);
 const data={clientId:ca,startsAt:day+'T12:00',endsAt:day+'T13:00',price:'3500.25',status:'COMPLETED',comment:'',reminderMinutes:''};
 await post(a,'sessions',data);await post(b,'sessions',{...data,clientId:cb,price:'9000'});
 await post(a,'expenses',{title:'Инвентарь',category:'Зал',expenseDate:day,amount:'500.10',comment:''});
 const stats=(await a.agent.get('/api/trainer/workspace/statistics?month='+day.slice(0,7)).expect(200)).body.stats;
 assert.equal(stats.incomeCents,350025);assert.equal(stats.expenseCents,50010);assert.equal(stats.balanceCents,300015);
 const overview=(await o.agent.get('/api/admin/trainer-workspaces/'+people.coacha.id+'/statistics?month='+day.slice(0,7)).expect(200)).body;assert.equal(overview.stats.incomeCents,350025);
 const key=randomUUID();const send=()=>a.agent.post('/api/trainer/workspace/clients/'+ca).set('Origin',config.APP_ORIGIN).send({_csrf:a.csrf,key,version:1,...input,name:'Повтор формы'});
 const replay=await Promise.all([send(),send()]);assert.deepEqual(replay.map(r=>r.status),[200,200]);assert.equal((await db.prisma.coachClient.findUnique({where:{id:ca}})).version,2);
 await post(a,'clients/'+ca,{...input,version:1},409);
});
test('coach PostgreSQL: revoked trainer loses access, historic records retained for owner',async()=>{
 const a=await login('coacha'),o=await login('coachowner');const id=(await post(a,'clients',input)).body.id;
 await users.change(people.coacha.id,{active:false});await a.agent.get('/api/trainer/workspace/clients').expect(401);await post(a,'tasks',{title:'Задача',dueAt:'',reminderAt:'',comment:'',priority:'NORMAL',completed:'false'},401);
 const list=(await o.agent.get('/api/admin/trainer-workspaces/'+people.coacha.id+'/clients').expect(200)).body;assert.equal(list.items[0].id,id);
});
