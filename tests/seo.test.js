import test from 'node:test';
import assert from 'node:assert/strict';
import { seoFor, applySeo, robotsText, sitemapXml } from '../server/modules/public/seo.js';
import { readConfig } from '../server/config/env.js';
const enabled={production:true,SEO_INDEXABLE:true,SEO_ORIGIN:'https://club.example'};
test('SEO: no domain or development never publishes localhost canonicals or URLs',async()=>{
  for(const config of [{production:false}, {...enabled,production:false}, {production:true,SEO_INDEXABLE:false}]){
    assert.match(seoFor(config,'/').robots,/noindex/);
    assert.equal(robotsText(config),'User-agent: *\nDisallow: /\n');
    assert.doesNotMatch(await sitemapXml(config,{}),/<loc>|localhost|127\.0\.0\.1/);
  }
  assert.equal(seoFor({},'/').canonical,'');
});
test('SEO: only approved routes index; demo, filter and private URLs stay excluded',()=>{
  for(const path of ['/','/shop.html']) assert.equal(seoFor(enabled,path).robots,'index,follow');
  for(const path of ['/about.html','/trainers.html','/trainer.html','/cart.html','/shop/order/secret','/login']) assert.match(seoFor(enabled,path).robots,/noindex/);
  assert.match(seoFor(enabled,'/shop.html',{category:'x'}).robots,/noindex/);
  assert.equal(seoFor(enabled,'/shop.html',{category:'x'}).canonical,'https://club.example/shop.html');
  const p={id:'id',name:'<script>"',description:'quoted " & <x>'};
  const seo=seoFor(enabled,'/product.html',{id:'id'},p);
  assert.equal(seo.robots,'index,follow');assert.equal(seo.canonical,'https://club.example/product.html?id=id');
});
test('SEO: HTML escaping, one metadata set, structured identity and CSP hash',()=>{
  const headers={'Content-Security-Policy':"default-src 'self';script-src 'self';style-src 'self'"};
  const res={set:(k,v)=>headers[k]=v,get:k=>headers[k]};
  const out=applySeo(res,enabled,'/','<head><title>Old</title><meta\n name="description" content="old"><meta name="robots" content="noindex"></head>');
  assert.equal((out.match(/<title>/g)||[]).length,1);assert.equal((out.match(/name="description"/g)||[]).length,1);
  assert.match(out,/application\/ld\+json/);assert.match(headers['Content-Security-Policy'],/sha256-/);assert.equal(headers['X-Robots-Tag'],'index,follow');
});
test('SEO sitemap: active product query only and no private/demo/filter URLs',async()=>{
  let query;const xml=await sitemapXml(enabled,{shopProduct:{findMany:async q=>{query=q;return [{id:'one'},{id:'two'}];}}});
  assert.deepEqual(query.where,{active:true});assert.equal((xml.match(/<loc>/g)||[]).length,4);
  assert.match(xml,/product.html\?id=one/);assert.doesNotMatch(xml,/cart|trainer|about|login|localhost/);
});
test('SEO config: refuses unapproved indexing, non-HTTPS, local and mismatched origins',()=>{
  const base={NODE_ENV:'production',APP_ORIGIN:'https://club.example',DATABASE_URL:'postgresql://user@localhost/example_test',SESSION_SECRET:'a'.repeat(80)};
  assert.throws(()=>readConfig({...base,SEO_INDEXABLE:'true'}));
  for(const SEO_ORIGIN of ['http://club.example','https://localhost','https://127.0.0.1','https://club.example/','https://other.example']) assert.throws(()=>readConfig({...base,SEO_ORIGIN}));
  assert.equal(readConfig({...base,SEO_ORIGIN:base.APP_ORIGIN,SEO_INDEXABLE:'true'}).SEO_INDEXABLE,true);
});
