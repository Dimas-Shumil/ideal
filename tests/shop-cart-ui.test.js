import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL("../" + file, import.meta.url), "utf8");
test("product page presents real POST purchase action separate from view-only cart link", () => {
  const product = read("server/views/shop/product.ejs");
  const catalog = read("server/views/shop/catalog.ejs");
  const routes = read("server/modules/shop/routes.js");
  assert.match(product, /form method="post" action="\/shop\/cart\/add"/);
  assert.match(product, /name="variantId" value="<%= variant.id %>"/);
  assert.match(product, /type="submit" class="product__add"/);
  assert.match(product, /Посмотреть корзину \(<%= cartCount %>\)/);
  assert.match(catalog, /Посмотреть корзину \(<%= cartCount %>\)/);
  assert.match(routes, /req\.session\.shopCart = cart/);
  assert.match(routes, /await save\(req\)/);
  assert.match(routes, /res\.redirect\(303, "\/cart\.html"\)/);
});
test("empty cart explains that navigation is not an add-to-cart operation", () => {
  const cart = read("server/views/shop/cart.ejs");
  assert.match(cart, /Корзина пуста/);
  assert.match(cart, /«Добавить в корзину»/);
  assert.match(cart, /Отправить заказ/);
});
