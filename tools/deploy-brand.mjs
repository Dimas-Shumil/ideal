// Run from the existing IDEAL repository as the SAME user that runs PM2.
// Only a fast-forward of the reviewed branding patch and one exact PM2 app restart.
import {execFileSync} from 'node:child_process';
import {readFileSync, realpathSync, existsSync} from 'node:fs';
const run=(cmd,args)=>execFileSync(cmd,args,{encoding:'utf8'}).trim();
const git=(...args)=>run('git',args);
const root=git('rev-parse','--show-toplevel');
if(realpathSync(root)!==realpathSync(process.cwd()))throw Error('Run from repository root.');
if(JSON.parse(readFileSync('package.json')).name!=='ideal-club')throw Error('Wrong repository.');
console.log(git('remote','-v'));console.log(git('status','--short','--branch'));
if(git('branch','--show-current')!=='main')throw Error('Expected main.');
if(git('status','--porcelain'))throw Error('Working tree is not clean. Save/review local changes first.');
const upstream=git('rev-parse','--abbrev-ref','--symbolic-full-name','@{u}');
const remote=upstream.slice(0,upstream.indexOf('/'));
const url=git('remote','get-url',remote);
if(!/github\.com[:/](Dimas-Shumil|PabloAlligator)\/ideal(?:\.git)?$/i.test(url))throw Error('Unexpected upstream remote; review manually.');
const apps=JSON.parse(run('pm2',['jlist'])).filter(p=>{
 try{return realpathSync(p.pm2_env.pm_cwd)===realpathSync(root)&&(/server\/index\.js$/.test(p.pm2_env.pm_exec_path)||/npm(?:-cli\.js)?$/.test(p.pm2_env.pm_exec_path));}catch{return false;}
});
if(apps.length!==1)throw Error('Cannot identify exactly one IDEAL web process. Run pm2 list / pm2 describe and review; nothing updated.');
run('git',['fetch',remote]);
const allowed=new Set(readFileSync('docs/BRAND_PATCH_FILES.txt','utf8').trim().split(/\r?\n/));
const changes=git('diff','--name-only','HEAD',upstream).split('\n').filter(Boolean);
const unexpected=changes.filter(p=>!allowed.has(p));
if(unexpected.length)throw Error('Upstream includes non-brand changes; review manually: '+unexpected.join(', '));
console.log('Updating:',root,'PM2:',apps[0].name,'files:',changes.length);
const envBefore=existsSync('.env')?readFileSync('.env'):null;
console.log(git('merge','--ff-only',upstream));
if(envBefore&&!envBefore.equals(readFileSync('.env')))throw Error('.env changed unexpectedly; restart aborted.');
console.log(run(process.execPath,['tools/check-brand.mjs']));
console.log(run('pm2',['restart',String(apps[0].pm_id)]));
console.log('Check: node tools/check-brand.mjs https://ideal-abakan.ru');
