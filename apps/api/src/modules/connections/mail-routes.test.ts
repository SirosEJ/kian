import { describe,it,expect } from 'vitest';
import Fastify from 'fastify';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { IonosMailConnector, MailConnector } from '@kian/connectors';
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


describe('any mailbox (SFT-341)',()=>{
  async function setup(verify:()=>Promise<unknown>=async()=>true,resolver=async()=>[{address:'93.184.216.34',family:4}]) {
    const db=new PGlite();
    for(const file of ['001_core','002_conversations','003_message_tasks','004_message_tables']) await db.exec(await readFile(new URL(`../../../../../packages/db/migrations/${file}.sql`,import.meta.url),'utf8'));
    const app=Fastify(),key=Buffer.alloc(32,2),targets:{host:string;servername:string;port:number}[]=[];
    const mail=new MailConnector((_c,t)=>{targets.push(t);return {verify,sendMail:async()=>({}),close:()=>{}};},resolver);
    registerMailConnectionRoutes(app,db,async req=>req.headers.authorization==='Bearer bob' ? 'bob':'alice',key,mail);
    return {db,app,key,targets};
  }
  const post=(app:Awaited<ReturnType<typeof setup>>['app'],payload:object,who='alice')=>app.inject({method:'POST',url:'/connections/mailbox',headers:{authorization:`Bearer ${who}`},payload});

  it('lists the providers for Settings, with help text and no secrets, only to a signed-in user',async()=>{
    const {app}=await setup();
    const list=(await app.inject({method:'GET',url:'/connections/mailbox/presets',headers:{authorization:'Bearer alice'}})).json() as {id:string;label:string;help:string;host:string|null}[];
    expect(list.map(p=>p.id)).toEqual(expect.arrayContaining(['gmail','outlook','microsoft365','yahoo','icloud','zoho','fastmail','gmx','ionos-uk','other']));
    expect(list.find(p=>p.id==='gmail')).toMatchObject({label:'Gmail',host:'smtp.gmail.com'});
    expect(list.find(p=>p.id==='gmail')!.help).toMatch(/App passwords/);
    await app.close();
  });

  it('connects a Gmail mailbox with an app password, stores it encrypted, and shows only safe details',async()=>{
    const {db,app,key,targets}=await setup();
    const response=await post(app,{preset:'gmail',user:'me@gmail.com',password:'abcd efgh ijkl mnop'});
    expect(response.statusCode).toBe(201);
    expect(response.body).not.toContain('abcd');
    expect(response.json()).toMatchObject({provider:'mailbox',displayName:'me@gmail.com',settings:{mailbox:'me@gmail.com',host:'smtp.gmail.com',port:465,security:'ssl',preset:'gmail',presetLabel:'Gmail'}});
    expect(targets[0]).toMatchObject({host:'smtp.gmail.com',port:465});
    const row=(await db.query<{provider:string;secret_ciphertext:Buffer;settings:object}>('SELECT provider,secret_ciphertext,settings FROM connections')).rows[0];
    expect(Buffer.from(row.secret_ciphertext).toString('utf8')).not.toContain('abcd');
    expect(decryptSecret<{password:string;host:string}>(row.secret_ciphertext,key)).toMatchObject({password:'abcd efgh ijkl mnop',host:'smtp.gmail.com'});
    expect(JSON.stringify(row.settings)).not.toContain('abcd');
    await app.close();await db.close();
  });

  it('keeps several mailboxes per person, tests and updates each, and hides them from other users',async()=>{
    const {db,app}=await setup();
    const gmail=(await post(app,{preset:'gmail',user:'me@gmail.com',password:'p1'})).json().id as string;
    const outlook=(await post(app,{preset:'outlook',user:'me@outlook.com',password:'p2'})).json().id as string;
    const legacy=(await app.inject({method:'POST',url:'/connections/ionos',payload:{host:'smtp.ionos.co.uk',user:'me@sepenta.io',password:'p3'}})).json().id as string;
    expect((await db.query("SELECT 1 FROM connections WHERE owner_id='alice' AND disconnected_at IS NULL")).rows).toHaveLength(3);
    for(const id of [gmail,outlook,legacy]) {
      expect((await app.inject({method:'POST',url:`/connections/mailbox/${id}/test`})).json(),id).toEqual({ok:true});
      expect((await app.inject({method:'PUT',url:`/connections/mailbox/${id}`,payload:{password:'new'}})).statusCode,id).toBe(200);
      expect((await app.inject({method:'POST',url:`/connections/mailbox/${id}/test`,headers:{authorization:'Bearer bob'}})).statusCode,id).toBe(404);
      expect((await app.inject({method:'PUT',url:`/connections/mailbox/${id}`,headers:{authorization:'Bearer bob'},payload:{password:'x'}})).statusCode,id).toBe(404);
    }
    expect((await db.query<{provider:string}>("SELECT provider FROM connections ORDER BY created_at")).rows.map(r=>r.provider)).toEqual(['mailbox','mailbox','ionos']);
    await app.close();await db.close();
  });

  it('explains each failure for the provider: wrong password, app password needed, administrator switched it off',async()=>{
    for(const [error,reason,words] of [[{code:'EAUTH',responseCode:535},'auth',/Gmail needs an app password/],[{code:'EAUTH',responseCode:534,response:'534-5.7.9 Application-specific password required'},'app-password',/App passwords/],[{code:'EAUTH',response:'5.7.139 basic authentication is disabled'},'basic-auth-disabled',/administrator/]] as const) {
      const {db,app}=await setup(async()=>{throw Object.assign(new Error('x'),error);});
      const response=await post(app,{preset:'gmail',user:'me@gmail.com',password:'p'});
      expect(response.statusCode).toBe(422);
      expect(response.json().reason).toBe(reason);
      expect(response.json().error).toMatch(words);
      expect((await db.query('SELECT 1 FROM connections')).rows).toHaveLength(0);
      await app.close();await db.close();
    }
  });

  it('refuses a missing or unknown provider, and a custom server that is internal, with nothing saved',async()=>{
    const {db,app,targets}=await setup(async()=>true,async()=>[{address:'10.0.0.8',family:4}]);
    expect((await post(app,{user:'me@example.com',password:'p'})).statusCode).toBe(422);
    expect((await post(app,{preset:'nope',user:'me@example.com',password:'p'})).statusCode).toBe(422);
    for(const host of ['localhost','169.254.169.254','10.0.0.1','smtp.rebinding.example-provider.com']) {
      const response=await post(app,{preset:'other',host,port:587,security:'starttls',user:'me@example.com',password:'p'});
      expect(response.statusCode,host).toBe(422);
      expect(['blocked','input']).toContain(response.json().reason);
    }
    expect(targets).toHaveLength(0);
    expect((await db.query('SELECT 1 FROM connections')).rows).toHaveLength(0);
    await app.close();await db.close();
  });

  it('connects a custom public server and connects to the checked address',async()=>{
    const {db,app,targets}=await setup();
    const response=await post(app,{preset:'other',host:'smtp.my-company-mail.com',port:587,security:'starttls',user:'me@my-company.com',password:'p'});
    expect(response.statusCode).toBe(201);
    expect(response.json().settings).toMatchObject({host:'smtp.my-company-mail.com',port:587,security:'starttls',preset:'other'});
    expect(targets[0]).toEqual({host:'93.184.216.34',servername:'smtp.my-company-mail.com',port:587,security:'starttls'});
    await app.close();await db.close();
  });
});
