ALTER TABLE "TrainerProfile" ADD COLUMN "publicName" VARCHAR(100) NOT NULL DEFAULT '', ADD COLUMN "publicVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "TrainerProfile" ADD CONSTRAINT "TrainerProfile_publicVersion_check" CHECK ("publicVersion" > 0);
ALTER TABLE "Lesson" ADD COLUMN "publicVisible" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "publicPreviousStartsAt" TIMESTAMPTZ(3), ADD COLUMN "publicPreviousEndsAt" TIMESTAMPTZ(3);
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_public_group_check" CHECK (NOT "publicVisible" OR kind = 'GROUP'),
 ADD CONSTRAINT "Lesson_public_previous_check" CHECK (("publicPreviousStartsAt" IS NULL AND "publicPreviousEndsAt" IS NULL) OR ("publicPreviousStartsAt" IS NOT NULL AND "publicPreviousEndsAt" IS NOT NULL AND "publicPreviousEndsAt" > "publicPreviousStartsAt"));
CREATE INDEX "Lesson_publicVisible_startsAt_idx" ON "Lesson"("publicVisible", "startsAt");
