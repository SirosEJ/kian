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
