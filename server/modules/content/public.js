import { Router } from 'express';
import ejs from 'ejs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { seoFor } from '../public/seo.js';
import { publicTrainerWhere } from '../public/trainers.js';
import { normalizedData, directionKeys } from './schema.js';

const root = fileURLToPath(new URL('../../views/content/', import.meta.url));
export const CLUB_PHONE = '+73902287386';
export const CLUB_PHONE_DISPLAY = '+7 (3902) 28-73-86';
export const SITE_CONTACTS = Object.freeze({
 address:'Абакан, ул. Бограда, 135',hours:'Ежедневно с 08:00 до 22:00',
 phone:CLUB_PHONE,phoneDisplay:CLUB_PHONE_DISPLAY,
 map:'https://2gis.ru/abakan/firm/9711414977502434',vk:'',telegram:''
});
export const STATIC_DIRECTIONS = Object.freeze([
 {key:'gym',title:'Тренажёрный зал',summary:'Силовые тренировки в своём ритме.',body:'Тренируйтесь самостоятельно или с поддержкой тренера. Информацию об условиях посещения уточняйте в клубе.',cover:'/site/img/direction-gym.webp'},
 {key:'group',title:'Групповые занятия',summary:'Тренировки вместе с группой.',body:'Актуальные занятия и время их проведения опубликованы в расписании клуба.',cover:'/site/img/direction-group.webp'},
 {key:'personal',title:'Персональные тренировки',summary:'Индивидуальный подход к твоим целям.',body:'Выберите тренера и уточните возможность персональных занятий по телефону клуба.',cover:'/site/img/direction-personal.webp'}
]);
export const STATIC_ABOUT = Object.freeze({
 title:'О КЛУБЕ ИДЕАЛ',summary:'Спортивный клуб в Абакане. Тренируйся в своём ритме.',
 storyTitle:'ТВОЁ МЕСТО ДЛЯ ДВИЖЕНИЯ.',body:'ИДЕАЛ — пространство для тренировок в Абакане. Выбирай свой формат: тренажёрный зал, занятия в группе или персональная работа с тренером.',
 spaceTitle:'ПРОСТРАНСТВО КЛУБА',spaceText:'Узнать об условиях посещения и времени работы можно по телефону клуба.',
 feature1:'Тренажёрный зал',feature1Text:'Выбирай подходящий темп тренировки.',
 feature2:'Групповые занятия',feature2Text:'Смотри действующее расписание занятий на сайте.',
 feature3:'Персональная работа',feature3Text:'Знакомься с тренерами клуба и их профилями.',photos:[]
});
const photoDto = p => ({url:'/content/photos/'+p.publicKey,slot:p.slot,alt:p.alt,caption:p.caption});
const fallbackCard = item => ({title:item.title,summary:item.summary,body:item.body,url:'/directions/'+item.key,photos:[{url:item.cover,slot:'cover',alt:item.title,caption:''}]});
export const staticDirectionCards = Object.freeze(STATIC_DIRECTIONS.map(fallbackCard));
const unconfigured = p => !p || (p.version===1 && !p.visible && Object.values(p.data||{}).every(v=>!v));
// The original migration seeded blank, hidden editorial records. Until an owner edits them,
// show the already approved bundled layout. Explicit hide/publish overrides this fallback.
const visible = p => p?.visible || unconfigured(p);
function publicPhotos(p){return (p?.photos||[]).filter(x=>x.visible&&x.alt).map(photoDto);}
export function directionCards(rows){
 const byKey=new Map(rows.map(p=>[p.key,p]));
 return STATIC_DIRECTIONS.flatMap(fallback=>{
  const p=byKey.get(fallback.key);
  if(!visible(p))return [];
  if(unconfigured(p))return [fallbackCard(fallback)];
  const d=normalizedData(fallback.key,p.data);
  if(!d.title||!d.summary||!d.body)return [];
  const photos=publicPhotos(p);
  return [{title:d.title,summary:d.summary,body:d.body,url:'/directions/'+fallback.key,photos,publicOrder:p.publicOrder}];
 }).sort((a,b)=>(a.publicOrder??STATIC_DIRECTIONS.findIndex(x=>'/directions/'+x.key===a.url))-(b.publicOrder??STATIC_DIRECTIONS.findIndex(x=>'/directions/'+x.key===b.url)));
}
export function aboutDto(p){
 if(!visible(p))return null;
 if(unconfigured(p))return STATIC_ABOUT;
 return {...normalizedData('about',p.data),photos:publicPhotos(p)};
}
export function normalisePhone(raw){
 const value=String(raw||'').trim();if(!value)return '';
 let digits=value.replace(/\D/g,'');
 if(digits.length===11&&digits.startsWith('8'))digits='7'+digits.slice(1);
 if(digits.length===10)digits='7'+digits;
 return digits.length>=11&&digits.length<=15?'+'+digits:'';
}
export function contactsFromEntry(p){
 // Contact details are live as soon as OWNER saves them. Their display is not
 // affected by the legacy CMS publication switch (which hid valid contact data).
 if(!p || p.version===1)return SITE_CONTACTS;
 const d=normalizedData('contacts',p.data);
 const phone=normalisePhone(d.phone);
 return {...d,phone,phoneDisplay:d.phone};
}
export async function contacts(prisma){
 if(!prisma?.contentEntry?.findUnique)return SITE_CONTACTS;
 return contactsFromEntry(await prisma.contentEntry.findUnique({where:{key:'contacts'},select:{key:true,data:true,visible:true,version:true}}));
}
export function publicContacts(prisma){return async(req,res,next)=>{
 try{res.locals.siteContacts=await contacts(prisma);next();}catch(e){next(e);}
};}
export const renderContent=(name,data)=>ejs.renderFile(root+name+'.ejs',data);
const replaceOne=(html,re,value)=>re.test(html)?html.replace(re,()=>value):html;
const escape=ejs.escapeXML;
export async function renderHomeContent(prisma,html,siteContacts){
 const c=siteContacts || await contacts(prisma);
 const rows=prisma?.contentEntry?.findMany ? await prisma.contentEntry.findMany({where:{key:{in:['gym','group','personal','home']}},select:{key:true,data:true,visible:true,version:true,publicOrder:true,photos:{select:{publicKey:true,slot:true,alt:true,caption:true,visible:true,publicOrder:true},orderBy:[{publicOrder:'asc'},{id:'asc'}]}}}) : [];
 const directions=directionCards(rows);
 const directionsHtml=await renderContent('directions',{items:directions});
 html=replaceOne(html,/<section\s+class="directions"[\s\S]*?<\/section>/,directionsHtml);
 const home=rows.find(p=>p.key==='home');let trainer=null;
 if(home?.visible&&home.data?.trainerId && prisma?.trainerProfile?.findFirst){
  const profile=await prisma.trainerProfile.findFirst({where:{...publicTrainerWhere,id:home.data.trainerId,photo:{isNot:null}},select:{publicName:true,publicKey:true,photo:{select:{trainerId:true}}}});
  if(profile)trainer={name:profile.publicName,url:'/trainers/'+profile.publicKey,photoUrl:'/trainers/'+profile.publicKey+'/photo'};
 }
 html=replaceOne(html,/<section\s+class="trainer-cta"[\s\S]*?<\/section>/,await renderContent('featured',{trainer}));
 html=replaceOne(html,/<div class="ideal-footer__contacts">[\s\S]*?<\/div>/,await renderContent('contacts',{siteContacts:c}));
 // Public hero and mobile menu are literal HTML, not EJS: update them from the same contact record.
 html=replaceOne(html,/<p class="hero__address">[\s\S]*?<\/p>/,`<p class="hero__address">${escape(c.address||'Адрес уточняется')} <span aria-hidden="true"></span></p>`);
 html=replaceOne(html,/<p class="hero__hours">[\s\S]*?<\/p>/,`<p class="hero__hours"><span aria-hidden="true"></span>${escape(c.hours||'Часы работы уточняются')}</p>`);
 html=replaceOne(html,/<p class="menu-panel__footnote">[\s\S]*?<\/p>/,`<p class="menu-panel__footnote">ИДЕАЛ · АБАКАН${c.address?'<br>'+escape(c.address):''}</p>`);
 const floating=await ejs.renderFile(fileURLToPath(new URL('../../views/public/floating-cta.ejs',import.meta.url)),{siteContacts:c});
 return html.replace('</footer>',()=>'</footer>'+floating);
}
export function contentPublicRoutes({config,prisma}){
 const r=Router();
 const metadata=(path,title,description,published)=>({...seoFor(config,path,{},null,{published}),title,description});
 r.get('/content/photos/:key',async(req,res,next)=>{
  try{
   if(!/^[a-f0-9]{32}$/.test(req.params.key))return res.sendStatus(404);
   const row=await prisma.contentPhoto.findUnique({where:{publicKey:req.params.key},select:{data:true,visible:true,alt:true,entry:{select:{key:true,visible:true}}}});
   if(!row?.visible||!row.alt||!row.entry.visible||!['about',...directionKeys].includes(row.entry.key))return res.sendStatus(404);
   return res.type('image/webp').set('Cache-Control','public,max-age=60,must-revalidate').send(Buffer.from(row.data));
  }catch(e){next(e);}
 });
 r.get('/about.html',async(req,res,next)=>{
  try{
   z.object({}).strict().parse(req.query);
   const entry=await prisma.contentEntry.findUnique({where:{key:'about'},select:{key:true,data:true,visible:true,version:true,photos:{select:{publicKey:true,slot:true,alt:true,caption:true,visible:true},orderBy:[{publicOrder:'asc'},{id:'asc'}]}}});
   const about=aboutDto(entry);if(!about)return res.sendStatus(404);
   const seo=metadata('/about.html',about.title||'О клубе — ИДЕАЛ / Абакан',about.summary||'Спортивный клуб ИДЕАЛ в Абакане.',true);
   res.set('X-Robots-Tag',seo.robots);res.render('content/about',{seo,about});
  }catch(e){next(e);}
 });
 r.get('/directions/:key',async(req,res,next)=>{
  try{
   z.object({}).strict().parse(req.query);
   if(!directionKeys.includes(req.params.key))return res.sendStatus(404);
   const entry=await prisma.contentEntry.findUnique({where:{key:req.params.key},select:{key:true,data:true,visible:true,version:true,publicOrder:true,photos:{select:{publicKey:true,slot:true,alt:true,caption:true,visible:true},orderBy:[{publicOrder:'asc'},{id:'asc'}]}}});
   const item=directionCards(entry?[entry]:[]).find(x=>x.url==='/directions/'+req.params.key);
   if(!item)return res.sendStatus(404);
   const seo=metadata(req.path,item.title+' — ИДЕАЛ / Абакан',item.summary,true);
   res.set('X-Robots-Tag',seo.robots);res.render('content/direction',{seo,item});
  }catch(e){next(e);}
 });
 return r;
}
