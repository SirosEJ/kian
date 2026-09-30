import { createRequire } from 'node:module';
import { readdir,readFile } from 'node:fs/promises';
const require=createRequire(new URL('../apps/api/package.json',import.meta.url));
const {Pool}=require('pg');
if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool=new Pool({connectionString:process.env.DATABASE_URL});
const client=await pool.connect();
try {
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('kian-migrations'))");
  await client.query('CREATE TABLE IF NOT EXISTS kian_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
  const dir=new URL('../packages/db/migrations/',import.meta.url);
  for(const name of (await readdir(dir)).filter(n=>/^\d+_.*\.sql$/.test(n)).sort()) {
    if((await client.query('SELECT name FROM kian_migrations WHERE name=$1',[name])).rows.length)continue;
    await client.query(await readFile(new URL(name,dir),'utf8'));
    await client.query('INSERT INTO kian_migrations(name) VALUES ($1)',[name]);
    console.log(`Applied ${name}`);
  }
  await client.query('COMMIT');
} catch(error) {await client.query('ROLLBACK');throw error;}
finally {client.release();await pool.end();}
