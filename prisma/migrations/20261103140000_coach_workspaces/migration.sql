-- CreateTable
CREATE TABLE "CoachClient" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "phone" VARCHAR(30) NOT NULL DEFAULT '',
    "notes" VARCHAR(3000) NOT NULL DEFAULT '',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CoachClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'SCHEDULED',
    "comment" VARCHAR(3000) NOT NULL DEFAULT '',
    "reminderMinutes" INTEGER,
    "reminderSentAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CoachSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachExpense" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" VARCHAR(240) NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "expenseDate" TIMESTAMPTZ(3) NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "comment" VARCHAR(2000) NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CoachExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachTask" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" VARCHAR(240) NOT NULL,
    "dueAt" TIMESTAMPTZ(3),
    "comment" VARCHAR(2000) NOT NULL DEFAULT '',
    "priority" VARCHAR(10) NOT NULL DEFAULT 'NORMAL',
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMPTZ(3),
    "reminderAt" TIMESTAMPTZ(3),
    "reminderSentAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CoachTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoachClient_userId_archived_name_idx" ON "CoachClient"("userId", "archived", "name");

-- CreateIndex
CREATE UNIQUE INDEX "CoachClient_id_userId_key" ON "CoachClient"("id", "userId");

-- CreateIndex
CREATE INDEX "CoachSession_userId_startsAt_idx" ON "CoachSession"("userId", "startsAt");

-- CreateIndex
CREATE INDEX "CoachSession_status_startsAt_idx" ON "CoachSession"("status", "startsAt");

-- CreateIndex
CREATE INDEX "CoachExpense_userId_expenseDate_idx" ON "CoachExpense"("userId", "expenseDate");

-- CreateIndex
CREATE INDEX "CoachTask_userId_completed_dueAt_idx" ON "CoachTask"("userId", "completed", "dueAt");

-- CreateIndex
CREATE INDEX "CoachTask_completed_reminderAt_idx" ON "CoachTask"("completed", "reminderAt");

-- AddForeignKey
ALTER TABLE "CoachClient" ADD CONSTRAINT "CoachClient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachSession" ADD CONSTRAINT "CoachSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachSession" ADD CONSTRAINT "CoachSession_clientId_userId_fkey" FOREIGN KEY ("clientId", "userId") REFERENCES "CoachClient"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachExpense" ADD CONSTRAINT "CoachExpense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachTask" ADD CONSTRAINT "CoachTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Financial and interval invariants also hold for direct database writes.
ALTER TABLE "CoachSession" ADD CONSTRAINT "CoachSession_values_check" CHECK (
  "priceCents" >= 0 AND "priceCents" <= 100000000 AND "endsAt" > "startsAt"
  AND "status" IN ('SCHEDULED','COMPLETED','CANCELLED')
  AND ("reminderMinutes" IS NULL OR "reminderMinutes" IN (120,180,1440))
  AND "version" > 0
);
ALTER TABLE "CoachExpense" ADD CONSTRAINT "CoachExpense_values_check" CHECK ("amountCents" > 0 AND "amountCents" <= 100000000 AND "version" > 0);
ALTER TABLE "CoachClient" ADD CONSTRAINT "CoachClient_version_check" CHECK ("version" > 0);
ALTER TABLE "CoachTask" ADD CONSTRAINT "CoachTask_values_check" CHECK (
  "priority" IN ('NORMAL','IMPORTANT') AND "version" > 0
  AND (("completed" AND "completedAt" IS NOT NULL) OR (NOT "completed" AND "completedAt" IS NULL))
  AND ("reminderAt" IS NULL OR "dueAt" IS NULL OR "reminderAt" <= "dueAt")
);
