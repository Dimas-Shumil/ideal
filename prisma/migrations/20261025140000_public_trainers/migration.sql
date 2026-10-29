-- Additive only: preserve all existing names, versions, assignments and lessons.
ALTER TABLE "TrainerProfile"
 ADD COLUMN "publicKey" VARCHAR(32) NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
 ADD COLUMN "publicVisible" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "publicOrder" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "specialty" VARCHAR(300) NOT NULL DEFAULT '',
 ADD COLUMN "summary" VARCHAR(1000) NOT NULL DEFAULT '',
 ADD COLUMN "biography" VARCHAR(5000) NOT NULL DEFAULT '',
 ADD COLUMN "experience" VARCHAR(500) NOT NULL DEFAULT '',
 ADD COLUMN "qualification" VARCHAR(3000) NOT NULL DEFAULT '',
 ADD COLUMN "approach" VARCHAR(3000) NOT NULL DEFAULT '',
 ADD COLUMN "directions" VARCHAR(2000) NOT NULL DEFAULT '',
 ADD COLUMN "achievements" VARCHAR(3000) NOT NULL DEFAULT '';
CREATE UNIQUE INDEX "TrainerProfile_publicKey_key" ON "TrainerProfile"("publicKey");
CREATE TABLE "TrainerPhoto" (
 "trainerId" UUID NOT NULL PRIMARY KEY,
 "data" BYTEA NOT NULL,
 CONSTRAINT "TrainerPhoto_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "TrainerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
