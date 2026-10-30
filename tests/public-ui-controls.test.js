import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = name => readFileSync(name, 'utf8');

test('Floating CTA always links to the fixed club number without publication', () => {
  const partial = read('server/views/public/floating-cta.ejs');
  assert.match(partial, /<nav class="floating-cta" data-floating-cta/);
  assert.match(partial, /href="tel:\+73902287386"/);
  assert.doesNotMatch(partial, /floating-cta__link--disabled/);
  assert.match(partial, /href="#contacts"/);
  assert.doesNotMatch(partial, /<span>\s*(Позвонить|Записаться)\s*<\/span>/);
  assert.match(partial, /aria-label="Позвонить в клуб ИДЕАЛ: \+7 \(3902\) 28-73-86"/);
  assert.match(partial, /aria-label="Как записаться: контакты клуба ИДЕАЛ"/);
  for (const filename of ['site/sass/main.scss', 'site/css/main.css', 'site/css/main.min.css']) {
    const css = read(filename);
    assert.match(css, /width:\s*52px/);
    assert.match(css, /border-radius:\s*(50%|50\%)/);
  }
  assert.doesNotMatch(partial, /if \(floatingContacts\.phone\) \{ %>\s*<nav/);
  assert.match(read('site/scripts/floating-cta.js'), /footer\.getBoundingClientRect/);
});

test('Mobile header hides contact button without removing menu link', () => {
  const css = read('site/css/main.css');
  assert.match(css, /@media \(max-width: 1180px\)\s*\{\s*\.header__appointment\s*\{\s*display: none/);
  assert.match(read('server/views/public/header.ejs'), /class="header__appointment"/);
  assert.match(read('server/views/public/footer.ejs'), /class="menu-panel__appointment"/);
});

test('Membership carousel supports rapid next requests and mobile controls', () => {
  const js = read('site/scripts/sections.js');
  assert.match(js, /const intendedIndex = new WeakMap\(\)/);
  assert.match(js, /intendedIndex\.get\(track\) \?\? getCurrentIndex\(track\)/);
  assert.match(js, /intendedIndex\.set\(track, to\)/);
  assert.match(js, /setTimeout\(\(\) => \{\s*intendedIndex\.set\(track, getCurrentIndex\(track\)\)/);
  const css = read('site/css/main.css');
  assert.match(css, /@media \(max-width: 700px\)\s*\{\s*\.memberships__arrows button\s*\{\s*display: inline-flex/);
  assert.match(read('server/views/public/memberships.ejs'), /data-plans-prev disabled/);
  assert.match(read('server/views/public/memberships.ejs'), /data-plans-next disabled/);
});

test('Home nutrition uses live server data without static demo products', () => {
  const html = read('index.html');
  assert.equal((html.match(/<!-- home:nutrition -->/g) || []).length, 1);
  assert.doesNotMatch(html, /demo-products\.js|data-demo-id|site\/img\/nutrition\//);
  assert.match(html, /nutrition\.js\?v=catalog-20261030/);
});
