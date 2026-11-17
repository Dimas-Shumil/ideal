CREATE TABLE "TrainerGalleryPhoto" (
    "id" UUID NOT NULL,
    "trainerId" UUID NOT NULL,
    "caption" VARCHAR(300) NOT NULL DEFAULT '',
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrainerGalleryPhoto_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TrainerGalleryPhoto_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "TrainerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TrainerGalleryPhoto_trainerId_createdAt_id_idx" ON "TrainerGalleryPhoto"("trainerId", "createdAt", "id");
