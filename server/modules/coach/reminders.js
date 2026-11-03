const prefix='COACH_REMINDER_';
const pattern=/^COACH_REMINDER_(SESSION|TASK):([a-f0-9-]{36}):(\d{13}):(0|120|180|1440)$/;
export function coachReminderKey(kind,row){return `${prefix}${kind}:${row.id}:${(kind==='SESSION'?row.startsAt:row.reminderAt).getTime()}:${kind==='SESSION'?row.reminderMinutes:0}`;}
export function coachReminderDue(kind,row,now=new Date()){
 if(kind==='SESSION')return row.status==='SCHEDULED'&&[120,180,1440].includes(row.reminderMinutes)&&row.startsAt>now&&row.startsAt.getTime()-row.reminderMinutes*60000<=now.getTime();
 return !row.completed&&row.reminderAt&&row.reminderAt<=now;
}
export async function enqueueCoachReminders(prisma,now=new Date()){
 let queued=0;
 const user={active:true,role:'TRAINER'};
 const batches=[...[120,180,1440].map(minutes=>({kind:'SESSION',model:'coachSession',where:{status:'SCHEDULED',reminderSentAt:null,reminderMinutes:minutes,startsAt:{gt:now,lte:new Date(now.getTime()+minutes*60000)},user}})),{kind:'TASK',model:'coachTask',where:{completed:false,reminderSentAt:null,reminderAt:{lte:now},user}}];
 for(const batch of batches){let cursor;
  for(;;){
   const rows=await prisma[batch.model].findMany({where:batch.where,orderBy:{id:'asc'},take:200,...(cursor?{cursor:{id:cursor},skip:1}:{}),select:{id:true,userId:true,...(batch.kind==='SESSION'?{startsAt:true,status:true,reminderMinutes:true}:{reminderAt:true,completed:true}),user:{select:{id:true,authVersion:true}}}});
   for(const row of rows){
    if(!coachReminderDue(batch.kind,row,now))continue;
    const subscriptions=await prisma.pushSubscription.findMany({where:{userId:row.userId,role:'TRAINER',authVersion:row.user.authVersion},select:{id:true}});
    if(!subscriptions.length)continue;
    const eventKey=coachReminderKey(batch.kind,row);
    const payload={title:batch.kind==='SESSION'?'Скоро персональная тренировка':'Напоминание о задаче',body:'Откройте рабочий кабинет, чтобы посмотреть подробности.',url:batch.kind==='SESSION'?'/trainer/workspace/sessions':'/trainer/workspace/tasks'};
    const result=await prisma.pushDelivery.createMany({data:subscriptions.map(sub=>({eventKey,subscriptionId:sub.id,userId:row.userId,role:'TRAINER',authVersion:row.user.authVersion,payload})),skipDuplicates:true});queued+=result.count;
   }
   if(rows.length<200)break;cursor=rows.at(-1).id;
  }
 }
 return queued;
}
export async function coachReminderIsCurrent(prisma,delivery,now=new Date()){
 if(!delivery.eventKey.startsWith(prefix))return true;
 const match=pattern.exec(delivery.eventKey);if(!match)return false;
 const [,kind,id,time,minutes]=match;
 const row=await prisma[kind==='SESSION'?'coachSession':'coachTask'].findFirst({where:{id,userId:delivery.userId,user:{active:true,role:'TRAINER',authVersion:delivery.authVersion}},select:kind==='SESSION'?{id:true,userId:true,status:true,startsAt:true,reminderMinutes:true}:{id:true,userId:true,completed:true,reminderAt:true}});
 return !!row&&coachReminderDue(kind,row,now)&&coachReminderKey(kind,row)===delivery.eventKey;
}

// Mark after at least one successful delivery. Other queued devices still receive it.
export async function coachReminderSent(prisma,delivery,now=new Date()){
 const match=pattern.exec(delivery.eventKey);if(!match)return;
 const [,kind,id,time,minutes]=match;
 const where={id,userId:delivery.userId,reminderSentAt:null,...(kind==='SESSION'?{startsAt:new Date(Number(time)),reminderMinutes:Number(minutes),status:'SCHEDULED'}:{reminderAt:new Date(Number(time)),completed:false})};
 await prisma[kind==='SESSION'?'coachSession':'coachTask'].updateMany({where,data:{reminderSentAt:now}});
}
