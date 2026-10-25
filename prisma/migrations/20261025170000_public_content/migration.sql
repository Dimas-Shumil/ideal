-- Additive only: no prior tables or columns are modified.
BEGIN;
CREATE TABLE "ContentEntry" (
 "id" UUID NOT NULL, "key" VARCHAR(16) NOT NULL,
 "data" JSONB NOT NULL DEFAULT '{}', "visible" BOOLEAN NOT NULL DEFAULT false,
 "publicOrder" INTEGER NOT NULL DEFAULT 0, "version" INTEGER NOT NULL DEFAULT 1,
 CONSTRAINT "ContentEntry_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "ContentEntry_key_check" CHECK ("key" IN ('home','about','contacts','gym','group','personal')),
 CONSTRAINT "ContentEntry_order_check" CHECK ("publicOrder" BETWEEN 0 AND 99999),
 CONSTRAINT "ContentEntry_version_check" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "ContentEntry_key_key" ON "ContentEntry"("key");
CREATE TABLE "ContentPhoto" (
 "id" UUID NOT NULL,
 "publicKey" VARCHAR(32) NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
 "entryId" UUID NOT NULL, "slot" VARCHAR(16) NOT NULL,
 "alt" VARCHAR(300) NOT NULL DEFAULT '', "caption" VARCHAR(500) NOT NULL DEFAULT '',
 "visible" BOOLEAN NOT NULL DEFAULT false, "publicOrder" INTEGER NOT NULL DEFAULT 0, "data" BYTEA NOT NULL,
 CONSTRAINT "ContentPhoto_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "ContentPhoto_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "ContentEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "ContentPhoto_slot_check" CHECK ("slot" IN ('cover','gallery','facade','hall')),
 CONSTRAINT "ContentPhoto_key_check" CHECK ("publicKey" ~ '^[a-f0-9]{32}$'),
 CONSTRAINT "ContentPhoto_order_check" CHECK ("publicOrder" BETWEEN 0 AND 99999),
 CONSTRAINT "ContentPhoto_published_alt_check" CHECK (NOT "visible" OR length(trim("alt")) > 0)
);
CREATE UNIQUE INDEX "ContentPhoto_publicKey_key" ON "ContentPhoto"("publicKey");
CREATE INDEX "ContentPhoto_entryId_slot_publicOrder_id_idx" ON "ContentPhoto"("entryId","slot","publicOrder","id");
INSERT INTO "ContentEntry" ("id", "key", "data", "visible", "publicOrder") VALUES
 (gen_random_uuid(), 'home', '{"trainerId":""}', true, 0),
 (gen_random_uuid(), 'contacts', '{"address":"Абакан, ул. Бограда, 135","hours":"Ежедневно с 07:00 до 22:00","map":"https://2gis.ru/abakan/firm/9711414977502434","phone":"","vk":"","telegram":""}', true, 0),
 (gen_random_uuid(), 'about', '{}', false, 0),
 (gen_random_uuid(), 'gym', '{}', false, 0), (gen_random_uuid(), 'group', '{}', false, 1), (gen_random_uuid(), 'personal', '{}', false, 2);
COMMIT;
