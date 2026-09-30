import { describe,it,expect,vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { createRunner } from './runner.js';

describe('execution gate',()=>{
  it('executes only queued versions once and never retries an uncertain email',async()=>{
    const db=new PGlite();
    await db.exec(await readFile(new URL('../../../../../packages/db/migrations/001_core.sql',import.meta.url),'utf8'));
    await db.query("INSERT INTO users(id) VALUES ('alice'),('bob')");
    await db.query("INSERT INTO tasks(id,owner_id,action,state,parameters) VALUES ('approved','alice','email.send','queued','{}'),('unapproved','alice','jira.create','proposed','{}'),('rejected','alice','email.send','rejected','{}')");
    const execute=vi.fn(async()=>({status:'uncertain' as const,error:'Check sent mail before trying again'}));
    const runner=createRunner(db,execute);
    expect(await runner.run('bob','approved')).toBeNull();
    expect(await runner.run('alice','unapproved')).toBeNull();
    expect(await runner.run('alice','rejected')).toBeNull();
    expect((await runner.run('alice','approved'))?.status).toBe('uncertain');
    expect(await runner.run('alice','approved')).toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
    expect((await db.query<{state:string}>("SELECT state FROM tasks WHERE id='approved'")).rows[0].state).toBe('uncertain');
    await db.close();
  });
});
