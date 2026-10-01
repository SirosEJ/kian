import { describe,it,expect,vi } from 'vitest';
import Fastify from 'fastify';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { registerDecisionRoutes } from '../../src/modules/tasks/activity.js';
import { createRunner } from '../../src/modules/execution/runner.js';

// Sandboxed API journey. This does not claim Firebase/browser/live-provider coverage.
describe('multi-task sandbox journey',()=>{
  it('approves tasks separately, preserves partial outcomes and recovers without resending',async()=>{
    const db=new PGlite();
    await db.exec(await readFile(new URL('../../../../packages/db/migrations/001_core.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../../../../packages/db/migrations/002_conversations.sql',import.meta.url),'utf8'));
    await db.query<Record<string,unknown>>("INSERT INTO users(id) VALUES ('alice')");
    const complete:Record<string,object>={'calendar.create':{summary:'Planning',start:'2026-10-02T15:00:00+01:00',end:'2026-10-02T15:30:00+01:00'},'jira.create':{summary:'Fix login'},'email.send':{to:['to@example.com'],subject:'Agenda',body:'See you there'}};
    for(const [id,action] of [['event','calendar.create'],['story','jira.create'],['mail','email.send'],['reject','email.send']]) await db.query<Record<string,unknown>>("INSERT INTO tasks(id,owner_id,action,state,parameters) VALUES ($1,'alice',$2,'proposed',$3)",[id,action,JSON.stringify({connectionId:'connection',destination:'demo',fields:complete[action],uncertainties:[]})]);
    const execute=vi.fn(async(_owner:string,task:{id:string})=>task.id==='event' ? {status:'succeeded' as const,externalId:'event-1',link:'https://example.com/event'} : task.id==='story' ? {status:'failed' as const,error:'Permission denied'} : {status:'uncertain' as const,error:'Inspect mailbox'});
    const runner=createRunner(db,execute),app=Fastify();
    registerDecisionRoutes(app,db,async()=> 'alice',(owner,id)=>runner.run(owner,id));
    expect(execute).not.toHaveBeenCalled();
    for(const id of ['event','story','mail']) expect((await app.inject({method:'POST',url:`/tasks/${id}/decision`,payload:{version:1,decision:'approve'}})).statusCode).toBe(200);
    await app.inject({method:'POST',url:'/tasks/reject/decision',payload:{version:1,decision:'reject'}});
    expect((await db.query<Record<string,unknown>>('SELECT id,state FROM tasks ORDER BY id')).rows).toEqual([{id:'event',state:'succeeded'},{id:'mail',state:'uncertain'},{id:'reject',state:'rejected'},{id:'story',state:'failed'}]);
    expect((await app.inject({method:'POST',url:'/tasks/mail/decision',payload:{version:1,decision:'approve'}})).statusCode).toBe(409);
    await runner.run('alice','mail');
    expect(execute).toHaveBeenCalledTimes(3);
    await db.query<Record<string,unknown>>("INSERT INTO tasks(id,owner_id,action,state,parameters) VALUES ('interrupted','alice','email.send','executing','{}')");
    await db.query<Record<string,unknown>>("INSERT INTO executions(id,owner_id,task_id,task_version,status,created_at) VALUES ('interrupted:1','alice','interrupted',1,'running',now()-interval '10 minutes')");
    await runner.recoverInterrupted();
    expect((await db.query<Record<string,unknown>>("SELECT state FROM tasks WHERE id='interrupted'")).rows[0].state).toBe('uncertain');
    expect(await runner.run('alice','interrupted')).toBeNull();
    expect(execute).toHaveBeenCalledTimes(3);
    const activity=(await app.inject('/activity')).json();
    expect(activity.some((e:{details:{externalId?:string}})=>e.details.externalId==='event-1')).toBe(true);
    await app.close();await db.close();
  });
});
