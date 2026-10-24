BEGIN;
-- CreateTable
CREATE TABLE "Client" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "phone" VARCHAR(15) NOT NULL,
    "birthDate" DATE NOT NULL,
    "comment" VARCHAR(1000) NOT NULL DEFAULT '',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,

    CONSTRAINT "TrainerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerAssignment" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "trainerId" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "TrainerAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipPlan" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "months" INTEGER NOT NULL,
    "days" INTEGER NOT NULL,
    "visits" INTEGER,
    "weekdays" VARCHAR(13) NOT NULL,
    "fromTime" VARCHAR(5) NOT NULL,
    "toTime" VARCHAR(5) NOT NULL,
    "giftGym" BOOLEAN NOT NULL,
    "duo" BOOLEAN NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MembershipPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipPurchase" (
    "id" UUID NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "method" VARCHAR(10) NOT NULL,
    "paidAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembershipPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "purchaseId" UUID NOT NULL,
    "pairId" UUID,
    "snapshot" JSONB NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "startDate" DATE,
    "endDate" DATE,
    "remaining" INTEGER,
    "cancelledAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipFreeze" (
    "id" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembershipFreeze_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipRefund" (
    "id" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "method" VARCHAR(10) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembershipRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmEvent" (
    "id" UUID NOT NULL,
    "clientId" UUID,
    "membershipId" UUID,
    "actorId" UUID,
    "action" VARCHAR(64) NOT NULL,
    "reason" VARCHAR(500) NOT NULL DEFAULT '',
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmOperation" (
    "id" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "key" UUID NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Client_phone_idx" ON "Client"("phone");

-- CreateIndex
CREATE INDEX "Client_archived_name_id_idx" ON "Client"("archived", "name", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TrainerProfile_userId_key" ON "TrainerProfile"("userId");

-- CreateIndex
CREATE INDEX "TrainerAssignment_trainerId_active_clientId_idx" ON "TrainerAssignment"("trainerId", "active", "clientId");

-- CreateIndex
CREATE INDEX "Membership_clientId_cancelledAt_startDate_idx" ON "Membership"("clientId", "cancelledAt", "startDate");

-- CreateIndex
CREATE INDEX "Membership_pairId_idx" ON "Membership"("pairId");

-- CreateIndex
CREATE INDEX "MembershipFreeze_membershipId_startDate_idx" ON "MembershipFreeze"("membershipId", "startDate");

-- CreateIndex
CREATE INDEX "CrmEvent_clientId_createdAt_idx" ON "CrmEvent"("clientId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CrmOperation_actorId_key_key" ON "CrmOperation"("actorId", "key");

-- AddForeignKey
ALTER TABLE "TrainerProfile" ADD CONSTRAINT "TrainerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerAssignment" ADD CONSTRAINT "TrainerAssignment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerAssignment" ADD CONSTRAINT "TrainerAssignment_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "TrainerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "MembershipPurchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipFreeze" ADD CONSTRAINT "MembershipFreeze_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipRefund" ADD CONSTRAINT "MembershipRefund_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEvent" ADD CONSTRAINT "CrmEvent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEvent" ADD CONSTRAINT "CrmEvent_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEvent" ADD CONSTRAINT "CrmEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmOperation" ADD CONSTRAINT "CrmOperation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Business invariants are enforced independently of HTML validation.
ALTER TABLE "Client" ADD CONSTRAINT "client_phone_format" CHECK (phone ~ '^[0-9]{10,15}$'), ADD CONSTRAINT "client_version_positive" CHECK(version>0);
CREATE UNIQUE INDEX "TrainerAssignment_one_active" ON "TrainerAssignment" ("clientId","trainerId") WHERE active;
ALTER TABLE "TrainerAssignment" ADD CONSTRAINT "assignment_state" CHECK (active = ("revokedAt" IS NULL));
ALTER TABLE "MembershipPlan" ADD CONSTRAINT "plan_values" CHECK (
 "priceCents">=0 AND months BETWEEN 0 AND 36 AND days BETWEEN 0 AND 1095 AND NOT(months>0 AND days>0)
 AND (months>0 OR days>0 OR visits IS NOT NULL) AND (visits IS NULL OR visits BETWEEN 1 AND 10000)
 AND kind IN ('GYM','GROUP') AND (NOT "giftGym" OR kind='GROUP') AND version>0
 AND weekdays ~ '^[1-7](,[1-7])*$' AND "fromTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
 AND "toTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "fromTime" < "toTime");
ALTER TABLE "MembershipPurchase" ADD CONSTRAINT "purchase_values" CHECK ("totalCents">=0 AND method IN ('CASH','TRANSFER','CARD'));
ALTER TABLE "Membership" ADD CONSTRAINT "membership_values" CHECK (
 "priceCents">=0 AND (remaining IS NULL OR remaining BETWEEN 0 AND 10000) AND version>0
 AND ("startDate" IS NOT NULL OR "endDate" IS NULL) AND ("endDate" IS NULL OR "endDate">="startDate"));
-- A same-day early thaw is stored as a zero-day interval.
ALTER TABLE "MembershipFreeze" ADD CONSTRAINT "freeze_dates" CHECK ("endDate">="startDate"-1);
ALTER TABLE "MembershipRefund" ADD CONSTRAINT "refund_values" CHECK ("amountCents">0 AND method IN ('CASH','TRANSFER','CARD'));

-- No extension/superuser privilege required. The same lock serializes application
-- mutations, account revocation and direct SQL subscription/refund writes.
CREATE FUNCTION ideal_membership_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(681908,8);
 IF NEW."cancelledAt" IS NULL AND NEW.remaining IS DISTINCT FROM 0 AND EXISTS (
  SELECT 1 FROM "Membership" m WHERE m."clientId"=NEW."clientId" AND m.id<>NEW.id AND m."cancelledAt" IS NULL AND m.remaining IS DISTINCT FROM 0
  AND (m."startDate" IS NULL OR NEW."startDate" IS NULL OR
   (m."startDate"<=COALESCE(NEW."endDate",'infinity'::date) AND COALESCE(m."endDate",'infinity'::date)>=NEW."startDate"))
 ) THEN RAISE EXCEPTION 'membership_overlap' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "membership_no_overlap" BEFORE INSERT OR UPDATE ON "Membership" FOR EACH ROW EXECUTE FUNCTION ideal_membership_guard();
CREATE FUNCTION ideal_refund_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE paid INTEGER;
BEGIN
 PERFORM pg_advisory_xact_lock(681908,8);
 SELECT "priceCents" INTO paid FROM "Membership" WHERE id=NEW."membershipId";
 IF COALESCE((SELECT SUM("amountCents") FROM "MembershipRefund" WHERE "membershipId"=NEW."membershipId" AND id<>NEW.id),0)+NEW."amountCents">paid THEN
  RAISE EXCEPTION 'refund_exceeds_payment' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "refund_limit" BEFORE INSERT OR UPDATE ON "MembershipRefund" FOR EACH ROW EXECUTE FUNCTION ideal_refund_guard();

COMMIT;
