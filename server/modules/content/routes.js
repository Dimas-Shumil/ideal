import {Router} from 'express';
import {randomUUID} from 'node:crypto';
import {rateLimit} from 'express-rate-limit';
import {z} from 'zod';
import {requireAuth,requireRole} from '../../middleware/auth.js';
import {csrf} from '../../middleware/csrf.js';
import {parseImage,normalizeImage} from '../shop/images.js';
import {publicTrainerWhere} from '../public/trainers.js';
import {contentService,fail} from './service.js';
import {definitions,operation,entryKey,photoSlots} from './schema.js';
export function contentManagementRoutes({prisma,config}) {
 const r=Router(), service=contentService(prisma),guard=csrf(config), base='/admin/content';
 r.use(base,requireAuth,requireRole('OWNER'));
 const limit=rateLimit({windowMs:900000,limit:100,keyGenerator:req=>req.user.id,standardHeaders:'draft-8',legacyHeaders:false});
 const saveGuard=(req,res,next)=>guard(req,res,error=>{
  if(error?.status===403){
   // Keep CSRF and strict Origin protection. Explain why the request was rejected
   // instead of showing a generic failure that looks like a failed save.
   return res.status(403).render('auth/error',{
    message:'Изменения НЕ сохранены. Адрес браузера должен совпадать с APP_ORIGIN в .env (включая localhost/127.0.0.1 и порт). Обновите страницу входа на правильном адресе.',
    requestId:req.id,
   });
  }
  next(error);
 });
 const render=(req,res,data)=>res.render('content/panel',{user:req.user,csrf:req.session.csrf,newKey:randomUUID,definitions,photoSlots,...data});
 r.get(base,async(req,res)=>render(req,res,{page:'list',items:await service.list(),notice:req.query.saved==='1'?'Изменения сохранены.':''}));
 const editing=async entry=>{
  const p=await service.get(entry);
  const trainers=p.key==='home'?await prisma.trainerProfile.findMany({where:{...publicTrainerWhere,photo:{isNot:null}},select:{id:true,publicName:true},orderBy:[{publicOrder:'asc'},{publicKey:'asc'}]}):[];
  return {p,trainers};
 };
 r.get(base+'/:entry',async(req,res)=>{
  const {p,trainers}=await editing(req.params.entry);
  render(req,res,{page:'edit',p,trainers,notice:req.query.saved==='1'?'Сохранено. Данные записаны в базу. Откройте сайт по ссылке ниже и обновите страницу.':req.query.published==='1'?'Раздел опубликован.':'',warning:req.query.hidden==='1'?'Публикация выключена.':''});
 });
 r.get(base+'/:entry/photos/:id',async(req,res)=>{
  const key=entryKey.parse(req.params.entry),id=z.string().uuid().parse(req.params.id);
  const photo=await prisma.contentPhoto.findFirst({where:{id,entry:{key}},select:{data:true}});
  if(!photo)throw fail(404,'Фотография не найдена.');res.type('image/webp').send(Buffer.from(photo.data));
 });
 const action=(path,type,upload=false)=>r.post(base+path,limit,...(upload?[(req,res,next)=>req.get('Origin')===config.APP_ORIGIN?next():next(fail(403,'Доступ запрещён.')),parseImage]:[]),saveGuard,async(req,res,next)=>{
  try {
   const {_csrf,key,version,...data}=req.body||{};
   const meta=operation.parse({_csrf,key,version}),ctx={...meta,actorId:req.user.id,authVersion:req.user.authVersion,sessionId:req.sessionID,requestId:req.id};
   const entry=entryKey.parse(req.params.entry);
   let result;
   if(upload){z.object({}).strict().parse(data);result=await service.upload(ctx,entry,req.params.slot,req.params.id,await normalizeImage(req.shopImage));}
   else result=await service[type](ctx,entry,...(req.params.id?[req.params.id]:[]),data);
   res.redirect(303,base+'/'+result.key+(type==='save'?'?saved=1':type==='publish'?(data.visible==='true'?'?published=1':'?hidden=1'):'?saved=1'));
  }catch(e){
   if(type==='save' && (e.name==='ZodError'||[400,409].includes(e.status))){
    // Never discard entered fields on validation errors. In particular, a
    // rejected phone/map value must stay visible and explain why it failed.
    const {p,trainers}=await editing(req.params.entry);
    const fields=Object.keys(definitions[p.key].fields);
    const submitted=Object.fromEntries(fields.filter(k=>typeof req.body?.[k]==='string').map(k=>[k,req.body[k]]));
    const issue=e.name==='ZodError'?e.issues?.[0]:null;
    const field=issue?.path?.find(part=>typeof part==='string' && definitions[p.key].fields[part]);
    const label=field?definitions[p.key].fields[field][0]:null;
    const message=e.name==='ZodError'
      ?'Не сохранено: '+(label?label+' — ':'')+(issue?.message||'проверьте поля формы.')
      :e.message;
    return render(req,res.status(e.status||400),{page:'edit',p:{...p,data:{...p.data,...submitted}},trainers,validationError:message});
   }
   if(e.name==='ZodError'||[400,409].includes(e.status))return render(req,res.status(e.status||400),{page:'error',message:e.name==='ZodError'?'Проверьте поля и подтверждение. Данные не сохранены.':e.message});
   next(e);
  }
 });
 action('/:entry/save','save');action('/:entry/publish','publish');
 action('/:entry/photos/:slot/upload','upload',true);
 action('/:entry/photos/:slot/:id/replace','upload',true);
 action('/:entry/photos/:id/meta','metadata');action('/:entry/photos/:id/delete','remove');
 return r;
}
