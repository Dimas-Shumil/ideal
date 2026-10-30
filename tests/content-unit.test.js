import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SITE_CONTACTS,STATIC_ABOUT,staticDirectionCards,contactsFromEntry,directionCards,aboutDto,normalisePhone,renderHomeContent} from '../server/modules/content/public.js';
import {entryBody} from '../server/modules/content/schema.js';

test('unconfigured content retains bundled editorial design and verified contacts',async()=>{
 assert.equal(contactsFromEntry(null).phone,'+73902287386');
 assert.equal(contactsFromEntry({version:1,visible:true,data:{phone:'',hours:'Ежедневно с 07:00 до 22:00'}}).hours,SITE_CONTACTS.hours);
 assert.equal(staticDirectionCards.length,3);
 for(const card of staticDirectionCards)await readFile('.'+card.photos[0].url);
 assert.ok(STATIC_ABOUT.title);
});
test('owner contacts override all fields; Russian phone formatting becomes valid tel URL',()=>{
 const edit={version:2,visible:true,data:{address:'Абакан, пример 1',hours:'С 09:00 до 21:00',phone:'+7 (3902) 28-73-86',map:'',vk:'',telegram:''}};
 const publicValue=contactsFromEntry(edit);
 assert.equal(publicValue.address,'Абакан, пример 1');
 assert.equal(publicValue.hours,'С 09:00 до 21:00');
 assert.equal(publicValue.phone,'+73902287386');
 assert.equal(publicValue.phoneDisplay,'+7 (3902) 28-73-86');
 assert.equal(normalisePhone('8 (3902) 28-73-86'),'+73902287386');
 assert.equal(contactsFromEntry({...edit,visible:false}).phone,'+73902287386'); // legacy hidden bit must not suppress saved contacts
 assert.equal(entryBody('contacts').safeParse(edit.data).success,true);
 assert.equal(entryBody('contacts').safeParse({...edit.data,phone:'not a phone'}).success,false);
});
test('explicit publication, hiding and editorial photo DTO are respected',()=>{
 const rows=[{key:'gym',version:3,visible:true,publicOrder:5,data:{title:'Мой зал',summary:'Тестовая краткая строка',body:'Подробный текст'},photos:[{publicKey:'a'.repeat(32),slot:'cover',alt:'Зал',caption:'',visible:true},{publicKey:'b'.repeat(32),slot:'gallery',alt:'Закрытая фотография',caption:'',visible:false}]},{key:'group',version:2,visible:false,data:{},photos:[]}];
 const items=directionCards(rows);
 assert.equal(items.length,2); // gym + unconfigured personal; explicitly hidden group is removed
 const gym=items.find(item=>item.url==='/directions/gym');
 assert.equal(gym.title,'Мой зал');
 assert.deepEqual(gym.photos.map(p=>p.url),['/content/photos/'+ 'a'.repeat(32)]);
 const about={key:'about',version:2,visible:true,data:{title:'Настоящая история'},photos:[]};
 assert.equal(aboutDto(about).title,'Настоящая история');
 assert.equal(aboutDto({...about,visible:false}),null);
});
test('homepage renders CMS content and preserves the live nutrition insertion point',async()=>{
 const html=await readFile('index.html','utf8');
 const fake={contentEntry:{findMany:async()=>[{key:'gym',visible:true,version:2,publicOrder:0,data:{title:'Тестовый зал',summary:'Новый блок',body:'Подробности'},photos:[]}]}};
 const contacts={...SITE_CONTACTS,hours:'Ежедневно с 09:00 до 20:00',address:'Абакан, тест 10'};
 const rendered=await renderHomeContent(fake,html,contacts);
 assert.match(rendered,/Тестовый зал/);
 assert.match(rendered,/09:00 до 20:00/);
 assert.match(rendered,/Абакан, тест 10/);
 assert.match(rendered,/<!-- home:nutrition -->/);
 assert.equal((rendered.match(/data-floating-cta/g)||[]).length,1);
});
