import { z } from 'zod';
export const definitions = {
 home: { label: 'Главная — тренер', fields: {trainerId: ['Профиль тренера', 36]} },
 contacts: {label:'Контакты', fields: {address:['Адрес',300], hours:['Часы работы',500], phone:['Телефон',40], map:['Ссылка на карту 2ГИС / Яндекс / Google',1000], vk:['Ссылка VK',500], telegram:['Ссылка Telegram',500]}},
 about: {label:'О клубе', fields:{title:['Заголовок первого экрана',150], summary:['Вступление',1000], storyTitle:['Заголовок рассказа о клубе',150], body:['Рассказ о клубе',6000], spaceTitle:['Заголовок пространства',150], spaceText:['Описание зала и пространства',3000], feature1:['Возможность 1 — название',100], feature1Text:['Возможность 1 — описание',1000], feature2:['Возможность 2 — название',100], feature2Text:['Возможность 2 — описание',1000], feature3:['Возможность 3 — название',100], feature3Text:['Возможность 3 — описание',1000]}},
 gym: {label:'Тренажёрный зал'}, group: {label:'Групповые занятия'}, personal: {label:'Персональные тренировки'},
};
export const directionKeys = ['gym','group','personal'];
for (const key of directionKeys) definitions[key].fields = {title:['Название',150], summary:['Краткое описание',1000], body:['Подробное описание',6000]};
export const entryKey = z.enum(['home','contacts','about','gym','group','personal']);
export const operation = z.object({_csrf:z.string().optional(),key:z.string().uuid(),version:z.coerce.number().int().min(1)}).strict();
export const order = z.coerce.number().int().min(0).max(99999);
const allowedHosts = {
 map: ['2gis.ru','yandex.ru','yandex.com','maps.google.com','www.google.com','maps.app.goo.gl'],
 vk:['vk.com','www.vk.com'], telegram:['t.me'],
};
export function safeLink(value, kind) {
 if (!value) return true;
 try { const u=new URL(value); return u.protocol==='https:' && !u.username && !u.password && !u.port && allowedHosts[kind].includes(u.hostname) && !/[\\\r\n]/.test(value); } catch {return false;}
}
export function entryBody(key) {
 entryKey.parse(key);
 let fields=Object.fromEntries(Object.entries(definitions[key].fields).map(([name,[,max]])=>[name,z.string().trim().max(max)]));
 if(key==='home') fields.trainerId=z.union([z.literal(''),z.string().uuid()]);
 if(key==='contacts') {
  fields.phone=fields.phone.refine(v=>!v || (/^[+\d()\s\-–—]+$/.test(v) && v.replace(/\D/g,'').length>=10 && v.replace(/\D/g,'').length<=15), 'Укажите корректный номер телефона.');
  for(const name of ['map','vk','telegram']) fields[name]=fields[name].refine(v=>safeLink(v,name),'Нужна допустимая HTTPS-ссылка.');
 }
 return z.object(fields).strict();
}
export function normalizedData(key, data) {
 return entryBody(key).parse(Object.fromEntries(Object.keys(definitions[key].fields).map(k=>[k,data?.[k]??''])));
}
export const publication=z.object({visible:z.enum(['true','false']),confirm:z.literal('PUBLIC')}).strict();
export const photoMeta=z.object({alt:z.string().trim().max(300),caption:z.string().trim().max(500),publicOrder:order,visible:z.enum(['true','false']),confirm:z.literal('PUBLIC')}).strict().refine(d=>d.visible!=='true'||!!d.alt,'Укажите alt для публикации.');
export const removePhoto=z.object({confirm:z.literal('DELETE')}).strict();
export function photoSlots(key) {return key==='about'?{facade:1,hall:1,gallery:12}:directionKeys.includes(key)?{cover:1,gallery:4}:{};}
