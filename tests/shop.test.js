import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { readConfig } from "../server/config/env.js";
import { createDatabase } from "../server/db/client.js";
import { createApp } from "../server/app.js";
import { clearCrm } from "./helpers/crm.js";
const config = readConfig();
if (
  config.NODE_ENV !== "test" ||
  !new URL(config.DATABASE_URL).pathname.endsWith("_test")
)
  throw Error("TEST_DB_REQUIRED");
const db = createDatabase(config.DATABASE_URL),
  p = db.prisma,
  pw = randomBytes(24).toString("hex"),
  origin = config.APP_ORIGIN;
let app, store, users, owner, admin, trainer, product, variant, os, as, ts;
const token = (h) => h.match(/name="_csrf" value="([a-f0-9]{64})"/)[1];
const hidden = (h, n) =>
  h.match(new RegExp('name="' + n + '" value="([^"]+)"'))[1];
async function login(login) {
  const agent = request.agent(app),
    r = await agent.get("/login").expect(200);
  await agent
    .post("/login")
    .set("Origin", origin)
    .type("form")
    .send({ _csrf: token(r.text), login, password: pw })
    .expect(303);
  const me = await agent.get("/api/auth/me").expect(200);
  return { agent, csrf: me.body.csrf };
}
const post = (s, path, data = {}, status = 200) =>
  s.agent
    .post("/api/shop-panel" + path)
    .set("Origin", origin)
    .send({ _csrf: s.csrf, key: randomUUID(), ...data })
    .expect(status);
async function guest() {
  const agent = request.agent(app),
    r = await agent.get("/product.html?id=" + product.id).expect(200);
  return { agent, csrf: token(r.text) };
}
const add = (s, q = 1, id = variant.id, status = 303) =>
  s.agent
    .post("/shop/cart/add")
    .set("Origin", origin)
    .type("form")
    .send({ _csrf: s.csrf, variantId: id, quantity: q })
    .expect(status);
async function checkout(s) {
  const r = await s.agent.get("/cart.html").expect(200);
  return {
    key: hidden(r.text, "key"),
    quote: hidden(r.text, "quote"),
    name: "Покупатель",
    phone: "89991234567",
    comment: "Комментарий",
    method: "CASH",
  };
}
const send = (s, data, status = 303) =>
  s.agent
    .post("/shop/orders")
    .set("Origin", origin)
    .type("form")
    .send({ _csrf: s.csrf, ...data })
    .expect(status);
async function makeOrder() {
  const g = await guest();
  await add(g);
  const body = await checkout(g),
    r = await send(g, body);
  return { g, body, id: r.headers.location.split("/").at(-1) };
}
before(async () => {
  await clearCrm(p);
  await p.auditEvent.deleteMany();
  await p.authSession.deleteMany();
  await p.user.deleteMany();
  ({ app, store, users } = await createApp({ config, db }));
  for (const [login, role] of [
    ["shopowner", "OWNER"],
    ["shopadmin", "ADMIN"],
    ["shoptrainer", "TRAINER"],
  ]) {
    const u = await users.create({
      login,
      displayName: login,
      role,
      password: pw,
    });
    if (role === "OWNER") owner = u;
    else if (role === "ADMIN") admin = u;
    else trainer = u;
  }
});
beforeEach(async () => {
  store?.close();
  await clearCrm(p);
  await p.pushDelivery.deleteMany();
  await p.pushSubscription.deleteMany();
  ({ app, store } = await createApp({ config, db }));
  product = await p.shopProduct.create({
    data: {
      name: "Тестовый товар",
      category: "Тестовая категория",
      description: "Описание",
      characteristics: "Состав",
      active: true,
    },
  });
  variant = await p.shopVariant.create({
    data: {
      productId: product.id,
      name: "Тестовый вкус / 500 г",
      priceCents: 123456,
      available: true,
    },
  });
  os = await login("shopowner");
  as = await login("shopadmin");
  ts = await login("shoptrainer");
});
after(async () => {
  store?.close();
  await db.close();
});
test("shop public: catalog/card/home server data, hidden products and unknown query", async () => {
  const catalog = await request(app).get("/shop.html").expect(200);
  assert.match(catalog.text, /Тестовый товар/);
  assert.doesNotMatch(catalog.text, /demo-cart\.js/);
  const card = await request(app)
    .get("/product.html?id=" + product.id)
    .expect(200);
  assert.match(card.text, /action="\/shop\/cart\/add"/);
  const home = await request(app).get("/").expect(200);
  assert.match(home.text, new RegExp('data-product-id="' + product.id + '"'));
  assert.doesNotMatch(home.text, /demo-products\.js|demo-cart\.js/);
  await p.shopProduct.update({
    where: { id: product.id },
    data: { active: false },
  });
  await request(app)
    .get("/api/shop/products/" + product.id)
    .expect(404);
  const list = await request(app).get("/api/shop/products").expect(200);
  assert.equal(list.body.total, 0);
  await request(app).get("/product.html?id=demo-01").expect(400);
  await request(app).get("/shop.html?price=1").expect(400);
});
test("shop RBAC: pages/API separately protected, ADMIN orders only, TRAINER denied", async () => {
  for (const path of [
    "/orders",
    "/orders/" + randomUUID(),
    "/products",
    "/products/" + product.id,
  ]) {
    await request(app)
      .get("/api/shop-panel" + path)
      .expect(401);
    await ts.agent.get("/api/shop-panel" + path).expect(403);
  }
  for (const path of [
    "/shop-panel",
    "/shop-panel/orders",
    "/shop-panel/products",
    "/shop-panel/products/new",
    "/shop-panel/products/" + product.id,
  ]) {
    await request(app).get(path).expect(303);
    await ts.agent.get(path).expect(403);
  }
  await as.agent.get("/shop-panel/products").expect(403);
  await as.agent.get("/api/shop-panel/products/" + product.id).expect(403);
  await as.agent.get("/shop-panel/orders").expect(200);
  await post(as, "/products", {}, 403);
  await post(ts, "/orders/" + randomUUID() + "/status", {}, 403);
  const page = await os.agent
    .get("/shop-panel/products/" + product.id)
    .expect(200);
  assert.match(page.text, /multipart\/form-data/);
});
test("shop guards: guest and admin CSRF/Origin independently enforced", async () => {
  const g = await guest();
  await g.agent
    .post("/shop/cart/add")
    .type("form")
    .send({ variantId: variant.id, quantity: 1 })
    .expect(403);
  await g.agent
    .post("/shop/cart/add")
    .set("Origin", "https://evil.example")
    .send({ _csrf: g.csrf, variantId: variant.id, quantity: 1 })
    .expect(403);
  await g.agent
    .post("/shop/orders")
    .set("Origin", origin)
    .send({ _csrf: "a".repeat(64) })
    .expect(403);
  await os.agent
    .post("/api/shop-panel/products")
    .send({ _csrf: os.csrf, key: randomUUID() })
    .expect(403);
});
test("shop product/variant: money, version conflicts, strict DTO and duplicate name", async () => {
  const data = {
      name: "Новый товар",
      category: "Категория",
      description: "",
      characteristics: "",
      active: "false",
    },
    r = await post(os, "/products", data),
    id = r.body.id;
  const v = await post(os, "/products/" + id + "/variants", {
    name: "Вариант",
    price: "19,99",
    available: "true",
    active: "true",
  });
  assert.equal(
    (await p.shopVariant.findUnique({ where: { id: v.body.id } })).priceCents,
    1999,
  );
  await post(os, "/products/" + id, {
    ...data,
    version: 1,
    name: "Изменённый",
  });
  await post(os, "/products/" + id, { ...data, version: 1 }, 409);
  await post(
    os,
    "/products/" + id + "/variants",
    {
      name: "Подмена",
      price: "1",
      available: "true",
      active: "true",
      stock: 999,
    },
    400,
  );
  await post(
    os,
    "/products/" + id + "/variants",
    { name: "Вариант", price: "1", available: "true", active: "true" },
    409,
  );
  await post(os, "/products/" + id + "/variants/" + v.body.id, {
    name: "Вариант",
    price: "20.01",
    available: "false",
    active: "true",
    version: 1,
  });
});
test("shop cart: server price, quantity bounds, remove and unavailable positions", async () => {
  const g = await guest();
  await add(g, 2);
  await g.agent
    .post("/shop/cart/add")
    .set("Origin", origin)
    .send({ _csrf: g.csrf, variantId: variant.id, quantity: 1, priceCents: 1 })
    .expect(400);
  await add(g, 100, variant.id, 400);
  const o = await checkout(g);
  assert.ok(o.quote);
  await p.shopVariant.update({
    where: { id: variant.id },
    data: { available: false },
  });
  await add(g, 1, variant.id, 409);
  const page = await g.agent.get("/cart.html").expect(200);
  assert.match(page.text, /Позиция недоступна/);
  assert.doesNotMatch(page.text, /action="\/shop\/orders"/);
  await g.agent
    .post("/shop/cart/update")
    .set("Origin", origin)
    .send({ _csrf: g.csrf, variantId: variant.id, quantity: 0 })
    .expect(303);
  const empty = await g.agent.get("/cart.html").expect(200);
  assert.match(empty.text, /Корзина пуста/);
});
test("shop checkout: snapshot, server total, deferred payment and scoped receipt", async () => {
  const { g, id } = await makeOrder(),
    o = await p.shopOrder.findUnique({ where: { id } });
  assert.equal(o.totalCents, 123456);
  assert.equal(o.status, "NEW");
  assert.equal(o.paidAt, null);
  assert.equal(o.phone, "79991234567");
  await g.agent.get("/shop/order/" + id).expect(200);
  await request(app)
    .get("/shop/order/" + id)
    .expect(404);
  const other = await guest();
  await other.agent.get("/shop/order/" + id).expect(404);
  const view = await as.agent.get("/api/shop-panel/orders/" + id).expect(200);
  for (const key of ["guestHash", "fingerprint", "key"])
    assert.equal(view.body[key], undefined);
  await p.shopVariant.update({
    where: { id: variant.id },
    data: { priceCents: 999 },
  });
  assert.equal(
    (await p.shopOrder.findUnique({ where: { id } })).items[0].priceCents,
    123456,
  );
});
test("shop price tampering: unknown fields, fake quote and changed price reject order", async () => {
  const g = await guest();
  await add(g);
  const b = await checkout(g);
  await send(g, { ...b, totalCents: 1 }, 400);
  await send(g, { ...b, price: 1 }, 400);
  await send(g, { ...b, quote: "a".repeat(64) }, 409);
  await p.shopVariant.update({
    where: { id: variant.id },
    data: { priceCents: 1, version: { increment: 1 } },
  });
  await send(g, b, 409);
  assert.equal(await p.shopOrder.count(), 0);
});
test("shop availability changed after quote: no order committed", async () => {
  const g = await guest();
  await add(g);
  const b = await checkout(g);
  await p.shopVariant.update({
    where: { id: variant.id },
    data: { available: false },
  });
  await send(g, b, 409);
  assert.equal(await p.shopOrder.count(), 0);
});
test("shop replay: identical POST returns same order, changed body rejected, one audit", async () => {
  const { g, body, id } = await makeOrder(),
    r = await send(g, body);
  assert.equal(r.headers.location, "/shop/order/" + id);
  await send(g, { ...body, name: "Другой покупатель" }, 409);
  assert.equal(await p.shopOrder.count(), 1);
  assert.equal(
    await p.auditEvent.count({
      where: { targetId: id, action: "SHOP_ORDER_NEW" },
    }),
    1,
  );
});
test("shop concurrency: simultaneous checkout replay commits one order", async () => {
  const g = await guest();
  await add(g);
  const b = await checkout(g),
    [a, c] = await Promise.all([send(g, b), send(g, b)]);
  assert.equal(a.headers.location, c.headers.location);
  assert.equal(await p.shopOrder.count(), 1);
});
test("shop workflow: ADMIN sequential transitions, paid only at issue, terminal immutable", async () => {
  const { id } = await makeOrder();
  await post(
    as,
    "/orders/" + id + "/status",
    { status: "ISSUED", method: "CARD", reason: "", version: 1 },
    409,
  );
  for (const [version, status] of [
    [1, "CONFIRMED"],
    [2, "READY"],
    [3, "ISSUED"],
  ])
    await post(as, "/orders/" + id + "/status", {
      status,
      method: "CARD",
      reason: "",
      version,
    });
  const o = await p.shopOrder.findUnique({ where: { id } });
  assert.equal(o.status, "ISSUED");
  assert.equal(o.method, "CARD");
  assert.ok(o.paidAt);
  await post(
    as,
    "/orders/" + id + "/status",
    { status: "CANCELLED", method: "CARD", reason: "После выдачи", version: 4 },
    409,
  );
  assert.equal(await p.shopOrderEvent.count({ where: { orderId: id } }), 4);
});
test("shop cancellation: reason required, replay once, no payment or stock mutation", async () => {
  const { id } = await makeOrder();
  await post(
    as,
    "/orders/" + id + "/status",
    { status: "CANCELLED", method: "CASH", reason: "", version: 1 },
    400,
  );
  const d = {
    key: randomUUID(),
    status: "CANCELLED",
    method: "CASH",
    reason: "Покупатель отказался",
    version: 1,
  };
  await post(as, "/orders/" + id + "/status", d);
  await post(as, "/orders/" + id + "/status", d);
  assert.equal((await p.shopOrder.findUnique({ where: { id } })).paidAt, null);
  assert.equal(
    await p.shopOrderEvent.count({
      where: { orderId: id, action: "CANCELLED" },
    }),
    1,
  );
  assert.equal(
    (await p.shopVariant.findUnique({ where: { id: variant.id } })).available,
    true,
  );
});
test("shop staff concurrency: only one transition with given version commits", async () => {
  const { id } = await makeOrder();
  const results = await Promise.all([
    as.agent
      .post("/api/shop-panel/orders/" + id + "/status")
      .set("Origin", origin)
      .send({
        _csrf: as.csrf,
        key: randomUUID(),
        version: 1,
        status: "CONFIRMED",
        method: "CASH",
        reason: "",
      }),
    os.agent
      .post("/api/shop-panel/orders/" + id + "/status")
      .set("Origin", origin)
      .send({
        _csrf: os.csrf,
        key: randomUUID(),
        version: 1,
        status: "CANCELLED",
        method: "CASH",
        reason: "Отмена",
      }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(await p.shopOrderEvent.count({ where: { orderId: id } }), 2);
});
test("shop Push: active OWNER/ADMIN only, no private data, no catalog spam or replay", async () => {
  for (const u of [owner, admin, trainer]) {
    const current = await p.user.findUnique({ where: { id: u.id } });
    await p.pushSubscription.create({
      data: {
        endpoint: "https://fcm.googleapis.com/fcm/send/" + randomUUID(),
        p256dh: "test",
        auth: "test",
        userId: u.id,
        role: current.role,
        authVersion: current.authVersion,
      },
    });
  }
  const { g, body, id } = await makeOrder();
  await send(g, body);
  const rows = await p.pushDelivery.findMany({
    where: { eventKey: "shop:" + id },
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((v) => v.role).sort(), ["ADMIN", "OWNER"]);
  assert.ok(rows.every((v) => v.payload.url === "/shop-panel/orders"));
  assert.doesNotMatch(
    JSON.stringify(rows.map((v) => v.payload)),
    /79991234567|Покупатель|123456/,
  );
  await post(os, "/products/" + product.id, {
    version: 1,
    name: "Правка",
    category: "Категория",
    description: "",
    characteristics: "",
    active: "true",
  });
  assert.equal(await p.pushDelivery.count(), 2);
});
test("shop uploads: multipart without JS, raster validation, fixed MIME and OWNER guard", async () => {
  const data = await sharp({
    create: { width: 40, height: 40, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const upload = (s, image) =>
    s.agent
      .post("/shop-panel/products/" + product.id + "/images")
      .set("Origin", origin)
      .field("_csrf", s.csrf)
      .field("key", randomUUID())
      .field("version", "1")
      .attach("image", image, {
        filename: "photo.png",
        contentType: "image/png",
      });
  await upload(as, data).expect(403);
  await upload(ts, data).expect(403);
  await upload(os, Buffer.from("<svg/>")).expect(400);
  await upload(os, data).expect(303);
  const image = await p.shopImage.findFirst(),
    r = await request(app)
      .get("/shop/images/" + image.id + ".webp")
      .expect(200)
      .expect("Content-Type", /image\/webp/);
  assert.equal((await sharp(r.body).metadata()).format, "webp");
  await p.shopProduct.update({
    where: { id: product.id },
    data: { active: false },
  });
  await request(app)
    .get("/shop/images/" + image.id + ".webp")
    .expect(404);
  await os.agent.get("/shop/images/" + image.id + ".webp").expect(200);
  const now = await p.shopProduct.findUnique({ where: { id: product.id } });
  await post(os, "/images/" + image.id + "/remove", { version: now.version });
  assert.equal(await p.shopImage.count(), 0);
});
test("shop revocation: disabled ADMIN loses access on next mutation", async () => {
  const operator = await users.confirmOwner("shopowner", pw);
  await users.change(admin.id, { active: false }, operator);
  await post(as, "/orders/" + randomUUID() + "/status", {}, 401);
  await users.change(admin.id, { active: true }, operator);
});
test("shop checkout rate: 11th invalid POST limited with production rules", async () => {
  const g = await guest();
  for (let i = 0; i < 10; i++) await send(g, {}, 400);
  await send(g, {}, 429);
});

test("shop forms: long UTF-8 descriptions work without JS within bounded body limits", async () => {
  const r = await os.agent
    .post("/shop-panel/products")
    .set("Origin", origin)
    .type("form")
    .send({
      _csrf: os.csrf,
      key: randomUUID(),
      name: "Длинное описание",
      category: "Категория",
      description: "Я".repeat(4000),
      characteristics: "Ж".repeat(4000),
      active: "false",
    })
    .expect(303);
  const id = r.headers.location.split("/").at(-1);
  const saved = await p.shopProduct.findUnique({ where: { id } });
  assert.equal(saved.description.length, 4000);
  assert.equal(saved.characteristics.length, 4000);
});

test('SEO HTTP: public canonicals, filtered noindex, private headers, sitemap and real 404',async()=>{
  const seoConfig=readConfig({...process.env,NODE_ENV:'production',APP_ORIGIN:'https://club.example',SEO_ORIGIN:'https://club.example',SEO_INDEXABLE:'true'});
  const result=await createApp({config:seoConfig,db});
  try {
    const home=await request(result.app).get('/').set('Host','attacker.invalid').expect(200);
    assert.equal(home.headers['x-robots-tag'],'index,follow');assert.match(home.text,/rel="canonical" href="https:\/\/club.example\/"/);
    assert.match(home.headers['content-security-policy'],/form-action 'self'/);
    const item=await request(result.app).get('/product.html?id='+product.id).expect(200);
    assert.equal(item.headers['x-robots-tag'],'index,follow');assert.ok(item.text.includes('https://club.example/product.html?id='+product.id));
    assert.match((await request(result.app).get('/shop.html?category=Protein').expect(200)).headers['x-robots-tag'],/noindex/);
    for(const path of ['/login','/cart.html','/about.html','/trainers.html','/trainer.html'])assert.match((await request(result.app).get(path).expect(200)).headers['x-robots-tag'],/noindex/);
    const xml=(await request(result.app).get('/sitemap.xml').expect(200)).text;
    assert.ok(xml.includes(product.id));assert.doesNotMatch(xml,/cart.html|trainer.html|login|shop-panel|localhost/);
    await p.shopProduct.update({where:{id:product.id},data:{active:false}});
    await request(result.app).get('/product.html?id='+product.id).expect(404);
    assert.ok(!(await request(result.app).get('/sitemap.xml')).text.includes(product.id));
    await request(result.app).get('/not-a-page').expect(404);
    const robot=await request(result.app).get('/robots.txt').expect(200);assert.match(robot.text,/Sitemap: https:\/\/club.example\/sitemap.xml/);
  } finally { result.store.close(); }
});

test('Shop create with photo: multipart, safe WebP, atomic validation and replay',async()=>{
  const image=await sharp({create:{width:30,height:30,channels:3,background:'#fff'}}).png().toBuffer();
  const fields={_csrf:os.csrf,key:randomUUID(),name:'Фото при создании',category:'Тест',description:'Описание',characteristics:'Состав',active:'false'};
  const sendPhoto=(actor,values,buffer=image,type='image/png')=>{
    let req=actor.agent.post('/shop-panel/products/new/with-photo').set('Origin',origin);
    for(const [k,v] of Object.entries(values))req=req.field(k,String(v));
    return req.attach('image',buffer,{filename:'photo.png',contentType:type});
  };
  const result=await sendPhoto(os,fields).expect(303);const id=result.headers.location.split('/').at(-1).split('#')[0];
  const created=await p.shopProduct.findUnique({where:{id},include:{images:true}});
  assert.equal(created.name,fields.name);assert.equal(created.images.length,1);assert.equal((await sharp(created.images[0].data).metadata()).format,'webp');
  await sendPhoto(os,fields).expect(303);assert.equal(await p.shopProduct.count({where:{name:fields.name}}),1);
  await sendPhoto(os,{...fields,key:randomUUID(),name:'Неверная фотография'},Buffer.from('<svg></svg>'),'image/svg+xml').expect(400);
  assert.equal(await p.shopProduct.count({where:{name:'Неверная фотография'}}),0);
  await sendPhoto(as,{...fields,_csrf:as.csrf,key:randomUUID()}).expect(403);
  await sendPhoto(ts,{...fields,_csrf:ts.csrf,key:randomUUID()}).expect(403);
  const bad={...fields,key:randomUUID()};delete bad._csrf;await sendPhoto(os,bad).expect(403);
  let noImage=os.agent.post('/shop-panel/products/new/with-photo').set('Origin',origin);
  for(const [k,v]of Object.entries({...fields,key:randomUUID(),name:'Без фото'}))noImage=noImage.field(k,v);
  const empty=await noImage.expect(303);assert.match(empty.headers.location,/#product-variants$/);
});

test('Shop deletion: guards, version, snapshots, unavailable basket and replay',async()=>{
  const g=await guest();await add(g);const submitted=await checkout(g);const receipt=await send(g,submitted);
  const old=await p.shopOrder.findFirst({where:{id:receipt.headers.location.split('/').at(-1)}});
  const g2=await guest();await add(g2);const pending=await checkout(g2);
  await p.shopImage.create({data:{productId:product.id,data:await sharp({create:{width:5,height:5,channels:3,background:'#fff'}}).webp().toBuffer()}});
  const path='/products/'+product.id+'/delete';
  for(const actor of [as,ts])await post(actor,path,{version:1,confirm:'delete'},403);
  await post(os,path,{version:1},400);await post(os,path,{version:2,confirm:'delete'},409);
  await os.agent.post('/api/shop-panel'+path).set('Origin',origin).send({key:randomUUID(),version:1,confirm:'delete'}).expect(403);
  const data={_csrf:os.csrf,key:randomUUID(),version:1,confirm:'delete'};
  for(let i=0;i<2;i++)await os.agent.post('/api/shop-panel'+path).set('Origin',origin).send(data).expect(200);
  assert.equal(await p.shopProduct.findUnique({where:{id:product.id}}),null);assert.equal(await p.shopImage.count({where:{productId:product.id}}),0);assert.equal(await p.shopVariant.count({where:{productId:product.id}}),0);
  const saved=await p.shopOrder.findUnique({where:{id:old.id}});assert.deepEqual(saved,old);
  await g.agent.get(receipt.headers.location).expect(200);await send(g2,pending,409);
  await request(app).get('/product.html?id='+product.id).expect(404);
  assert.equal(await p.auditEvent.count({where:{action:'SHOP_PRODUCT_DELETE',targetId:product.id}}),1);
  assert.equal(await p.crmEvent.count({where:{action:'SHOP_PRODUCT_DELETE',details:{path:['product','id'],equals:product.id}}}),1);
});

test('Shop product delete: audit failure rolls back product, variants and images',async()=>{
  const image=await p.shopImage.create({data:{productId:product.id,data:Buffer.from('fixture bytes')}});
  await db.pool.query(`CREATE FUNCTION product_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='SHOP_PRODUCT_DELETE' THEN RAISE EXCEPTION 'test audit unavailable'; END IF; RETURN NEW; END $$`);
  await db.pool.query('CREATE TRIGGER product_reject_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION product_reject_audit()');
  try{
    await post(os,'/products/'+product.id+'/delete',{version:1,confirm:'delete'},500);
    assert.ok(await p.shopProduct.findUnique({where:{id:product.id}}));assert.ok(await p.shopVariant.findUnique({where:{id:variant.id}}));assert.ok(await p.shopImage.findUnique({where:{id:image.id}}));
    assert.equal(await p.crmEvent.count({where:{action:'SHOP_PRODUCT_DELETE',details:{path:['product','id'],equals:product.id}}}),0);
  }finally{await db.pool.query('DROP TRIGGER product_reject_audit ON "AuditEvent"');await db.pool.query('DROP FUNCTION product_reject_audit()');}
});
