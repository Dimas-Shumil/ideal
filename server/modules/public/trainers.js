import { Router } from "express";
import { z } from "zod";
import { seoFor } from "./seo.js";
export const publicTrainerWhere = {
  publicVisible: true,
  publicName: { not: "" },
  user: { active: true, role: "TRAINER" },
};
export const publicTrainerKey = z.string().regex(/^[a-f0-9]{32}$/);
export const publicTrainerSelect = Object.freeze({
  publicKey: true,
  publicName: true,
  specialty: true,
  summary: true,
  biography: true,
  experience: true,
  qualification: true,
  approach: true,
  directions: true,
  achievements: true,
  photo: { select: { trainerId: true } },
});
export const publicTrainerCardSelect = Object.freeze({
  publicKey: true,
  publicName: true,
  specialty: true,
  photo: { select: { trainerId: true } },
});
// IDs stay inside the projection boundary; only a public-key photo URL leaves it.
export function trainerDto(row, detail = true) {
  const result = {
    name: row.publicName,
    url: "/trainers/" + row.publicKey,
    photoUrl: row.photo
      ? "/trainers/" + row.publicKey + "/photo"
      : "/site/img/trainer-placeholder.svg",
    hasPhoto: !!row.photo,
    specialty: row.specialty,
  };
  if (detail)
    for (const key of [
      "summary",
      "biography",
      "experience",
      "qualification",
      "approach",
      "directions",
      "achievements",
    ])
      result[key] = row[key];
  return result;
}
export async function publicTrainers(prisma) {
  return (
    await prisma.trainerProfile.findMany({
      where: publicTrainerWhere,
      select: publicTrainerCardSelect,
      orderBy: [
        { publicOrder: "asc" },
        { publicName: "asc" },
        { publicKey: "asc" },
      ],
    })
  ).map((row) => trainerDto(row, false));
}
export async function publicTrainer(prisma, key) {
  const row = await prisma.trainerProfile.findFirst({
    where: { ...publicTrainerWhere, publicKey: key },
    select: publicTrainerSelect,
  });
  return row ? trainerDto(row) : null;
}
export function publicTrainerRoutes({ config, prisma }) {
  const router = Router();
  router.get("/trainer.html", (_req, res) =>
    res.redirect(301, "/trainers.html"),
  );
  router.use(["/trainers.html", "/trainers"], (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.set("X-Robots-Tag", "noindex,follow");
    next();
  });
  const seo = (path, name, published = false) => ({
    ...seoFor(config, path, {}, null, { published }),
    title: name ? name + ' — тренер ИДЕАЛ / Абакан' : 'Тренеры — ИДЕАЛ / Абакан',
    description: name ? `${name} — тренер спортивного клуба ИДЕАЛ в Абакане.` : 'Опубликованные профили тренеров клуба ИДЕАЛ в Абакане.'
  });
  router.get("/trainers.html", async (req, res) => {
    z.object({}).strict().parse(req.query);
    let items = [],
      unavailable = false;
    try {
      items = await publicTrainers(prisma);
    } catch {
      unavailable = true;
      res.status(503);
    }
    const meta=seo('/trainers.html',null,!unavailable && items.length>0);
    res.set('X-Robots-Tag',meta.robots);
    res.render("public/trainers", {
      seo: meta,
      items,
      unavailable,
    });
  });
  router.get("/trainers/:key/photo", async (req, res, next) => {
    if (!publicTrainerKey.safeParse(req.params.key).success)
      return res.sendStatus(404);
    try {
      const row = await prisma.trainerProfile.findFirst({
        where: { ...publicTrainerWhere, publicKey: req.params.key },
        select: { photo: { select: { data: true } } },
      });
      if (!row?.photo) return res.sendStatus(404);
      res.type("image/webp").send(Buffer.from(row.photo.data));
    } catch {
      res.status(503).send("Фотография временно недоступна.");
    }
  });
  router.get("/trainers/:key", async (req, res) => {
    if (!publicTrainerKey.safeParse(req.params.key).success)
      return res.status(404).render("public/trainer", {
        seo: seo(req.path),
        profile: null,
        unavailable: false,
      });
    z.object({}).strict().parse(req.query);
    let profile = null,
      unavailable = false;
    try {
      profile = await publicTrainer(prisma, req.params.key);
    } catch {
      unavailable = true;
      res.status(503);
    }
    if (!unavailable && !profile) res.status(404);
    const meta=seo(req.path,profile?.name,Boolean(profile?.hasPhoto && (profile?.summary?.trim() || profile?.biography?.trim())) && !unavailable);
    res.set('X-Robots-Tag',meta.robots);
    res.render("public/trainer", {
      seo: meta,
      profile,
      unavailable,
    });
  });
  return router;
}
