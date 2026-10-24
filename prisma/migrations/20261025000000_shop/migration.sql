BEGIN;
CREATE TABLE "ShopProduct" (
 id UUID PRIMARY KEY, name VARCHAR(150) NOT NULL, category VARCHAR(100) NOT NULL,
 description VARCHAR(4000) NOT NULL, characteristics VARCHAR(4000) NOT NULL,
 active BOOLEAN NOT NULL DEFAULT false, version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "ShopProduct_active_name_id_idx" ON "ShopProduct"(active,name,id);
CREATE TABLE "ShopVariant" (
 id UUID PRIMARY KEY, "productId" UUID NOT NULL REFERENCES "ShopProduct"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 name VARCHAR(150) NOT NULL, "priceCents" INTEGER NOT NULL CHECK("priceCents" BETWEEN 1 AND 100000000),
 available BOOLEAN NOT NULL DEFAULT false, active BOOLEAN NOT NULL DEFAULT true,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0)
);
CREATE UNIQUE INDEX "ShopVariant_productId_name_key" ON "ShopVariant"("productId",name);
CREATE TABLE "ShopImage" (
 id UUID PRIMARY KEY, "productId" UUID NOT NULL REFERENCES "ShopProduct"(id) ON DELETE CASCADE ON UPDATE CASCADE,
 data BYTEA NOT NULL CHECK(octet_length(data) BETWEEN 1 AND 1048576),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ShopImage_productId_createdAt_id_idx" ON "ShopImage"("productId","createdAt",id);
CREATE TABLE "ShopOrder" (
 id UUID PRIMARY KEY, number SERIAL NOT NULL UNIQUE, key UUID NOT NULL UNIQUE,
 "guestHash" VARCHAR(64) NOT NULL, fingerprint VARCHAR(64) NOT NULL,
 name VARCHAR(100) NOT NULL, phone VARCHAR(15) NOT NULL, comment VARCHAR(1000) NOT NULL,
 method VARCHAR(10) NOT NULL CHECK(method IN ('CASH','CARD','TRANSFER')),
 status VARCHAR(12) NOT NULL DEFAULT 'NEW' CHECK(status IN ('NEW','CONFIRMED','READY','ISSUED','CANCELLED')),
 items JSONB NOT NULL CHECK(jsonb_typeof(items)='array'),
 "totalCents" INTEGER NOT NULL CHECK("totalCents">0), version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 "paidAt" TIMESTAMPTZ(3),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "ShopOrder_payment_state" CHECK((status='ISSUED')=("paidAt" IS NOT NULL))
);
CREATE INDEX "ShopOrder_status_createdAt_id_idx" ON "ShopOrder"(status,"createdAt",id);
CREATE TABLE "ShopOrderEvent" (
 id UUID PRIMARY KEY, "orderId" UUID NOT NULL REFERENCES "ShopOrder"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "actorId" UUID REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE,
 action VARCHAR(32) NOT NULL, reason VARCHAR(500) NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ShopOrderEvent_orderId_createdAt_idx" ON "ShopOrderEvent"("orderId","createdAt");
COMMIT;
