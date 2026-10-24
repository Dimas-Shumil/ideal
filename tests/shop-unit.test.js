import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import {
  price,
  productBody,
  variantBody,
  cartAdd,
  orderBody,
} from "../server/modules/shop/schema.js";
import { normalizeImage } from "../server/modules/shop/images.js";
test("shop money: exact decimal kopecks and invalid input boundaries", () => {
  for (const [v, n] of [
    ["0.01", 1],
    ["1200,09", 120009],
    ["1000000", 100000000],
    ["19.9", 1990],
  ])
    assert.equal(price.parse(v), n);
  for (const v of [
    "0",
    "-1",
    "1e3",
    "1.001",
    "1000000.01",
    "NaN",
    "1 000",
    " 12",
  ])
    assert.equal(price.safeParse(v).success, false);
});
test("shop DTO: reject browser prices, totals, identity and stock values", () => {
  const p = {
    name: "Товар",
    category: "Категория",
    description: "",
    characteristics: "",
    active: "true",
  };
  assert.equal(productBody.parse(p).active, true);
  assert.equal(
    productBody.safeParse({ ...p, userId: randomUUID() }).success,
    false,
  );
  const v = {
    name: "Вкус / фасовка",
    price: "19.99",
    available: "true",
    active: "true",
  };
  assert.equal(variantBody.parse(v).price, 1999);
  assert.equal(variantBody.safeParse({ ...v, stock: 999 }).success, false);
  for (const quantity of [0, 100, 1.5, "x", null, true, [1]])
    assert.equal(
      cartAdd.safeParse({ variantId: randomUUID(), quantity }).success,
      false,
    );
  const o = {
    key: randomUUID(),
    quote: "a".repeat(64),
    name: "Анна",
    phone: "8 (999) 123-45-67",
    comment: "",
    method: "CASH",
  };
  assert.equal(orderBody.parse(o).phone, "79991234567");
  for (const field of [
    "price",
    "totalCents",
    "items",
    "userId",
    "status",
    "paidAt",
    "delivery",
  ])
    assert.equal(orderBody.safeParse({ ...o, [field]: 1 }).success, false);
});
test("shop images: actual raster -> WebP without metadata; SVG and bogus bytes rejected", async () => {
  const input = await sharp({
    create: { width: 20, height: 30, channels: 3, background: "white" },
  })
    .jpeg()
    .withMetadata()
    .toBuffer();
  const result = await normalizeImage(input),
    m = await sharp(result).metadata();
  assert.equal(m.format, "webp");
  assert.equal(m.exif, undefined);
  assert.equal(m.width, 20);
  await assert.rejects(
    normalizeImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    (e) => e.status === 400,
  );
  await assert.rejects(
    normalizeImage(Buffer.from("bad bytes")),
    (e) => e.status === 400,
  );
});
