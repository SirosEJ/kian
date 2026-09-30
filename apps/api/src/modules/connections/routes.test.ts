import { describe,expect,it,vi } from 'vitest';
import Fastify from 'fastify';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { registerConnectionRoutes, encryptSecret, getGoogleAccessToken } from './routes.js';

describe('Google connection lifecycle',()=>{
  it('renews expired tokens and rejects revoked refresh access',async()=>{
    const db=new PGlite();
    await db.exec(await readFile(new URL('../../../../../packages/db/migrations/001_core.sql',import.meta.url),'utf8'));
    const key=Buffer.alloc(32,1);
    await db.query("INSERT INTO users(id) VALUES ('alice')");
    await db.query("INSERT INTO connections(id,owner_id,provider,display_name,secret_ciphertext) VALUES ('g','alice','google_calendar','Calendar',$1)",[encryptSecret({access_token:'expired',refresh_token:'refresh',expires_at:1},key)]);
    const config={clientId:'id',clientSecret:'secret',redirectUri:'https://kian.example',encryptionKey:key,request:vi.fn(async()=>new Response(JSON.stringify({access_token:'renewed',expires_in:3600}),{status:200})) as typeof fetch};
    expect(await getGoogleAccessToken(db,'alice','g',config)).toBe('renewed');
    expect(await getGoogleAccessToken(db,'alice','g',config)).toBe('renewed');
    expect(config.request).toHaveBeenCalledTimes(1);
    await db.query('UPDATE connections SET secret_ciphertext=$1 WHERE id=$2',[encryptSecret({access_token:'expired',refresh_token:'revoked',expires_at:1},key),'g']);
    await expect(getGoogleAccessToken(db,'alice','g',{...config,request:vi.fn(async()=>new Response('',{status:400})) as typeof fetch})).rejects.toMatchObject({statusCode:422});
    await db.close();
  });
  it('binds OAuth state to owner, discovers calendars, and disconnects without returning secrets',async()=>{
    const db=new PGlite();
    await db.exec(await readFile(new URL('../../../../../packages/db/migrations/001_core.sql',import.meta.url),'utf8'));
    const fetcher=vi.fn(async (url:string)=>url.includes('oauth2.googleapis.com') ? new Response(JSON.stringify({access_token:'access-secret',refresh_token:'refresh-secret',expires_in:3600}),{status:200}) : new Response(JSON.stringify({items:[{id:'primary',summary:'Personal',accessRole:'owner'}]}),{status:200}));
    const app=Fastify();
    registerConnectionRoutes(app,db,async request=>request.headers.authorization === 'Bearer alice' ? 'alice':'bob',{clientId:'cid',clientSecret:'secret',redirectUri:'https://kian.example/settings',encryptionKey:Buffer.alloc(32,1),request:fetcher as typeof fetch});
    const started=await app.inject({method:'POST',url:'/connections/google/start',headers:{authorization:'Bearer alice'}});
    const state=new URL(started.json().url).searchParams.get('state');
    expect(state).toBeTruthy();
    expect((await app.inject({method:'POST',url:'/connections/google/complete',headers:{authorization:'Bearer bob'},payload:{state,code:'code'}})).statusCode).toBe(403);
    const complete=await app.inject({method:'POST',url:'/connections/google/complete',headers:{authorization:'Bearer alice'},payload:{state,code:'code'}});
    expect(complete.statusCode).toBe(201);
    expect(JSON.stringify(complete.json())).not.toContain('secret');
    const id=complete.json().id;
    expect((await app.inject({method:'POST',url:'/connections/google/complete',headers:{authorization:'Bearer alice'},payload:{state,code:'code'}})).statusCode).toBe(400);
    expect((await app.inject({method:'GET',url:`/connections/${id}/destinations`,headers:{authorization:'Bearer bob'}})).statusCode).toBe(404);
    expect((await app.inject({method:'GET',url:`/connections/${id}/destinations`,headers:{authorization:'Bearer alice'}})).json()).toEqual([{id:'primary',name:'Personal',canWrite:true}]);
    expect((await app.inject({method:'PUT',url:`/connections/${id}/destination`,headers:{authorization:'Bearer alice'},payload:{destination:'primary'}})).statusCode).toBe(200);
    expect((await app.inject({method:'DELETE',url:`/connections/${id}`,headers:{authorization:'Bearer alice'}})).statusCode).toBe(204);
    expect((await app.inject({method:'GET',url:`/connections/${id}/destinations`,headers:{authorization:'Bearer alice'}})).statusCode).toBe(404);
    await app.close(); await db.close();
  });
});
