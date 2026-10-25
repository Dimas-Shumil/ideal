// In-memory transaction fixture. It is not a PostgreSQL concurrency/migration test.
import {randomUUID} from 'node:crypto';
import {contentService} from '../../server/modules/content/service.js';
export function contentFixture(){
 const actor={id:randomUUID(),role:'OWNER',active:true,authVersion:1};
 const state={entries:['gym','group','personal','about','home','contacts'].map(key=>({id:randomUUID(),key,data:{},visible:false,publicOrder:0,version:1})),photos:[],operations:[],audits:[],eligibleTrainer:false,liveSession:true,auditDown:false};
 const entry=q=>state.entries.find(x=>q.where.key?x.key===q.where.key:x.id===q.where.id);
 const tx={
  $executeRaw:async()=>1,
  user:{findUnique:async()=>({...actor})},
  authSession:{findFirst:async q=>state.liveSession&&q.where.sid==='valid'&&q.where.userId===actor.id&&q.where.authVersion===actor.authVersion?{}:null},
  crmOperation:{findUnique:async q=>state.operations.find(x=>x.key===q.where.actorId_key.key&&x.actorId===q.where.actorId_key.actorId),create:async({data})=>state.operations.push(data)},
  auditEvent:{create:async({data})=>{if(state.auditDown)throw Error('AUDIT_DOWN');state.audits.push(data);}},
  trainerProfile:{findFirst:async()=>state.eligibleTrainer?{id:randomUUID()}:null},
  contentEntry:{
   findUnique:async q=>{const p=entry(q);return p?structuredClone({...p,photos:state.photos.filter(x=>x.entryId===p.id)}):null;},
   findMany:async()=>state.entries.map(p=>({...p,photos:state.photos.filter(x=>x.entryId===p.id)})),
   update:async q=>{const p=entry(q);for(const[k,v]of Object.entries(q.data))p[k]=k==='version'?p.version+v.increment:v;return p;},
  },
  contentPhoto:{
   findFirst:async q=>state.photos.find(x=>x.id===q.where.id&&x.entryId===q.where.entryId),
   create:async({data})=>{const p={id:randomUUID(),publicKey:randomUUID().replaceAll('-',''),alt:'',caption:'',visible:false,publicOrder:0,...data};state.photos.push(p);return p;},
   update:async({where,data})=>{const p=state.photos.find(x=>x.id===where.id);Object.assign(p,data);return p;},
   delete:async({where})=>{state.photos=state.photos.filter(x=>x.id!==where.id);},
  },
 };
 const prisma={...tx,$transaction:async callback=>{const backup=structuredClone(state);try{return await callback(tx);}catch(e){Object.assign(state,backup);throw e;}}};
 const ctx=(key='gym')=>({actorId:actor.id,authVersion:actor.authVersion,sessionId:'valid',key:randomUUID(),version:state.entries.find(x=>x.key===key).version});
 return {state,actor,prisma,ctx,service:contentService(prisma)};
}
