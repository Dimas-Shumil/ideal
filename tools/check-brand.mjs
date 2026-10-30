// Read-only: no database, dotenv, session or push operations.
import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),refs=new Set();
async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){if(['node_modules','.git','upload','uploads'].includes(e.name))continue;const p=path.join(dir,e.name);if(e.isDirectory())await walk(p);else if(/\.(ejs|html|js|json|css|scss)$/.test(p)){for(const m of (await readFile(p,'utf8')).matchAll(/\/site\/(?:img\/(?:brand|pwa)\/[\w.-]+|css\/brand-v1\.css)/g))refs.add(m[0]);}}}
await walk(root);
for(const ref of refs)assert.ok((await readFile(path.join(root,ref))).length,ref);
const m=JSON.parse(await readFile(path.join(root,'server/modules/pwa/manifest.json'),'utf8'));
assert.equal(m.id,'/employee-app');assert.equal(m.start_url,'/');assert.equal(m.scope,'/');
for(const i of [...m.icons,{src:'/site/img/pwa/apple-touch-180-v1.png',sizes:'180x180'}]){const b=await readFile(path.join(root,i.src));assert.equal(b.subarray(1,4).toString(),'PNG');assert.equal(`${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`,i.sizes);}
if(process.argv[2]){const base=new URL(process.argv[2]);assert.ok(['http:','https:'].includes(base.protocol));for(const ref of [...refs,'/manifest.webmanifest','/push-sw.js']){const res=await fetch(new URL(ref,base),{redirect:'error',signal:AbortSignal.timeout(15000)});assert.equal(res.status,200,ref);await res.arrayBuffer();}}
console.log(`Brand OK: ${refs.size} asset paths, manifest identity, PNG dimensions${process.argv[2]?', HTTP OK':''}.`);
