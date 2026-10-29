// Recover only the failed stage19 migration on the explicitly separate test DB.
// No DDL, no reset, no dev fallback and no migration marked applied.
import 'dotenv/config';
import pg from 'pg';
import {spawnSync} from 'node:child_process';
const migration='20261025170000_public_content';
let test,dev;
try {
 test=new URL(process.env.TEST_DATABASE_URL);
 dev=process.env.DATABASE_URL?new URL(process.env.DATABASE_URL):null;
 if(!['postgresql:','postgres:'].includes(test.protocol)||!/^\/[a-z0-9_]+_test$/.test(test.pathname)||
  (dev&&(test.username===dev.username||(test.hostname===dev.hostname&&(test.port||'5432')===(dev.port||'5432')&&test.pathname===dev.pathname))))throw Error();
}catch{console.error('Нужна отдельная TEST_DATABASE_URL: БД *_test и отдельный пользователь. Dev запрещена.');process.exit(1);}
const client=new pg.Client({connectionString:test.href,connectionTimeoutMillis:5000});
let recover=false;
try {
 await client.connect();
 await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const tables=await client.query(`SELECT to_regclass('public."ContentEntry"') AS entry, to_regclass('public."ContentPhoto"') AS photo`);
 if(tables.rows[0].entry||tables.rows[0].photo)throw Error('Новые таблицы присутствуют: автоматическое восстановление остановлено. Ничего не удалено.');
 const rows=await client.query('SELECT finished_at, rolled_back_at FROM "_prisma_migrations" WHERE migration_name=$1 ORDER BY started_at',[migration]);
 if(rows.rows.some(r=>r.finished_at))throw Error('Есть успешно применённая миграция: восстановление остановлено.');
 recover=rows.rows.some(r=>!r.finished_at&&!r.rolled_back_at);
 await client.query('COMMIT');
}catch(e){console.error(e.message?.includes('остановлено')?e.message:'Проверка тестовой БД не выполнена. Ничего не изменено.');process.exitCode=1;}
finally{await client.end().catch(()=>{});}
if(!process.exitCode){
 if(recover){
  console.log('Новые таблицы отсутствуют. Отмечаем только неудачную попытку миграции тестовой БД как rolled back.');
  const r=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','resolve','--rolled-back',migration],{env:{...process.env,DATABASE_URL:test.href},stdio:'inherit'});
  if(r.status!==0)process.exitCode=r.status||1;
 }else console.log('Незакрытых неудачных попыток нет. Можно выполнить npm test.');
}
