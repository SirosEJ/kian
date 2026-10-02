import { describe,it,expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { saveJiraMapping,snapshotJiraFields } from './jira-mapping.js';
import { createProviderExecutor } from '../execution/providers.js';

describe('immutable Jira consent',()=>{
  it('snapshots issue type and blocks a changed site before any external write',async()=>{
    const db=new PGlite();
    await db.exec(await readFile(new URL('../../../../../packages/db/migrations/001_core.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../../../../../packages/db/migrations/002_conversations.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../../../../../packages/db/migrations/003_message_tasks.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../../../../../packages/db/migrations/004_message_tables.sql',import.meta.url),'utf8'));
    await db.query<Record<string,unknown>>("INSERT INTO users(id) VALUES ('alice')");
    await db.query<Record<string,unknown>>("INSERT INTO connections(id,owner_id,provider,display_name,settings) VALUES ('j','alice','jira','Jira',$1)",[JSON.stringify({siteId:'old',siteUrl:'https://old.atlassian.net',destination:'DEMO',issueTypeId:'1'})]);
    const fields=snapshotJiraFields({summary:'Story'}, {siteId:'old',siteUrl:'https://old.atlassian.net',issueTypeId:'1'});
    expect(fields.issueTypeId).toBe('1');
    await db.query<Record<string,unknown>>("INSERT INTO tasks(id,owner_id,action,state,parameters) VALUES ('t','alice','jira.create','queued',$1)",[JSON.stringify({connectionId:'j',destination:'DEMO',fields,uncertainties:[]})]);
    await db.query<Record<string,unknown>>("INSERT INTO trust_rules(id,owner_id,connection_id,action,constraints) VALUES ('r','alice','j','jira.create',$1)",[JSON.stringify({destinations:['DEMO']})]);
    await saveJiraMapping(db,'alice','j',{siteId:'new',siteUrl:'https://new.atlassian.net',destination:'DEMO',issueTypeId:'2'},true);
    expect((await db.query<Record<string,unknown>>("SELECT state,version,parameters FROM tasks WHERE id='t'")).rows[0]).toMatchObject({state:'proposed',version:2,parameters:{fields:{issueTypeId:'1',_jiraSiteId:'old'}}});
    expect((await db.query<Record<string,unknown>>("SELECT revoked_at FROM trust_rules WHERE id='r'")).rows[0].revoked_at).not.toBeNull();
    const execute=createProviderExecutor(db,Buffer.alloc(32),undefined,{clientId:'id',clientSecret:'secret',redirectUri:'https://kian.example/',encryptionKey:Buffer.alloc(32),request:async()=>{throw new Error('No provider request should occur');}});
    expect(await execute('alice',{id:'t',owner_id:'alice',action:'jira.create',state:'queued',version:1,parameters:{connectionId:'j',destination:'DEMO',fields,uncertainties:[]}},'t:1')).toMatchObject({status:'failed',error:expect.stringContaining('mapping changed')});
    await db.close();
  });

  it('also stops a status change when the Jira site changed, before any request to Jira',async()=>{
    const db=new PGlite();
    for(const f of ['001_core.sql','002_conversations.sql','003_message_tasks.sql','004_message_tables.sql']) await db.exec(await readFile(new URL(`../../../../../packages/db/migrations/${f}`,import.meta.url),'utf8'));
    await db.query("INSERT INTO users(id) VALUES ('alice')");
    await db.query("INSERT INTO connections(id,owner_id,provider,display_name,settings) VALUES ('j','alice','jira','Jira',$1)",[JSON.stringify({siteId:'new',siteUrl:'https://new.atlassian.net',destination:'DEMO'})]);
    const execute=createProviderExecutor(db,Buffer.alloc(32),undefined,{clientId:'id',clientSecret:'secret',redirectUri:'https://kian.example/',encryptionKey:Buffer.alloc(32),request:async()=>{throw new Error('No provider request should occur');}});
    const fields=snapshotJiraFields({issueKey:'DEMO-1',toStatus:'Done'},{siteId:'old',siteUrl:'https://old.atlassian.net'});
    expect(await execute('alice',{id:'t',owner_id:'alice',action:'jira.transition',state:'queued',version:1,parameters:{connectionId:'j',destination:'DEMO',fields,uncertainties:[]}},'t:1')).toMatchObject({status:'failed',error:expect.stringContaining('mapping changed')});
    // Not approvable while a question is open either.
    expect(await execute('alice',{id:'t',owner_id:'alice',action:'jira.transition',state:'queued',version:1,parameters:{connectionId:'j',destination:'DEMO',fields,uncertainties:['SFT-1 is already Done.']}},'t:1')).toMatchObject({status:'failed'});
    await db.close();
  });
});

