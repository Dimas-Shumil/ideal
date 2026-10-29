import { Router } from 'express';
import { z } from 'zod';
import { addDays } from '../crm/dates.js';
import { clubDateTime, clubParts, isoWeekday } from '../schedule/dates.js';
import { seoFor } from './seo.js';

export const publicScheduleQuery = z.object({ week: z.string().regex(/^[0-3]$/).default('0') }).strict();
// Deliberate allowlist: no User projection, bookings, counts, reasons or event JSON.
export const publicLessonSelect = Object.freeze({
  title: true, startsAt: true, endsAt: true, status: true,
  publicPreviousStartsAt: true, publicPreviousEndsAt: true,
  trainer: { select: { publicName: true } },
});
export function publicScheduleRange(query = {}, now = new Date()) {
  const week = Number(publicScheduleQuery.parse(query).week);
  const date = clubParts(now).date;
  const monday = addDays(date, 1 - isoWeekday(date));
  const from = addDays(monday, week * 7);
  return { week, today: date, from, to: addDays(from, 6) };
}
export async function publicSchedule(prisma, query = {}, now = new Date()) {
  const range = publicScheduleRange(query, now);
  const rows = await prisma.lesson.findMany({
    where: { kind: 'GROUP', publicVisible: true, status: { in: ['SCHEDULED', 'CANCELLED'] },
      startsAt: { gte: clubDateTime(range.from, '00:00'), lt: clubDateTime(addDays(range.to, 1), '00:00') },
      trainer: { user: { active: true, role: 'TRAINER' } },
    },
    select: publicLessonSelect,
    orderBy: [{ startsAt: 'asc' }, { title: 'asc' }, { id: 'asc' }],
  });
  const items = rows.map(row => ({
    title: row.title,
    date: clubParts(row.startsAt).date,
    startTime: clubParts(row.startsAt).time,
    endTime: clubParts(row.endsAt).time,
    trainerName: row.trainer.publicName,
    cancelled: row.status === 'CANCELLED',
    previous: row.publicPreviousStartsAt && row.publicPreviousEndsAt ? {
      date: clubParts(row.publicPreviousStartsAt).date,
      startTime: clubParts(row.publicPreviousStartsAt).time,
      endTime: clubParts(row.publicPreviousEndsAt).time,
    } : null,
  }));
  return { ...range, items };
}
export function publicScheduleRoutes({ config, prisma }) {
  const router = Router();
  router.get('/schedule.html', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const range = publicScheduleRange(req.query);
    const seo = seoFor(config, '/schedule.html', req.query);

    let data, unavailable = false;
    try { data = await publicSchedule(prisma, req.query); }
    catch { unavailable = true; data = { ...range, items: [] }; res.status(503); }
    const contentSeo = seoFor(config, '/schedule.html', req.query, null, {published: !unavailable && data.items.some(item=>!item.cancelled)});
    seo.robots=contentSeo.robots;
    res.set('X-Robots-Tag',seo.robots);
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(data.from, i);
      return { date, items: data.items.filter(item => item.date === date) };
    });
    return res.render('public/schedule', { seo, ...data, days, unavailable });
  });
  return router;
}
