-- Existing tariffs remain private until explicitly published by OWNER.
ALTER TABLE "MembershipPlan"
  ADD COLUMN "publicVisible" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "publicOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MembershipPlan" ADD CONSTRAINT "MembershipPlan_publicOrder_check"
  CHECK ("publicOrder" BETWEEN 0 AND 10000);
