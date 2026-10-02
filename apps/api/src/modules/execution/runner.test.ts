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
    await db.exec(await readFile(new URL('../../../../../packages/db/migrations/004_message_tables.sql',import.meta.url),'utf8'));
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
    await db.exec(await readFile(new URL('../../../../../packages/db/migrations/004_message_tables.sql',import.meta.url),'utf8'));
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
    await db.exec(await readFile(new URL('../../../../../packages/db/migrations/004_message_tables.sql',import.meta.url),'utf8'));
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


  it('remembers the people an approved email went to, only after it was sent, and never when it was not',async()=>{
    const db=new PGlite();
    for(const f of ['001_core.sql','002_conversations.sql','003_message_tasks.sql','004_message_tables.sql','005_memory.sql']) await db.exec(await readFile(new URL(`../../../../../packages/db/migrations/${f}`,import.meta.url),'utf8'));
    await db.query("INSERT INTO users(id) VALUES ('alice')");
    const params=JSON.stringify({connectionId:null,destination:'sam@example.com',fields:{to:['sam@example.com','not-an-address'],subject:'Secret subject',body:'Secret body'},uncertainties:[]});
    await db.query("INSERT INTO tasks(id,owner_id,action,state,parameters) VALUES ('sent','alice','email.send','queued',$1),('unsure','alice','email.send','queued',$1)",[params]);
    const runner=createRunner(db,async(_o,task)=>task.id==='sent' ? {status:'succeeded' as const,externalId:'m1'}:{status:'uncertain' as const,error:'check'},true);
    await runner.run('alice','unsure');
    expect((await db.query('SELECT count(*)::int AS n FROM memory_terms')).rows[0]).toEqual({n:0});
    await runner.run('alice','sent');
    expect((await db.query('SELECT kind,value,detail,source FROM memory_terms')).rows).toEqual([{kind:'person',value:'sam@example.com',detail:'Emailed',source:'email'}]);
    expect(JSON.stringify((await db.query('SELECT value,detail FROM memory_terms')).rows)).not.toContain('Secret');
    expect((await db.query("SELECT details FROM activity WHERE event='memory.learned'")).rows).toEqual([{details:{terms:1}}]);
    await db.close();
  });
});
