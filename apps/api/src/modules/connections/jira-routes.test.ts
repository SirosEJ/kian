import { describe,it,expect,vi } from 'vitest';
import Fastify from 'fastify';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { registerJiraConnectionRoutes,getJiraConnection } from './jira-routes.js';
import { encryptSecret,decryptSecret } from './routes.js';

describe('Jira account connection',()=>{
  it('persists the rotated refresh token and blocks disconnected accounts',async()=>{
    const db=new PGlite();
    await db.exec(await readFile(new URL('../../../../../packages/db/migrations/001_core.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../../../../../packages/db/migrations/002_conversations.sql',import.meta.url),'utf8'));
    const key=Buffer.alloc(32,1),mock=vi.fn(async()=>Response.json({access_token:'new-access',refresh_token:'rotated-refresh',expires_in:3600}));
    await db.query("INSERT INTO users(id) VALUES ('alice')");
    await db.query("INSERT INTO connections(id,owner_id,provider,display_name,settings,secret_ciphertext) VALUES ('j','alice','jira','Jira',$1,$2)",[JSON.stringify({siteId:'site-1',siteUrl:'https://demo.atlassian.net'}),encryptSecret({access_token:'old',refresh_token:'old-refresh',expires_at:1},key)]);
    const config={clientId:'id',clientSecret:'secret',redirectUri:'https://kian.example',encryptionKey:key,request:mock as typeof fetch};
    expect((await getJiraConnection(db,'alice','j',config)).accessToken).toBe('new-access');
    const row=(await db.query<{secret_ciphertext:Buffer}>('SELECT secret_ciphertext FROM connections WHERE id=$1',['j'])).rows[0];
    expect(decryptSecret<{refresh_token:string}>(row.secret_ciphertext,key).refresh_token).toBe('rotated-refresh');
    await db.query('UPDATE connections SET disconnected_at=now(),secret_ciphertext=NULL WHERE id=$1',['j']);
    await expect(getJiraConnection(db,'alice','j',config)).rejects.toMatchObject({statusCode:404});
    await db.close();
  });
  it('binds authorization to a user and allows only authorized sites and projects',async()=>{
    const db=new PGlite();
    await db.exec(await readFile(new URL('../../../../../packages/db/migrations/001_core.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../../../../../packages/db/migrations/002_conversations.sql',import.meta.url),'utf8'));
    const mock=vi.fn(async(url:string)=>{
      if(url==='https://auth.atlassian.com/oauth/token') return Response.json({access_token:'private-access',refresh_token:'private-refresh',expires_in:3600});
      if(url.includes('accessible-resources')) return Response.json([{id:'site-1',name:'Demo site',url:'https://demo.atlassian.net',scopes:['read:jira-work','write:jira-work']}]);
      if(url.includes('project/search')) return Response.json({values:[{key:'DEMO',name:'Demo project'}],isLast:true});
      if(url.includes('/issuetypes')) return Response.json({issueTypes:[{id:'1',name:'Story'}],isLast:true});
      return new Response('',{status:404});
    });
    const app=Fastify();
    registerJiraConnectionRoutes(app,db,async req=>req.headers.authorization==='alice'?'alice':'bob',{clientId:'id',clientSecret:'secret',redirectUri:'https://kian.example',encryptionKey:Buffer.alloc(32,1),request:mock as typeof fetch});
    const start=await app.inject({method:'POST',url:'/connections/jira/start',headers:{authorization:'alice'}});
    const state=new URL(start.json().url).searchParams.get('state');
    expect((await app.inject({method:'POST',url:'/connections/jira/complete',headers:{authorization:'bob'},payload:{state,code:'code'}})).statusCode).toBe(403);
    const complete=await app.inject({method:'POST',url:'/connections/jira/complete',headers:{authorization:'alice'},payload:{state,code:'code'}});
    expect(complete.statusCode).toBe(201); expect(complete.body).not.toContain('private-access');
    const id=complete.json().id;
    expect((await app.inject({method:'PUT',url:`/connections/jira/${id}/site`,headers:{authorization:'alice'},payload:{siteId:'other'}})).statusCode).toBe(422);
    expect((await app.inject({method:'PUT',url:`/connections/jira/${id}/site`,headers:{authorization:'alice'},payload:{siteId:'site-1'}})).statusCode).toBe(200);
    expect((await app.inject({method:'GET',url:`/connections/jira/${id}/projects`,headers:{authorization:'bob'}})).statusCode).toBe(404);
    expect((await app.inject({method:'GET',url:`/connections/jira/${id}/projects`,headers:{authorization:'alice'}})).json()[0].projectKey).toBe('DEMO');
    expect((await app.inject({method:'PUT',url:`/connections/jira/${id}/project`,headers:{authorization:'alice'},payload:{projectKey:'DEMO',issueTypeId:'1'}})).statusCode).toBe(200);
    expect((await app.inject({method:'PUT',url:`/connections/jira/${id}/project`,headers:{authorization:'alice'},payload:{projectKey:'OTHER',issueTypeId:'1'}})).statusCode).toBe(422);
    await app.close(); await db.close();
  });
});
