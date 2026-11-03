import {z} from 'zod';
import {validDate,today} from '../crm/dates.js';
import {clubDateTime,clubParts} from '../schedule/dates.js';
export const uuid=z.string().uuid();
export const fail=(status,message)=>Object.assign(new Error(message),{status});
const text=max=>z.string().trim().max(max);
const flag=z.enum(['true','false']).transform(v=>v==='true');
export const money=z.string().regex(/^\d{1,7}(?:[.,]\d{1,2})?$/).transform(v=>{const [a,b='']=v.replace(',','.').split('.');return Number(a)*100+Number(b.padEnd(2,'0'));}).pipe(z.number().int().min(0).max(100000000));
// Browser datetime-local values always mean Abakan, independent of server timezone.
export const localDateTime=z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).refine(v=>{
 const [day,time]=v.split('T');return validDate(day)&&/^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}).transform(v=>{const [day,time]=v.split('T');return clubDateTime(day,time);});
const optionalDate=z.union([z.literal(''),localDateTime]).transform(v=>v||null);
export const query=z.object({month:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).refine(v=>Number(v.slice(0,4))>=1900&&Number(v.slice(0,4))<=2199).default(()=>today().slice(0,7)),page:z.coerce.number().int().min(1).max(10000).default(1),archived:z.enum(['true','false']).default('false'),completed:z.enum(['true','false']).default('false')}).strict();
export function monthRange(month){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw fail(400,'Проверьте месяц.');
 const [year,m]=month.split('-').map(Number);if(year<1900||year>2199)throw fail(400,'Проверьте год.');
 const next=m===12?`${year+1}-01`:`${year}-${String(m+1).padStart(2,'0')}`;
 return {gte:clubDateTime(month+'-01','00:00'),lt:clubDateTime(next+'-01','00:00')};
}
export const clientBody=z.object({name:text(160).min(2),phone:text(30).refine(v=>!v||(/^\+?[\d ()-]{10,30}$/.test(v)&&v.replace(/\D/g,'').length>=10&&v.replace(/\D/g,'').length<=15)),notes:text(3000),archived:flag}).strict();
export const sessionBody=z.object({clientId:uuid,startsAt:localDateTime,endsAt:localDateTime,price:money,status:z.enum(['SCHEDULED','COMPLETED','CANCELLED']),comment:text(3000),reminderMinutes:z.enum(['','120','180','1440']).transform(v=>v?Number(v):null)}).strict().refine(v=>v.endsAt>v.startsAt&&v.endsAt-v.startsAt<=12*3600000,'Проверьте начало и конец тренировки.').refine(v=>v.status!=='COMPLETED'||v.endsAt<=new Date(),'Будущую тренировку нельзя завершить.');
export const expenseBody=z.object({title:text(240).min(2),category:text(100).min(1),expenseDate:z.string().refine(validDate).transform(v=>clubDateTime(v,'12:00')),amount:money.refine(v=>v>0),comment:text(2000)}).strict();
export const taskBody=z.object({title:text(240).min(2),dueAt:optionalDate,reminderAt:optionalDate,comment:text(2000),priority:z.enum(['NORMAL','IMPORTANT']),completed:flag}).strict().refine(v=>!v.dueAt||!v.reminderAt||v.reminderAt<=v.dueAt,'Напоминание должно быть не позднее срока задачи.');
export const operation=z.object({_csrf:z.string().optional(),key:uuid,version:z.coerce.number().int().min(1).optional()}).strict();
export const deleteBody=z.object({confirm:z.literal('DELETE')}).strict();
export const models={clients:'coachClient',sessions:'coachSession',expenses:'coachExpense',tasks:'coachTask'};
export const schemas={clients:clientBody,sessions:sessionBody,expenses:expenseBody,tasks:taskBody};
export function inputDate(date){if(!date)return '';const p=clubParts(date);return p.date+'T'+p.time;}
