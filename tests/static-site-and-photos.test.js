import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(p,'utf8');
test('CMS editor and public renderer are mounted; independent photo deletion remains available',()=>{
 assert.match(read('server/app.js'),/contentManagementRoutes/);
 assert.match(read('server/views/partials/panel-nav.ejs'),/Контент сайта/);
 assert.match(read('server/modules/content/public.js'),/contentEntry\.findMany|prisma\.contentEntry\.findUnique/);
 assert.match(read('server/modules/content/routes.js'),/service\.upload|service\[type\]/);
 assert.match(read('server/views/content/panel.ejs'),/Удалить фото/);
 assert.match(read('server/modules/shop/routes.js'),/shop-panel\/images\/:id\/remove/);
 assert.match(read('server/modules/trainers/routes.js'),/delete-photo/);
 assert.match(read('server/views/shop/panel.ejs'),/Удалить фотографию/);
 assert.match(read('server/views/trainers/panel.ejs'),/Удалить фотографию/);
 assert.match(read('site/scripts/photo-delete.js'),/preventDefault/);
});
