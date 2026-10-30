import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import ejs from 'ejs';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {shopRoutes} from '../server/modules/shop/routes.js';
import {SITE_CONTACTS} from '../server/modules/content/public.js';
const html = await readFile(new URL('../index.html',import.meta.url),'utf8');
const source = await readFile(new URL('../site/scripts/nutrition.js',import.meta.url),'utf8');
const product=(n,extra={})=>({id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,name:'Товар '+n,category:'Питание',description:'Описание '+n,characteristics:'',active:true,version:1,images:[],variants:[{id:'variant'+n,name:'500 г',active:true,available:true,priceCents:n*10000,version:1}],...extra});
function fixture(rows=[]){
 const state={rows};
 const selected=q=>state.rows.filter(p=>p.active&&(!q.where.category||p.category===q.where.category)).sort((a,b)=>a.name.localeCompare(b.name));
 const prisma={membershipPlan:{findMany:async()=>[]},shopProduct:{
  findMany:async q=>{assert.equal(q.where.active,true);const list=selected(q);if(q.distinct)return [...new Set(list.map(p=>p.category))].map(category=>({category}));assert.equal(q.take,24);return list.slice(q.skip,q.skip+q.take).map(p=>({...p,variants:p.variants.filter(v=>v.active)}));},
  count:async q=>selected(q).length,
 }};
 const app=express();app.use((req,res,next)=>{res.locals.siteContacts=SITE_CONTACTS;next();});
 app.use(shopRoutes({prisma,config:{SESSION_SECRET:'x'.repeat(80),production:false},indexHtml:html}));
 return {app,state};
}
test('home HTTP: empty/hidden catalog omits the entire nutrition section',async()=>{
 for(const rows of [[],[product(1,{active:false})]]){const {app}=fixture(rows);const res=await request(app).get('/').expect(200);assert.doesNotMatch(res.text,/class="nutrition"|data-nutrition-card|data-demo-id|demo-products\.js|Ассортимент готовится/);assert.match(res.text,/brand-v1\.css/);}
});
test('home HTTP: current products, min price, images and detail links; query cannot filter the home gallery',async()=>{
 const a=product(1,{images:[{id:'photo1'}],variants:[{active:true,priceCents:25000},{active:true,priceCents:12000},{active:false,priceCents:100}]}), b=product(2), hidden=product(3,{active:false});
 const {app}=fixture([a,b,hidden]);const res=await request(app).get('/?category=missing&page=2').expect(200);
 assert.equal((res.text.match(/data-nutrition-card/g)||[]).length,2);assert.match(res.text,/Товар 1/);assert.doesNotMatch(res.text,/Товар 3|data-demo-id|demo-products\.js/);assert.match(res.text,/От 120,00 ₽/);assert.ok(res.text.includes('/shop/images/photo1.webp'));assert.ok(res.text.includes('/product.html?id='+a.id));assert.ok(res.text.includes('/site/img/shop-placeholder.svg'));
});
test('home HTTP: publishing, editing, hiding and deleting are reflected on the next request',async()=>{
 const {app,state}=fixture();assert.doesNotMatch((await request(app).get('/')).text,/data-nutrition-card/);
 state.rows.push(product(1));assert.match((await request(app).get('/')).text,/Товар 1/);
 state.rows[0].name='Новый товар';assert.match((await request(app).get('/')).text,/Новый товар/);
 state.rows[0].active=false;assert.doesNotMatch((await request(app).get('/')).text,/class="nutrition"/);
 state.rows[0].active=true;assert.match((await request(app).get('/')).text,/Новый товар/);
 state.rows=[];assert.doesNotMatch((await request(app).get('/')).text,/class="nutrition"/);
});
test('home template: empty output, one product disabled controls, escaping and no-variant fallback',async()=>{
 const file=new URL('../server/views/shop/nutrition.ejs',import.meta.url);
 const render=items=>ejs.renderFile(fileURLToPath(file),{items,money:n=>(n/100).toFixed(2)});
 assert.equal((await render([])).trim(),'');
 const s=await render([product(1,{name:'<script>alert("x")</script>',description:'" onmouseover="evil',variants:[]})]);
 assert.doesNotMatch(s,/<script>|data-description="" onmouseover=/);assert.match(s,/&lt;script&gt;/);assert.match(s,/Варианты ожидаются/);assert.match(s,/data-nutrition-next disabled/);assert.match(s,/01 \/ 01/);
});
function carousel(count){
 const fields=Object.fromEntries(['name','category','description','price','counter','status'].map(k=>[k,{textContent:''}]));
 const make=()=>({attrs:{},listeners:{},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,v){this.listeners[k]=v;}});
 const buy=make(),prev=make(),next=make(),gallery={...make(),clientWidth:375,classList:{add(){},remove(){}}};
 const cards=Array.from({length:count},(_,i)=>({...make(),style:{},offsetWidth:240,dataset:{productId:'id-'+i,name:'Товар '+i,category:'Категория '+i,description:'Описание '+i,price:(i+1)*100+' ₽'}}));
 const section={querySelectorAll:()=>cards,querySelector:s=>s==='.nutrition__gallery'?gallery:s==='[data-nutrition-buy]'?buy:s==='[data-nutrition-prev]'?prev:s==='[data-nutrition-next]'?next:fields[s.slice(16,-1)]};
 const document={querySelector:()=>count?section:null};
 vm.runInNewContext(source,{document,window:{matchMedia:()=>({matches:true,addEventListener(){}}),addEventListener(){}},cancelAnimationFrame(){},encodeURIComponent,performance:{now:()=>0}});
 return {fields,cards,buy,prev,next,gallery};
}
test('carousel: real metadata, prices and links follow next/previous/keyboard without demo globals',()=>{
 carousel(0);carousel(1);
 const c=carousel(3);assert.equal(c.fields.name.textContent,'Товар 0');assert.equal(c.buy.attrs.href,'/product.html?id=id-0');
 c.next.listeners.click();assert.equal(c.fields.name.textContent,'Товар 1');assert.equal(c.fields.price.textContent,'200 ₽');assert.equal(c.buy.attrs.href,'/product.html?id=id-1');
 c.prev.listeners.click();assert.equal(c.fields.name.textContent,'Товар 0');
 c.gallery.listeners.keydown({key:'End',preventDefault(){}});assert.equal(c.fields.name.textContent,'Товар 2');assert.equal(c.fields.counter.textContent,'03 / 03');
 c.next.listeners.click();assert.equal(c.fields.name.textContent,'Товар 0');
});
