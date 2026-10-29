import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seoFor, robotsText, applySeo, sitemapXml } from '../server/modules/public/seo.js';
const base={production:true,SEO_ORIGIN:'https://ideal-abakan.ru',SEO_INDEXABLE:true};

test('SEO / domain: public trainer routes are not blocked by staff robots directives',()=>{
  const robots=robotsText(base);
  assert.match(robots,/Sitemap: https:\/\/ideal-abakan.ru\/sitemap.xml/);
  assert.doesNotMatch(robots,/Disallow: \/trainer\n/);
  assert.match(robots,/Disallow: \/trainer\$/);
});
test('SEO / AEO / GEO: schema includes published address and supplied club phone and preserves CSP',()=>{
  const headers={'Content-Security-Policy':"default-src 'self';script-src 'self';style-src 'self'"};
  const res={set:(k,v)=>headers[k]=v,get:k=>headers[k]};
  const html='<head><title>Old</title></head>';
  const result=applySeo(res,base,'/',html,{}, {address:'Абакан, ул. Тестовая, 1',phone:'+73902223344'});
  assert.match(result,/<meta property="og:image"/);
  const match=result.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
  assert.ok(match);
  const graph=JSON.parse(match[1])['@graph'];
  assert.deepEqual(graph.map(x=>x['@type']),['WebSite','HealthClub']);
  assert.equal(graph[1].telephone,'+73902223344');
  assert.match(headers['Content-Security-Policy'],/sha256-/);
  const missing=applySeo(res,base,'/',html,{},{});
  assert.equal(JSON.parse(missing.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1])['@graph'].length,1);
});
test('Editorial SEO index requires both content approval and published data',()=>{
  assert.equal(seoFor(base,'/about.html',{},null,{published:true}).robots,'noindex,follow');
  assert.equal(seoFor({...base,SEO_CONTENT_INDEXABLE:true},'/about.html',{},null,{published:true}).robots,'index,follow');
  assert.equal(seoFor({...base,SEO_CONTENT_INDEXABLE:true},'/about.html',{q:'x'},null,{published:true}).robots,'noindex,follow');
  assert.equal(seoFor({...base,SEO_CONTENT_INDEXABLE:true},'/about.html',{},null,{published:false}).robots,'noindex,follow');
});
test('Editorial sitemap includes static editorial pages when indexing is enabled',async()=>{
  const db={shopProduct:{findMany:async()=>[]},trainerProfile:{findMany:async()=>[]},lesson:{findFirst:async()=>null}};
  const xml=await sitemapXml({...base,SEO_CONTENT_INDEXABLE:true},db);
  assert.match(xml,/https:\/\/ideal-abakan.ru\/about.html/);
  for(const key of ['gym','group','personal'])assert.match(xml,new RegExp('directions/'+key));
  assert.doesNotMatch(xml,/content\/photos|cart.html/);
});
test('Floating CTA always uses the fixed club phone and has no disabled placeholder',()=>{
  const html=readFileSync('server/views/public/floating-cta.ejs','utf8');
  assert.match(html,/href="tel:\+73902287386"/);
  assert.match(html,/href="tel:/);
  assert.doesNotMatch(html,/floating-cta__link--disabled/);
  assert.doesNotMatch(html, /<% if \(floatingContacts.phone\) { %>\s*<nav/);
  assert.match(html,/href="#contacts"/);
  assert.match(html,/aria-hidden="true" inert/);
  assert.match(readFileSync('site/scripts/floating-cta.js','utf8'),/footer.getBoundingClientRect\(\)/);
  const css=readFileSync('site/css/main.css','utf8');
  assert.match(css, /@media \(max-width: 1180px\) \{\s*\.header__appointment \{ display: none; \}/);
});
