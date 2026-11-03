import {Router} from 'express';
import {randomUUID} from 'node:crypto';
import {rateLimit} from 'express-rate-limit';
import {requireAuth,requireRole} from '../../middleware/auth.js';
import {csrf} from '../../middleware/csrf.js';
import {coachService} from './service.js';
import {models,operation,query,uuid,inputDate} from './schema.js';
import {today} from '../crm/dates.js';
import {clubParts} from '../schedule/dates.js';
const pages=['overview','clients','sessions','expenses','tasks','calendar','statistics'];
export function coachRoutes({config,prisma}){
 const r=Router(),service=coachService(prisma),guard=csrf(config);
 const ctx=req=>({actorId:req.user.id,role:req.user.role,authVersion:req.user.authVersion,sessionId:req.sessionID,requestId:req.id});
 const limit=rateLimit({windowMs:900000,limit:120,keyGenerator:req=>req.user.id,standardHeaders:'draft-8',legacyHeaders:false});
 r.use(['/trainer/workspace','/api/trainer/workspace'],requireAuth,requireRole('TRAINER'));
 r.use(['/admin/trainer-workspaces','/api/admin/trainer-workspaces'],requireAuth,requireRole('OWNER'));
 const render=(req,res,page,data={})=>res.render('coach/panel',{
  user:req.user,csrf:req.session.csrf,newKey:randomUUID,today:today(),inputDate,club:clubParts,
  money:v=>(v/100).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}),
  readOnly:req.user.role==='OWNER',page,base:'/trainer/workspace',filters:query.parse({}),...data,
 });
 r.get('/trainer',requireAuth,requireRole('TRAINER'),async(req,res)=>render(req,res,'overview',await service.page(ctx(req),null,'overview',{})));
 for(const prefix of ['/trainer/workspace','/api/trainer/workspace','/admin/trainer-workspaces/:userId','/api/admin/trainer-workspaces/:userId']){
  const target=req=>req.params.userId||null;
  const base=req=>req.params.userId?'/admin/trainer-workspaces/'+uuid.parse(req.params.userId):'/trainer/workspace';
  const output=(req,res,page,data)=>req.path.startsWith('/api/')?res.json(data):render(req,res,page,{...data,base:base(req)});
  r.get(prefix,async(req,res)=>output(req,res,'overview',await service.page(ctx(req),target(req),'overview',req.query)));
  for(const page of pages.filter(v=>v!=='overview')){
   r.get(prefix+'/'+page,async(req,res)=>output(req,res,page,await service.page(ctx(req),target(req),page,req.query)));
   if(models[page]){
    if(!prefix.includes('/admin/'))r.get(prefix+'/'+page+'/new',async(req,res)=>output(req,res,'form',{...await service.form(ctx(req),null,page,null),kind:page,filters:query.parse(req.query)}));
    r.get(prefix+'/'+page+'/:id',async(req,res)=>output(req,res,'form',{...await service.form(ctx(req),target(req),page,req.params.id),kind:page,filters:query.parse(req.query)}));
   }
  }
 }
 for(const kind of Object.keys(models))for(const action of ['create','update','delete']){
  if(action==='delete'&&!['expenses','tasks'].includes(kind))continue;
  const path='/trainer/workspace/'+kind+(action==='create'?'':'/:id')+(action==='delete'?'/delete':'');
  r.post([path,'/api'+path],limit,guard,async(req,res,next)=>{
   try{
    const {_csrf,key,version,...input}=req.body||{};const meta=operation.parse({_csrf,key,version});
    const result=await service.save({...ctx(req),...meta},kind,req.params.id||null,input,action==='delete');
    return req.path.startsWith('/api/')?res.json({ok:true,...result}):res.redirect(303,'/trainer/workspace/'+kind+'?'+result.query);
   }catch(error){
    if(req.path.startsWith('/api/')||!(error.name==='ZodError'||[400,404,409].includes(error.status)))return next(error);
    return render(req,res.status(error.status||400),'error',{message:error.name==='ZodError'?'Проверьте поля, даты, суммы и подтверждение. Изменения не сохранены.':error.message,back:'/trainer/workspace/'+kind});
   }
  });
 }
 r.get(['/admin/trainer-workspaces','/api/admin/trainer-workspaces'],async(req,res)=>{
  const data=await service.owners(ctx(req),req.query);
  return req.path.startsWith('/api/')?res.json(data):render(req,res,'owners',{...data,base:'/admin/trainer-workspaces'});
 });
 return r;
}
