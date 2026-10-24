-- Stage 12: schedule, bookings and attendance. Additive migration only.
CREATE TABLE "Lesson" (
    "id" UUID NOT NULL,
    "seriesId" UUID,
    "kind" VARCHAR(10) NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "trainerId" UUID NOT NULL,
    "room" VARCHAR(100) NOT NULL DEFAULT '',
    "capacity" INTEGER NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'SCHEDULED',
    "createdById" UUID NOT NULL,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" VARCHAR(500) NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Lesson_time_check" CHECK ("endsAt" > "startsAt"),
    CONSTRAINT "Lesson_capacity_check" CHECK ("capacity" > 0),
    CONSTRAINT "Lesson_personal_capacity_check" CHECK ("kind" <> 'PERSONAL' OR "capacity" = 1),
    CONSTRAINT "Lesson_kind_check" CHECK ("kind" IN ('GROUP','PERSONAL')),
    CONSTRAINT "Lesson_status_check" CHECK ("status" IN ('SCHEDULED','CANCELLED'))
);
CREATE TABLE "LessonBooking" (
    "id" UUID NOT NULL,
    "lessonId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'BOOKED',
    "bookedById" UUID NOT NULL,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" VARCHAR(500) NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "LessonBooking_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LessonBooking_status_check" CHECK ("status" IN ('BOOKED','CANCELLED','ATTENDED','NO_SHOW'))
);
CREATE TABLE "Visit" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "membershipId" UUID,
    "lessonId" UUID,
    "bookingId" UUID,
    "kind" VARCHAR(10) NOT NULL,
    "entitlement" VARCHAR(12) NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'CONFIRMED',
    "recordedById" UUID NOT NULL,
    "reversedById" UUID,
    "reason" VARCHAR(500) NOT NULL DEFAULT '',
    "reversedReason" VARCHAR(500) NOT NULL DEFAULT '',
    "reversedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Visit_kind_check" CHECK ("kind" IN ('GROUP','PERSONAL','GYM')),
    CONSTRAINT "Visit_entitlement_check" CHECK ("entitlement" IN ('MEMBER','GIFT_GYM','NONE')),
    CONSTRAINT "Visit_status_check" CHECK ("status" IN ('CONFIRMED','REVERSED')),
    CONSTRAINT "Visit_entitlement_membership_check" CHECK (
      ("entitlement" = 'NONE' AND "membershipId" IS NULL) OR
      ("entitlement" IN ('MEMBER','GIFT_GYM') AND "membershipId" IS NOT NULL)
    ),
    CONSTRAINT "Visit_gift_kind_check" CHECK ("entitlement" <> 'GIFT_GYM' OR "kind" = 'GYM'),
    CONSTRAINT "Visit_personal_check" CHECK ("kind" <> 'PERSONAL' OR ("entitlement" = 'NONE' AND "membershipId" IS NULL)),
    CONSTRAINT "Visit_booking_lesson_check" CHECK ("bookingId" IS NULL OR "lessonId" IS NOT NULL),
    CONSTRAINT "Visit_source_check" CHECK (
      ("kind" = 'GYM' AND "lessonId" IS NULL AND "bookingId" IS NULL) OR
      ("kind" IN ('GROUP','PERSONAL') AND "lessonId" IS NOT NULL AND "bookingId" IS NOT NULL)
    )
);
CREATE TABLE "ScheduleEvent" (
    "id" UUID NOT NULL,
    "lessonId" UUID,
    "actorId" UUID,
    "action" VARCHAR(64) NOT NULL,
    "reason" VARCHAR(500) NOT NULL DEFAULT '',
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScheduleEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LessonBooking_lessonId_clientId_key" ON "LessonBooking"("lessonId", "clientId");
CREATE INDEX "Lesson_trainerId_startsAt_idx" ON "Lesson"("trainerId", "startsAt");
CREATE INDEX "Lesson_status_startsAt_idx" ON "Lesson"("status", "startsAt");
CREATE INDEX "Lesson_seriesId_idx" ON "Lesson"("seriesId");
CREATE INDEX "LessonBooking_clientId_status_idx" ON "LessonBooking"("clientId", "status");
CREATE INDEX "Visit_bookingId_idx" ON "Visit"("bookingId");
CREATE INDEX "Visit_clientId_occurredAt_idx" ON "Visit"("clientId", "occurredAt");
CREATE INDEX "Visit_membershipId_status_idx" ON "Visit"("membershipId", "status");
CREATE INDEX "Visit_lessonId_status_idx" ON "Visit"("lessonId", "status");
CREATE INDEX "ScheduleEvent_lessonId_createdAt_idx" ON "ScheduleEvent"("lessonId", "createdAt");
CREATE INDEX "ScheduleEvent_createdAt_idx" ON "ScheduleEvent"("createdAt");
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "TrainerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LessonBooking" ADD CONSTRAINT "LessonBooking_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LessonBooking" ADD CONSTRAINT "LessonBooking_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LessonBooking" ADD CONSTRAINT "LessonBooking_bookedById_fkey" FOREIGN KEY ("bookedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "LessonBooking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ScheduleEvent" ADD CONSTRAINT "ScheduleEvent_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScheduleEvent" ADD CONSTRAINT "ScheduleEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
