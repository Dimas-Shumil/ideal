import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contacts, CLUB_PHONE, CLUB_PHONE_DISPLAY, SITE_CONTACTS } from '../server/modules/content/public.js';
const read = path => readFileSync(path, 'utf8');
test('club contacts fixed in code, independent of database', () => {
  assert.equal(CLUB_PHONE, '+73902287386');
  assert.equal(CLUB_PHONE_DISPLAY, '+7 (3902) 28-73-86');
  assert.equal(contacts(), SITE_CONTACTS);
  assert.equal(contacts().hours, 'Ежедневно с 08:00 до 22:00');
});
test('same club phone is shown in public CTA and static HTML', () => {
  for(const file of ['server/views/public/floating-cta.ejs','server/views/content/contacts.ejs','index.html'])
    assert.match(read(file),/tel:\+73902287386/);
});
test('nutrition and trainer sections use shared horizontal grid', () => {
  for(const file of ['site/sass/main.scss','site/css/main.css','site/css/main.min.css']){
    const css=read(file);
    assert.doesNotMatch(css,/1560px/);
    assert.ok((css.match(/1720px/g)||[]).length>=4,file);
  }
});
