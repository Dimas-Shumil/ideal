// Public DTO: never expose CRM clients, sales, audit or internal plan versions.
export const publicPlanSelect = Object.freeze({
  id: true, name: true, kind: true, priceCents: true,
  months: true, days: true, visits: true, weekdays: true,
  fromTime: true, toTime: true, giftGym: true, duo: true,
});
export function publicPlans(prisma) {
  return prisma.membershipPlan.findMany({
    where: { active: true, publicVisible: true },
    select: publicPlanSelect,
    orderBy: [{ publicOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
  });
}
export function planTerms(p) {
  const days = {1:'Пн',2:'Вт',3:'Ср',4:'Чт',5:'Пт',6:'Сб',7:'Вс'};
  return [
    p.months ? `${p.months} мес.` : p.days ? `${p.days} дн.` : 'Без ограничения срока',
    p.visits ? `${p.visits} посещений` : 'Безлимит',
    p.weekdays.split(',').map(d => days[d]).join(', ') + ` · ${p.fromTime}–${p.toTime}`,
    ...(p.duo ? ['«Дуэт»: цена за человека, оформление для двоих'] : []),
    ...(p.giftGym ? ['Одно посещение тренажёрного зала в подарок'] : []),
  ].join('. ');
}
