// Read-only consistency snapshot. This is NOT a database backup.
import 'dotenv/config';
import pg from 'pg';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const args=process.argv.slice(2);
try {
  if(args[0]==='compare' && args.length===3){
    const [before,after]=await Promise.all(args.slice(1).map(async p=>JSON.parse(await readFile(p,'utf8'))));
    if(before.format!=='ideal-stage16-v1'||after.format!==before.format||before.database!==after.database)throw Error('SNAPSHOT_MISMATCH');
    const names=[...new Set([...Object.keys(before.tables),...Object.keys(after.tables)])].sort();
    const changed=names.filter(name=>JSON.stringify(before.tables[name])!==JSON.stringify(after.tables[name]));
    console.log(changed.length?'Изменились таблицы: '+changed.join(', '):'Совпадают строки и digest прежних данных всех '+names.length+' таблиц.');
    if(changed.length)process.exitCode=1;
  }else if(args.length===1 && args[0]==='snapshot'){
    const url=new URL(process.env.DATABASE_URL);
    if(!['postgresql:','postgres:'].includes(url.protocol))throw Error('DATABASE_URL');
    const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const database=(await client.query('SELECT current_database() AS name')).rows[0].name;
      const tables={};
      const list=(await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name")).rows;
      for(const {table_name:name} of list){
        const quoted='"'+name.replaceAll('"','""')+'"';
        const rows=(await client.query(`SELECT (to_jsonb(t) - $1::text[])::text AS value FROM public.${quoted} t ORDER BY value`,[name==='MembershipPlan'?['publicVisible','publicOrder']:[]])).rows;
        const hash=createHash('sha256');for(const row of rows)hash.update(row.value+'\n');
        tables[name]={count:rows.length,digest:hash.digest('hex')};
      }
      await client.query('COMMIT');
      console.log(JSON.stringify({format:'ideal-stage16-v1',database,excluded:['_prisma_migrations','MembershipPlan.publicVisible','MembershipPlan.publicOrder'],tables},null,2));
    }finally{await client.end();}
  }else{
    console.error('Использование: node tools/stage16-db-check.mjs snapshot > ..\\ideal-before-stage16.json\nСравнение: node tools/stage16-db-check.mjs compare ..\\ideal-before-stage16.json ..\\ideal-after-stage16.json');
    process.exitCode=1;
  }
}catch{console.error('Проверка не выполнена. Проверьте DATABASE_URL, доступность БД и пути снимков.');process.exitCode=1;}
