import {Router} from 'express';
import ejs from 'ejs';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {seoFor} from '../public/seo.js';
import {publicTrainerWhere,publicTrainerCardSelect,trainerDto} from '../public/trainers.js';
import {normalizedData,directionKeys} from './schema.js';
export const publicPhotoSelect={publicKey:true,slot:true,alt:true,caption:true};
export const publicEntrySelect={key:true,data:true,photos:{where:{visible:true,alt:{not:''}},select:publicPhotoSelect,orderBy:[{publicOrder:'asc'},{id:'asc'}]}};
export const publicDirectionWhere={visible:true,key:{in:directionKeys}};
export const photoDto=p=>({url:'/content/photos/'+p.publicKey,slot:p.slot,alt:p.alt,caption:p.caption});
export function directionDto(p){const d=normalizedData(p.key,p.data);return {title:d.title,summary:d.summary,body:d.body,url:'/directions/'+p.key,photos:p.photos.map(photoDto)};}
export async function directions(prisma){return (await prisma.contentEntry.findMany({where:publicDirectionWhere,select:publicEntrySelect,orderBy:[{publicOrder:'asc'},{key:'asc'}]})).map(directionDto);}
export async function contacts(prisma){
 const row=await prisma.contentEntry.findFirst({where:{key:'contacts',visible:true},select:{data:true}});
 return normalizedData('contacts',row?.data);
}
export async function featuredTrainer(prisma){
 const p=await prisma.contentEntry.findFirst({where:{key:'home',visible:true},select:{data:true}});
 const id=normalizedData('home',p?.data).trainerId;
 if(!id)return null;
 const row=await prisma.trainerProfile.findFirst({where:{...publicTrainerWhere,id,photo:{isNot:null}},select:publicTrainerCardSelect});
 return row?trainerDto(row,false):null;
}
export const renderContent=(name,data)=>ejs.renderFile(fileURLToPath(new URL('../../views/content/'+name+'.ejs',import.meta.url)),data);
export async function renderHomeContent(prisma,html,siteContacts){
 const [items,trainer]=await Promise.all([directions(prisma),featuredTrainer(prisma)]);
 const [cards,cta,contact]=await Promise.all([renderContent('directions',{items}),renderContent('featured',{trainer}),renderContent('contacts',{siteContacts})]);
 return html.replace(/<section\s+class="directions"[\s\S]*?<\/section>/,()=>cards)
 .replace(/<section class="trainer-cta"[\s\S]*?<\/section>/,()=>cta)
 .replace(/<div class="ideal-footer__contacts">[\s\S]*?<\/div>/,()=>contact)
 .replace(/<p class="hero__address">[\s\S]*?<\/p>/,()=>'<p class="hero__address">'+ejs.escapeXML(siteContacts.address)+'</p>')
 .replace(/<p class="hero__hours">[\s\S]*?<\/p>/,()=>'<p class="hero__hours">'+ejs.escapeXML(siteContacts.hours)+'</p>')
 .replace(/<p class="menu-panel__footnote">[\s\S]*?<\/p>/,()=>'<p class="menu-panel__footnote">ИДЕАЛ · АБАКАН<br>'+ejs.escapeXML(siteContacts.address)+'</p>');
}
export function contentPublicRoutes({prisma,config}){
 const r=Router();
 r.use(['/about.html','/directions','/content/photos'],(req,res,next)=>{res.set('Cache-Control','no-store');res.set('X-Robots-Tag','noindex,follow');next();});
 const seo=(path,title)=>({...seoFor(config,path),title,description:'Информация спортивного клуба ИДЕАЛ в Абакане.',robots:'noindex,follow'});
 r.get('/about.html',async(req,res)=>{
  z.object({}).strict().parse(req.query);
  const row=await prisma.contentEntry.findFirst({where:{key:'about',visible:true},select:publicEntrySelect});
  res.render('content/about',{seo:seo(req.path,'О клубе — ИДЕАЛ / Абакан'),about:row?{...normalizedData('about',row.data),photos:row.photos.map(photoDto)}:null});
 });
 r.get('/directions/:key',async(req,res)=>{
  if(!directionKeys.includes(req.params.key))return res.sendStatus(404);
  z.object({}).strict().parse(req.query);
  const row=await prisma.contentEntry.findFirst({where:{key:req.params.key,visible:true},select:publicEntrySelect});
  if(!row)return res.status(404).render('content/direction',{seo:seo(req.path,'Направление — ИДЕАЛ'),item:null});
  const item=directionDto(row);
  res.render('content/direction',{seo:seo(req.path,item.title+' — ИДЕАЛ'),item});
 });
 r.get('/content/photos/:key',async(req,res)=>{
  if(!/^[a-f0-9]{32}$/.test(req.params.key))return res.sendStatus(404);
  z.object({}).strict().parse(req.query);
  const p=await prisma.contentPhoto.findFirst({where:{publicKey:req.params.key,visible:true,alt:{not:''},entry:{visible:true,key:{in:['about',...directionKeys]}}},select:{data:true}});
  if(!p)return res.sendStatus(404);
  res.type('image/webp').send(Buffer.from(p.data));
 });
 r.use((err,req,res,next)=>{if(err.name==='ZodError'||err.status)return next(err);next(Object.assign(new Error('Контент временно недоступен.'),{status:503}));});
 return r;
}
// Load only for public HTML routes, before session middleware. Errors propagate as 503.
export function publicContacts(prisma){return async(req,res,next)=>{
 const paths=['/','/about.html','/schedule.html','/trainers.html','/shop.html','/product.html','/cart.html'];
 if(!paths.includes(req.path)&&!/^\/(?:directions\/[^/]+|trainers\/[a-f0-9]{32}|shop\/order\/[^/]+)$/.test(req.path))return next();
 try{res.locals.siteContacts=await contacts(prisma);res.set('Cache-Control','no-store');next();}catch{next(Object.assign(new Error('Контакты временно недоступны.'),{status:503}));}
};}
