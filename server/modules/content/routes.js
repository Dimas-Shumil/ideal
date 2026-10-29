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
 const render=(req,res,data)=>res.render('content/panel',{user:req.user,csrf:req.session.csrf,newKey:randomUUID,definitions,photoSlots,...data});
 r.get(base,async(req,res)=>render(req,res,{page:'list',items:await service.list()}));
 r.get(base+'/:entry',async(req,res)=>{
  const p=await service.get(req.params.entry);
  const trainers=p.key==='home'?await prisma.trainerProfile.findMany({where:{...publicTrainerWhere,photo:{isNot:null}},select:{id:true,publicName:true},orderBy:[{publicOrder:'asc'},{publicKey:'asc'}]}):[];
  render(req,res,{page:'edit',p,trainers});
 });
 r.get(base+'/:entry/photos/:id',async(req,res)=>{
  const key=entryKey.parse(req.params.entry),id=z.string().uuid().parse(req.params.id);
  const photo=await prisma.contentPhoto.findFirst({where:{id,entry:{key}},select:{data:true}});
  if(!photo)throw fail(404,'Фотография не найдена.');res.type('image/webp').send(Buffer.from(photo.data));
 });
 const action=(path,type,upload=false)=>r.post(base+path,limit,...(upload?[(req,res,next)=>req.get('Origin')===config.APP_ORIGIN?next():next(fail(403,'Доступ запрещён.')),parseImage]:[]),guard,async(req,res,next)=>{
  try {
   const {_csrf,key,version,...data}=req.body||{};
   const meta=operation.parse({_csrf,key,version}),ctx={...meta,actorId:req.user.id,authVersion:req.user.authVersion,sessionId:req.sessionID,requestId:req.id};
   const entry=entryKey.parse(req.params.entry);
   let result;
   if(upload){z.object({}).strict().parse(data);result=await service.upload(ctx,entry,req.params.slot,req.params.id,await normalizeImage(req.shopImage));}
   else result=await service[type](ctx,entry,...(req.params.id?[req.params.id]:[]),data);
   res.redirect(303,base+'/'+result.key);
  }catch(e){if(e.name==='ZodError'||[400,409].includes(e.status))return render(req,res.status(e.status||400),{page:'error',message:e.name==='ZodError'?'Проверьте поля и подтверждение. Данные не сохранены.':e.message});next(e);}
 });
 action('/:entry/save','save');action('/:entry/publish','publish');
 action('/:entry/photos/:slot/upload','upload',true);
 action('/:entry/photos/:slot/:id/replace','upload',true);
 action('/:entry/photos/:id/meta','metadata');action('/:entry/photos/:id/delete','remove');
 return r;
}
