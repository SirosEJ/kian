import { describe,it,expect } from 'vitest';
import Fastify from 'fastify';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { IonosMailConnector } from '@kian/connectors';
import { registerMailConnectionRoutes } from './mail-routes.js';
import { decryptSecret } from './routes.js';

describe('mailbox settings',()=>{
  it('stores credentials encrypted and returns only safe mailbox metadata',async()=>{
    const db=new PGlite();
    await db.exec(await readFile(new URL('../../../../../packages/db/migrations/001_core.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../../../../../packages/db/migrations/002_conversations.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../../../../../packages/db/migrations/003_message_tasks.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../../../../../packages/db/migrations/004_message_tables.sql',import.meta.url),'utf8'));
    const app=Fastify(),key=Buffer.alloc(32,2);
    const mail=new IonosMailConnector(()=>({verify:async()=>true,sendMail:async()=>({}),close:()=>{}}));
    registerMailConnectionRoutes(app,db,async()=> 'alice',key,mail);
    const response=await app.inject({method:'POST',url:'/connections/ionos',payload:{host:'smtp.ionos.co.uk',user:'alice@example.com',password:'private-password'}});
    expect(response.statusCode).toBe(201);
    expect(response.body).not.toContain('private-password');
    const saved=(await db.query<{owner_id:string;secret_ciphertext:Buffer}>('SELECT owner_id,secret_ciphertext FROM connections')).rows[0];
    expect(saved.owner_id).toBe('alice');
    expect(Buffer.from(saved.secret_ciphertext).toString()).not.toContain('private-password');
    expect(decryptSecret<{password:string}>(saved.secret_ciphertext,key).password).toBe('private-password');
    expect((await app.inject({method:'POST',url:'/connections/ionos',payload:{host:'attacker.example',user:'alice@example.com',password:'x'}})).statusCode).toBe(422);
    await app.close();await db.close();
  });
});

describe('mailbox status and credential update',()=>{
  async function setup(verify:()=>Promise<unknown>) {
    const db=new PGlite();
    await db.exec(await readFile(new URL('../../../../../packages/db/migrations/001_core.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../../../../../packages/db/migrations/002_conversations.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../../../../../packages/db/migrations/003_message_tasks.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../../../../../packages/db/migrations/004_message_tables.sql',import.meta.url),'utf8'));
    const app=Fastify(),key=Buffer.alloc(32,2);
    const mail=new IonosMailConnector(()=>({verify,sendMail:async()=>({}),close:()=>{}}));
    registerMailConnectionRoutes(app,db,async req=>req.headers.authorization==='Bearer bob' ? 'bob':'alice',key,mail);
    return {db,app,key};
  }
  const connect=(app:Awaited<ReturnType<typeof setup>>['app'],password='pw')=>app.inject({method:'POST',url:'/connections/ionos',payload:{host:'smtp.ionos.co.uk',user:'alice@example.com',password}});

  it('reports actionable reasons when the mailbox rejects the connection',async()=>{
    const {db,app}=await setup(async()=>{throw Object.assign(new Error('bad'),{code:'EAUTH'});});
    const response=await connect(app);
    expect(response.statusCode).toBe(422);
    expect(response.json().reason).toBe('auth');
    expect(response.json().error).toContain('password');
    expect((await db.query('SELECT id FROM connections')).rows).toHaveLength(0);
    await app.close();await db.close();
  });

  it('tests the saved mailbox, rotates the password, and hides both from other users',async()=>{
    let accepting=true;
    const {db,app,key}=await setup(async()=>{if(!accepting) throw Object.assign(new Error('bad'),{code:'EAUTH'});});
    const id=(await connect(app,'old-password')).json().id;
    expect((await app.inject({method:'POST',url:`/connections/ionos/${id}/test`})).json()).toEqual({ok:true});
    accepting=false;
    const failed=(await app.inject({method:'POST',url:`/connections/ionos/${id}/test`})).json();
    expect(failed).toMatchObject({ok:false,reason:'auth'});
    expect((await app.inject({method:'PUT',url:`/connections/ionos/${id}`,payload:{password:'wrong'}})).statusCode).toBe(422);
    accepting=true;
    const updated=await app.inject({method:'PUT',url:`/connections/ionos/${id}`,payload:{password:'new-password'}});
    expect(updated.statusCode).toBe(200);
    expect(updated.body).not.toContain('new-password');
    const saved=(await db.query<{secret_ciphertext:Buffer}>('SELECT secret_ciphertext FROM connections WHERE id=$1',[id])).rows[0];
    expect(decryptSecret<{password:string}>(saved.secret_ciphertext,key).password).toBe('new-password');
    const asBob={authorization:'Bearer bob'};
    expect((await app.inject({method:'POST',url:`/connections/ionos/${id}/test`,headers:asBob})).statusCode).toBe(404);
    expect((await app.inject({method:'PUT',url:`/connections/ionos/${id}`,headers:asBob,payload:{password:'hijack'}})).statusCode).toBe(404);
    expect(decryptSecret<{password:string}>((await db.query<{secret_ciphertext:Buffer}>('SELECT secret_ciphertext FROM connections WHERE id=$1',[id])).rows[0].secret_ciphertext,key).password).toBe('new-password');
    await app.close();await db.close();
  });
});

