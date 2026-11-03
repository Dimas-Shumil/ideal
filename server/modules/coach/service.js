import {createHash} from 'node:crypto';
import {accessLock} from '../../db/client.js';
import {audit} from '../audit/service.js';
import {uuid,query,monthRange,models,schemas,deleteBody,fail,inputDate} from './schema.js';
const scopes=['TRAINER','OWNER'];
const check=(v,status=409,message='Данные изменились. Обновите страницу.')=>{if(!v)throw fail(status,message);};
export function coachService(prisma){
 async function actor(tx,ctx){
  const user=await tx.user.findUnique({where:{id:ctx.actorId},select:{id:true,role:true,active:true,authVersion:true}});
  check(user?.active&&scopes.includes(user.role)&&user.role===ctx.role&&user.authVersion===ctx.authVersion,403,'Доступ запрещён.');
  check(ctx.sessionId&&await tx.authSession.findFirst({where:{sid:ctx.sessionId,userId:user.id,authVersion:user.authVersion,expire:{gt:new Date()},absoluteAt:{gt:new Date()}}}),403,'Сессия завершена.');
  return user;
 }
 async function read(ctx,target,fn){
  return prisma.$transaction(async tx=>{
   await accessLock(tx);const user=await actor(tx,ctx);
   const userId=user.role==='TRAINER'?user.id:uuid.parse(target);
   // Even an explicit target passed to the service cannot widen a trainer's scope.
   if(user.role==='TRAINER'&&target&&target!==user.id)throw fail(404,'Кабинет не найден.');
   const coach=await tx.user.findFirst({where:{id:userId,OR:[{role:'TRAINER'},{coachClients:{some:{}}},{coachSessions:{some:{}}},{coachExpenses:{some:{}}},{coachTasks:{some:{}}}]},select:{id:true,displayName:true,active:true,role:true}});
   check(coach,404,'Кабинет не найден.');return fn(tx,userId,coach);
  },{maxWait:10000,timeout:15000});
 }
 async function summary(tx,userId,month){
  const range=monthRange(month),where={userId,startsAt:range};
  const [income,expenses,clients,completed,cancelled,upcoming,tasks,clubLessons,attendance]=await Promise.all([
   tx.coachSession.aggregate({where:{...where,status:'COMPLETED'},_sum:{priceCents:true}}),
   tx.coachExpense.aggregate({where:{userId,expenseDate:range},_sum:{amountCents:true}}),
   tx.coachClient.count({where:{userId,archived:false}}),
   tx.coachSession.count({where:{...where,status:'COMPLETED'}}),
   tx.coachSession.count({where:{...where,status:'CANCELLED'}}),
   tx.coachSession.count({where:{userId,status:'SCHEDULED',startsAt:{gte:new Date()}}}),
   tx.coachTask.count({where:{userId,completed:false}}),
   tx.lesson.count({where:{trainer:{userId},startsAt:range,status:'SCHEDULED'}}),
   tx.visit.count({where:{lesson:{trainer:{userId}},occurredAt:range,status:'CONFIRMED'}}),
  ]);
  const incomeCents=income._sum.priceCents||0,expenseCents=expenses._sum.amountCents||0;
  return {incomeCents,expenseCents,balanceCents:incomeCents-expenseCents,clients,completed,cancelled,upcoming,tasks,clubLessons,attendance};
 }
 return {
  async owners(ctx,input){
   const f=query.parse(input);return prisma.$transaction(async tx=>{
    await accessLock(tx);const user=await actor(tx,ctx);check(user.role==='OWNER',403,'Доступ запрещён.');
    const where={OR:[{role:'TRAINER'},{coachClients:{some:{}}},{coachSessions:{some:{}}},{coachExpenses:{some:{}}},{coachTasks:{some:{}}}]};
    const [items,total]=await Promise.all([tx.user.findMany({where,select:{id:true,displayName:true,active:true,role:true},orderBy:[{displayName:'asc'},{id:'asc'}],take:25,skip:(f.page-1)*25}),tx.user.count({where})]);
    const rows=[];for(const coach of items)rows.push({...coach,stats:await summary(tx,coach.id,f.month)});
    return {rows,total,filters:f};
   },{maxWait:10000,timeout:30000});
  },
  async page(ctx,target,page,input){
   const f=query.parse(input);return read(ctx,target,async(tx,userId,coach)=>{
    const data={coach,filters:f,items:[],total:0};const range=monthRange(f.month);
    if(['overview','statistics','expenses'].includes(page))data.stats=await summary(tx,userId,f.month);
    if(page==='overview'){
     data.items=await tx.coachSession.findMany({where:{userId,status:'SCHEDULED',startsAt:{gte:new Date()}},include:{client:{select:{name:true}}},orderBy:[{startsAt:'asc'},{id:'asc'}],take:8});
     data.tasks=await tx.coachTask.findMany({where:{userId,completed:false},orderBy:[{dueAt:'asc'},{id:'asc'}],take:8});
    }else if(page==='calendar'){
     data.items=await tx.coachSession.findMany({where:{userId,startsAt:range,status:{not:'CANCELLED'}},include:{client:{select:{name:true}}},orderBy:[{startsAt:'asc'},{id:'asc'}]});
     data.lessons=await tx.lesson.findMany({where:{trainer:{userId},startsAt:range,status:'SCHEDULED'},select:{id:true,title:true,kind:true,startsAt:true,endsAt:true},orderBy:[{startsAt:'asc'},{id:'asc'}]});
    }else if(models[page]){
     const where={userId,...(page==='clients'?{archived:f.archived==='true'}:page==='tasks'?{completed:f.completed==='true'}:page==='sessions'?{startsAt:range}:{expenseDate:range})};
     [data.items,data.total]=await Promise.all([tx[models[page]].findMany({where,...(page==='sessions'?{include:{client:{select:{name:true}}}}:{}),orderBy:page==='clients'?[{name:'asc'},{id:'asc'}]:page==='tasks'?[{dueAt:'asc'},{id:'asc'}]:page==='sessions'?[{startsAt:'desc'},{id:'asc'}]:[{expenseDate:'desc'},{id:'asc'}],take:25,skip:(f.page-1)*25}),tx[models[page]].count({where})]);
    }
    return data;
   });
  },
  async form(ctx,target,kind,id){
   check(models[kind],404,'Раздел не найден.');if(id)uuid.parse(id);
   return read(ctx,target,async(tx,userId,coach)=>{
    const item=id?await tx[models[kind]].findFirst({where:{id,userId}}):null;check(!id||item,404,'Запись не найдена.');
    const clients=kind==='sessions'?await tx.coachClient.findMany({where:{userId,OR:[{archived:false},...(item?[{id:item.clientId}]:[])]},select:{id:true,name:true,archived:true},orderBy:[{name:'asc'},{id:'asc'}]}):[];
    return {coach,item,clients};
   });
  },
  async save(ctx,kind,id,input,remove=false){
   check(models[kind],404,'Раздел не найден.');if(id)uuid.parse(id);uuid.parse(ctx.key);
   const raw=remove?deleteBody.parse(input):schemas[kind].parse(input);
   check(!remove||['expenses','tasks'].includes(kind),400,'Эту запись можно архивировать или отменить.');
   const fingerprint=createHash('sha256').update(JSON.stringify({kind,id,input:raw,remove,version:ctx.version})).digest('hex');
   return prisma.$transaction(async tx=>{
    await accessLock(tx);const user=await actor(tx,ctx);check(user.role==='TRAINER',403,'Доступ запрещён.');const userId=user.id;
    const previous=await tx.crmOperation.findUnique({where:{actorId_key:{actorId:userId,key:ctx.key}}});
    if(previous){check(previous.fingerprint===fingerprint);return previous.result;}
    const old=id?await tx[models[kind]].findFirst({where:{id,userId}}):null;check(!id||old,404,'Запись не найдена.');check(!old||old.version===ctx.version);
    let data={...raw};
    if(kind==='sessions'&&!remove){
     const client=await tx.coachClient.findFirst({where:{id:data.clientId,userId}});check(client,404,'Клиент не найден.');
     check(!client.archived||old?.clientId===client.id,409,'Клиент находится в архиве.');
     if(data.status!=='CANCELLED'){
      check(!await tx.coachSession.findFirst({where:{userId,status:{not:'CANCELLED'},...(id?{id:{not:id}}:{}),startsAt:{lt:data.endsAt},endsAt:{gt:data.startsAt}}}),409,'В это время уже есть персональная тренировка.');
      check(!await tx.lesson.findFirst({where:{trainer:{userId},status:'SCHEDULED',startsAt:{lt:data.endsAt},endsAt:{gt:data.startsAt}}}),409,'В это время есть занятие в расписании клуба.');
     }
     if(!old||old.startsAt.getTime()!==data.startsAt.getTime()||old.reminderMinutes!==data.reminderMinutes)data.reminderSentAt=null;
     data.priceCents=data.price;delete data.price;
    }
    if(kind==='expenses'&&!remove){data.amountCents=data.amount;delete data.amount;}
    if(kind==='tasks'&&!remove){
     data.completedAt=data.completed?(old?.completedAt||new Date()):null;
     if(!old||(old.reminderAt?.getTime()||0)!==(data.reminderAt?.getTime()||0))data.reminderSentAt=null;
    }
    let saved;
    if(remove){await tx[models[kind]].delete({where:{id,userId,version:ctx.version}});saved={id};}
    else if(old)saved=await tx[models[kind]].update({where:{id,userId,version:ctx.version},data:{...data,version:{increment:1}}});
    else saved=await tx[models[kind]].create({data:{...data,userId}});
    const source=remove?old:data;
    const filters=kind==='sessions'?{month:inputDate(source.startsAt).slice(0,7)}:kind==='expenses'?{month:inputDate(source.expenseDate).slice(0,7)}:kind==='tasks'?{completed:String(source.completed)}:{archived:String(source.archived)};
    const result={id:saved.id,query:new URLSearchParams(filters).toString()};
    await tx.crmOperation.create({data:{actorId:userId,key:ctx.key,fingerprint,result}});
    await audit(tx,`COACH_${kind.toUpperCase()}_${remove?'DELETE':old?'UPDATE':'CREATE'}`,{actorId:userId,targetId:saved.id,requestId:ctx.requestId});
    return result;
   },{maxWait:10000,timeout:15000});
  },
 };
}
