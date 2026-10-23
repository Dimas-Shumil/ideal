CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'TRAINER');
CREATE TABLE "User" (
 "id" UUID PRIMARY KEY, "login" VARCHAR(64) NOT NULL UNIQUE,
 "displayName" VARCHAR(100) NOT NULL, "passwordHash" TEXT NOT NULL,
 "role" "Role" NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
 "authVersion" INTEGER NOT NULL DEFAULT 1 CHECK ("authVersion" > 0),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "User_login_format" CHECK ("login" ~ '^[a-z0-9][a-z0-9._-]{2,63}$')
);
CREATE TABLE "AuthSession" (
 "sid" VARCHAR(128) PRIMARY KEY, "sess" JSON NOT NULL,
 "expire" TIMESTAMPTZ(3) NOT NULL, "absoluteAt" TIMESTAMPTZ(3) NOT NULL,
 "userId" UUID REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "authVersion" INTEGER,
 CONSTRAINT "session_binding" CHECK (("userId" IS NULL) = ("authVersion" IS NULL)),
 CONSTRAINT "session_deadline" CHECK ("expire" <= "absoluteAt")
);
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");
CREATE INDEX "AuthSession_expire_idx" ON "AuthSession"("expire");
CREATE TABLE "AuditEvent" (
 "id" UUID PRIMARY KEY, "actorId" UUID REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
 "action" VARCHAR(64) NOT NULL, "targetId" UUID, "requestId" UUID,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");
