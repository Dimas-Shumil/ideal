// In-memory transaction fixture, not a PostgreSQL/concurrency substitute.
import {randomUUID} from 'node:crypto';
import {coachService} from '../../server/modules/coach/service.js';
export function coachFixture(){
 const users=['TRAINER','TRAINER','OWNER','ADMIN'].map((role,i)=>({id:randomUUID(),role,active:true,authVersion:1,displayName:['Тренер А','Тренер Б','Владелец','Администратор'][i]}));
 const state={user:users,coachClient:[],coachSession:[],coachExpense:[],coachTask:[],lesson:[],visit:[],operations:[],audits:[],subscriptions:[],deliveries:[],sessionActive:true,auditDown:false};
 const relation=(r,k)=>k==='user'?state.user.find(x=>x.id===r.userId):k==='client'?state.coachClient.find(x=>x.id===r.clientId):['coachClients','coachSessions','coachExpenses','coachTasks'].includes(k)?state[{coachClients:'coachClient',coachSessions:'coachSession',coachExpenses:'coachExpense',coachTasks:'coachTask'}[k]].filter(x=>x.userId===r.id):r[k];
 function match(r,w={}){return Object.entries(w).every(([k,v])=>{if(k==='OR')return v.some(x=>match(r,x));if(k==='AND')return v.every(x=>match(r,x));const a=relation(r,k);if(v===null||typeof v!=='object'||v instanceof Date)return v instanceof Date?a?.getTime()===v.getTime():a===v;return Object.entries(v).every(([op,b])=>op==='gte'?a>=b:op==='gt'?a>b:op==='lte'?a<=b:op==='lt'?a<b:op==='not'?a!==b:op==='in'?b.includes(a):op==='some'?a.some(x=>match(x,b)):match(a||{},{[op]:b}));});}
 function project(r,q={}){if(!r)return null;const out=q.select?{}:{...r};for(const[k,v]of Object.entries(q.select||q.include||{})){const rel=relation(r,k);out[k]=v===true?rel:rel?project(rel,v):rel;}return structuredClone(out);}
 const tx={$executeRaw:async()=>1};
 for(const model of ['user','coachClient','coachSession','coachExpense','coachTask','lesson','visit']){
  tx[model]={
   findUnique:async q=>project(state[model].find(r=>match(r,q.where)),q),findFirst:async q=>project(state[model].find(r=>match(r,q.where)),q),
   findMany:async(q={})=>{let rows=state[model].filter(r=>match(r,q.where));const order=Array.isArray(q.orderBy)?q.orderBy:q.orderBy?[q.orderBy]:[];rows.sort((a,b)=>{for(const fields of order)for(const[k,d]of Object.entries(fields)){if(a[k]<b[k])return d==='asc'?-1:1;if(a[k]>b[k])return d==='asc'?1:-1;}return 0;});if(q.cursor)rows=rows.slice(rows.findIndex(r=>r.id===q.cursor.id)+(q.skip||0));else rows=rows.slice(q.skip||0);return rows.slice(0,q.take||rows.length).map(r=>project(r,q));},
   count:async q=>state[model].filter(r=>match(r,q.where)).length,
   aggregate:async q=>({_sum:Object.fromEntries(Object.keys(q._sum).map(k=>[k,state[model].filter(r=>match(r,q.where)).reduce((s,r)=>s+(r[k]||0),0)]))}),
   create:async({data})=>{const row={id:randomUUID(),version:1,createdAt:new Date(),updatedAt:new Date(),...data};state[model].push(structuredClone(row));return row;},
   update:async({where,data})=>{const row=state[model].find(r=>match(r,where));if(!row)throw Error('MISSING_ROW');for(const[k,v]of Object.entries(data))row[k]=v&&typeof v==='object'&&'increment'in v?row[k]+v.increment:v;return structuredClone(row);},
   updateMany:async({where,data})=>{let count=0;for(const row of state[model])if(match(row,where)){Object.assign(row,data);count++;}return {count};},
   delete:async({where})=>{const row=state[model].find(r=>match(r,where));if(!row)throw Error('MISSING_ROW');state[model]=state[model].filter(r=>r!==row);return row;},
  };
 }
 tx.authSession={findFirst:async q=>state.sessionActive&&q.where.sid==='valid'&&state.user.some(u=>u.id===q.where.userId&&u.authVersion===q.where.authVersion)?{}:null};
 tx.crmOperation={findUnique:async q=>state.operations.find(x=>x.actorId===q.where.actorId_key.actorId&&x.key===q.where.actorId_key.key),create:async({data})=>state.operations.push(structuredClone(data))};
 tx.auditEvent={create:async({data})=>{if(state.auditDown)throw Error('AUDIT_DOWN');state.audits.push(data);}};
 tx.pushSubscription={findMany:async q=>state.subscriptions.filter(r=>match(r,q.where))};
 tx.pushDelivery={createMany:async({data})=>{let count=0;for(const d of data)if(!state.deliveries.some(x=>x.eventKey===d.eventKey&&x.subscriptionId===d.subscriptionId)){state.deliveries.push(d);count++;}return {count};}};
 const prisma={...tx,$transaction:async fn=>{const backup=structuredClone(state);try{return await fn(tx);}catch(e){Object.assign(state,backup);throw e;}}};
 const ctx=(i=0,extra={})=>({actorId:state.user[i].id,role:state.user[i].role,authVersion:state.user[i].authVersion,sessionId:'valid',key:randomUUID(),...extra});
 return {state,prisma,ctx,service:coachService(prisma)};
}
