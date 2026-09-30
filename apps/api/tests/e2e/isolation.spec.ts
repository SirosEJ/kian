import { describe,it,expect,vi } from 'vitest';
import Fastify from 'fastify';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { registerDecisionRoutes } from '../../src/modules/tasks/activity.js';
import { createRequireUser } from '../../src/modules/identity/session.js';
import { createRunner } from '../../src/modules/execution/runner.js';

describe('sandbox account boundaries',()=>{
  it('denies missing identity, cross-owner decisions and revoked automatic trust',async()=>{
    const db=new PGlite();
    await db.exec(await readFile(new URL('../../../../packages/db/migrations/001_core.sql',import.meta.url),'utf8'));
    await db.query<Record<string,unknown>>("INSERT INTO users(id) VALUES ('alice'),('bob')");
    await db.query<Record<string,unknown>>("INSERT INTO connections(id,owner_id,provider,display_name) VALUES ('mail','alice','ionos','Mailbox')");
    await db.query<Record<string,unknown>>("INSERT INTO trust_rules(id,owner_id,connection_id,action,constraints,revoked_at) VALUES ('rule','alice','mail','email.send',$1,now())",[JSON.stringify({destinations:['to@example.com']})]);
    const parameters={connectionId:'mail',destination:'to@example.com',fields:{to:['to@example.com']},uncertainties:[],trustRuleId:'rule'};
    await db.query<Record<string,unknown>>("INSERT INTO tasks(id,owner_id,action,state,parameters) VALUES ('auto','alice','email.send','queued',$1),('manual','alice','email.send','proposed',$1)",[JSON.stringify(parameters)]);
    const execute=vi.fn(async()=>({status:'succeeded' as const}));
    const runner=createRunner(db,execute),app=Fastify();
    const auth=createRequireUser(async token=>{if(!['alice','bob'].includes(token))throw new Error('invalid');return {uid:token};});
    registerDecisionRoutes(app,db,auth,(owner,id)=>runner.run(owner,id));
    expect((await app.inject('/activity')).statusCode).toBe(401);
    expect((await app.inject({method:'POST',url:'/tasks/manual/decision',headers:{authorization:'Bearer bob'},payload:{version:1,decision:'approve'}})).statusCode).toBe(404);
    expect(await runner.run('bob','auto')).toBeNull();
    expect(await runner.run('alice','auto')).toBeNull();
    expect((await db.query<Record<string,unknown>>("SELECT state,version FROM tasks WHERE id='auto'")).rows[0]).toEqual({state:'proposed',version:2});
    expect((await app.inject({url:'/activity',headers:{authorization:'Bearer bob'}})).json()).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
    const manual=await app.inject({method:'POST',url:'/tasks/auto/decision',headers:{authorization:'Bearer alice'},payload:{version:2,decision:'approve'}});
    expect(manual.json().state).toBe('succeeded');
    expect(execute).toHaveBeenCalledTimes(1);
    await app.close();await db.close();
  });
});
