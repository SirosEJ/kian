import { describe,it,expect,vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { createRunner } from './runner.js';

describe('execution gate',()=>{
  it('executes only queued versions once and never retries an uncertain email',async()=>{
    const db=new PGlite();
    await db.exec(await readFile(new URL('../../../../../packages/db/migrations/001_core.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../../../../../packages/db/migrations/002_conversations.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../../../../../packages/db/migrations/003_message_tasks.sql',import.meta.url),'utf8'));
    await db.query<Record<string,unknown>>("INSERT INTO users(id) VALUES ('alice'),('bob')");
    await db.query<Record<string,unknown>>("INSERT INTO tasks(id,owner_id,action,state,parameters) VALUES ('approved','alice','email.send','queued','{}'),('unapproved','alice','jira.create','proposed','{}'),('rejected','alice','email.send','rejected','{}')");
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
  it('rolls back incomplete result persistence and reconciles terminal receipts',async()=>{
    const db=new PGlite();
    await db.exec(await readFile(new URL('../../../../../packages/db/migrations/001_core.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../../../../../packages/db/migrations/002_conversations.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../../../../../packages/db/migrations/003_message_tasks.sql',import.meta.url),'utf8'));
    await db.query<Record<string,unknown>>("INSERT INTO users(id) VALUES ('alice')");
    await db.query<Record<string,unknown>>("INSERT INTO tasks(id,owner_id,action,state,parameters) VALUES ('t','alice','email.send','queued','{}')");
    const execute=vi.fn(async()=>({status:'succeeded' as const,externalId:'mail-id'}));
    const fault={query:async(sql:string,params?:unknown[])=>{if(sql.startsWith('INSERT INTO activity'))throw new Error('simulated activity write failure');return db.query<Record<string,unknown>>(sql,params);}};
    await expect(createRunner(fault,execute).run('alice','t')).rejects.toThrow('simulated');
    expect((await db.query<Record<string,unknown>>("SELECT status FROM executions WHERE id='t:1'")).rows[0].status).toBe('running');
    expect((await db.query<Record<string,unknown>>("SELECT state FROM tasks WHERE id='t'")).rows[0].state).toBe('executing');
    const runner=createRunner(db,execute);
    expect(await runner.run('alice','t')).toBeNull();
    await db.query<Record<string,unknown>>("UPDATE executions SET status='succeeded' WHERE id='t:1'");
    await runner.recoverInterrupted();
    expect((await db.query<Record<string,unknown>>("SELECT state FROM tasks WHERE id='t'")).rows[0].state).toBe('succeeded');
    expect(execute).toHaveBeenCalledTimes(1);
    await db.close();
  });

  it('does not execute a version invalidated between claiming and starting',async()=>{
    const db=new PGlite();
    await db.exec(await readFile(new URL('../../../../../packages/db/migrations/001_core.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../../../../../packages/db/migrations/002_conversations.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../../../../../packages/db/migrations/003_message_tasks.sql',import.meta.url),'utf8'));
    await db.query<Record<string,unknown>>("INSERT INTO users(id) VALUES ('alice')");
    await db.query<Record<string,unknown>>("INSERT INTO tasks(id,owner_id,action,state,parameters) VALUES ('race','alice','jira.create','queued','{}')");
    const interleaved={query:async(sql:string,params?:unknown[])=>{
      const result=await db.query<Record<string,unknown>>(sql,params);
      if(sql.startsWith('INSERT INTO executions')) await db.query<Record<string,unknown>>("UPDATE tasks SET state='proposed',version=version+1 WHERE id='race'");
      return result;
    }};
    const execute=vi.fn(async()=>({status:'succeeded' as const}));
    expect(await createRunner(interleaved,execute).run('alice','race')).toBeNull();
    expect(execute).not.toHaveBeenCalled();
    expect((await db.query<Record<string,unknown>>("SELECT state,version FROM tasks WHERE id='race'")).rows[0]).toEqual({state:'proposed',version:2});
    await db.close();
  });

});
