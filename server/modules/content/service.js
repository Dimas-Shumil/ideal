import {createHash} from 'node:crypto';
import {z} from 'zod';
import {accessLock} from '../../db/client.js';
import {audit} from '../audit/service.js';
import {publicTrainerWhere} from '../public/trainers.js';
import {entryKey,entryBody,order,publication,photoMeta,removePhoto,photoSlots,normalizedData} from './schema.js';
export const fail=(status,message)=>Object.assign(new Error(message),{status});
const uuid=z.string().uuid();
export const photoMetadataSelect={id:true,publicKey:true,slot:true,alt:true,caption:true,visible:true,publicOrder:true};
export const entrySelect={id:true,key:true,data:true,visible:true,publicOrder:true,version:true,photos:{select:photoMetadataSelect,orderBy:[{publicOrder:'asc'},{id:'asc'}]}};
export function contentService(prisma) {
 async function current(tx,key,version) {
  const p=await tx.contentEntry.findUnique({where:{key},select:entrySelect});
  if(!p) throw fail(404,'Раздел не найден.');
  if(version!==undefined&&version!==p.version) throw fail(409,'Контент изменён. Обновите страницу и повторите действие.');
  return p;
 }
 async function mutate(ctx,key,action,input,fn) {
  entryKey.parse(key); uuid.parse(ctx.key);
  z.number().int().min(1).parse(ctx.version);
  const fingerprint=createHash('sha256').update(JSON.stringify({key,action,input,version:ctx.version})).digest('hex');
  return prisma.$transaction(async tx=>{
   await accessLock(tx);
   const actor=await tx.user.findUnique({where:{id:ctx.actorId}});
   if(!actor?.active||actor.role!=='OWNER'||actor.authVersion!==ctx.authVersion||!ctx.sessionId||!await tx.authSession.findFirst({where:{sid:ctx.sessionId,userId:actor.id,authVersion:actor.authVersion,expire:{gt:new Date()},absoluteAt:{gt:new Date()}}})) throw fail(403,'Доступ запрещён.');
   const old=await tx.crmOperation.findUnique({where:{actorId_key:{actorId:actor.id,key:ctx.key}}});
   if(old){if(old.fingerprint!==fingerprint) throw fail(409,'Эта форма уже использована.'); return old.result;}
   const p=await current(tx,key,ctx.version);
   await fn(tx,p);
   await tx.contentEntry.update({where:{id:p.id},data:{version:{increment:1}}});
   const result={key};
   await tx.crmOperation.create({data:{actorId:actor.id,key:ctx.key,fingerprint,result}});
   await audit(tx,action,{actorId:actor.id,targetId:p.id,requestId:ctx.requestId});
   return result;
  },{maxWait:10000,timeout:15000});
 }
 async function photo(tx,p,id) {
  uuid.parse(id);
  const row=await tx.contentPhoto.findFirst({where:{id,entryId:p.id},select:photoMetadataSelect});
  if(!row)throw fail(404,'Фотография не найдена.'); return row;
 }
 return {
  list:()=>prisma.contentEntry.findMany({select:entrySelect,orderBy:{key:'asc'}}),
  async get(key){entryKey.parse(key); const p=await current(prisma,key); return {...p,data:normalizedData(key,p.data)};},
  async save(ctx,key,input){
   const {publicOrder,...fields}=z.object({publicOrder:order}).passthrough().parse(input);
   const data=entryBody(key).parse(fields);
   return mutate(ctx,key,'CONTENT_SAVE',{data,publicOrder},async(tx,p)=>{
    if(key==='home'&&data.trainerId&&!await tx.trainerProfile.findFirst({where:{...publicTrainerWhere,id:data.trainerId,photo:{isNot:null}},select:{id:true}}))throw fail(409,'Выберите опубликованный профиль активного тренера с именем и фотографией.');
    if(p.visible&&['gym','group','personal'].includes(key)&&(!data.title||!data.summary||!data.body))throw fail(409,'Сначала скройте направление либо заполните название и описания.');
    await tx.contentEntry.update({where:{id:p.id},data:{data,publicOrder,...(key==='contacts'?{visible:true}:{})}});
   });
  },
  async publish(ctx,key,input){const data=publication.parse(input);return mutate(ctx,key,'CONTENT_PUBLISH',data,async(tx,p)=>{
   const d=normalizedData(key,p.data);
   if(data.visible==='true'&&['gym','group','personal'].includes(key)&&(!d.title||!d.summary||!d.body))throw fail(409,'Для публикации нужны название и оба описания.');
   await tx.contentEntry.update({where:{id:p.id},data:{visible:data.visible==='true'}});
  });},
  async upload(ctx,key,slot,id,bytes){
   if(!Object.hasOwn(photoSlots(key),slot))throw fail(400,'Недопустимое место фотографии.');
   if(id)uuid.parse(id);
   const digest=createHash('sha256').update(bytes).digest('hex');
   return mutate(ctx,key,'CONTENT_PHOTO_SAVE',{slot,id:id||null,digest},async(tx,p)=>{
    if(id){const old=await photo(tx,p,id); if(old.slot!==slot)throw fail(400,'Недопустимое место фотографии.');await tx.contentPhoto.update({where:{id},data:{data:bytes}});}
    else {
     if(p.photos.filter(x=>x.slot===slot).length>=photoSlots(key)[slot])throw fail(409,'Достигнут лимит фотографий этого блока. Замените или удалите прежнюю.');
     await tx.contentPhoto.create({data:{entryId:p.id,slot,data:bytes}});
    }
   });
  },
  async metadata(ctx,key,id,input){const data=photoMeta.parse(input);return mutate(ctx,key,'CONTENT_PHOTO_META',{id,...data},async(tx,p)=>{
   await photo(tx,p,id);await tx.contentPhoto.update({where:{id},data:{alt:data.alt,caption:data.caption,publicOrder:data.publicOrder,visible:data.visible==='true'}});
  });},
  async remove(ctx,key,id,input){const data=removePhoto.parse(input);return mutate(ctx,key,'CONTENT_PHOTO_DELETE',{id,...data},async(tx,p)=>{
   await photo(tx,p,id);await tx.contentPhoto.delete({where:{id}});
  });},
 };
}
