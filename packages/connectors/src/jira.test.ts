import { describe,it,expect,vi } from 'vitest';
import { JiraConnector } from './jira.js';

const connection={accessToken:'token',siteId:'site-1',siteUrl:'https://demo.atlassian.net'};
describe('Jira Cloud adapter',()=>{
  it('discovers sites, projects and allowed fields, then creates an issue',async()=>{
    const mock=vi.fn(async (url:string,init?:RequestInit)=>{
      url=new URL(url).pathname;
      if(url.includes('accessible-resources')) return Response.json([{id:'site-1',name:'Demo',url:connection.siteUrl,scopes:['read:jira-work','write:jira-work']}]);
      if(url.includes('project/search')) return Response.json({values:[{id:'100',key:'DEMO',name:'Demo'}],isLast:true});
      if(url.endsWith('/issuetypes')) return Response.json({issueTypes:[{id:'1',name:'Story'}],isLast:true});
      if(url.endsWith('/issuetypes/1')) return Response.json({fields:[{fieldId:'summary',required:true},{fieldId:'description',required:false},{fieldId:'issuetype',required:true},{fieldId:'project',required:true}],isLast:true});
      if(init?.method==='POST') return Response.json({id:'1001',key:'DEMO-1'},{status:201});
      return Response.json({});
    });
    const adapter=new JiraConnector(mock as typeof fetch);
    expect((await adapter.listSites('token'))[0].id).toBe('site-1');
    expect((await adapter.listDestinations(connection))[0]).toMatchObject({id:'DEMO',issueTypes:[{id:'1',name:'Story'}]});
    const result=await adapter.execute(connection,{action:'jira.create',projectKey:'DEMO',issueTypeId:'1',fields:{summary:'New story',description:'Acceptance criteria'}},'task-1');
    expect(result).toMatchObject({status:'succeeded',externalId:'DEMO-1',link:'https://demo.atlassian.net/browse/DEMO-1'});
    const sent=JSON.parse(String(mock.mock.calls.find(([,init])=>init?.method==='POST')?.[1]?.body));
    expect(sent.fields.description.type).toBe('doc');
    await expect(adapter.execute(connection,{action:'jira.create',projectKey:'DEMO',issueTypeId:'1',fields:{summary:'X',unsupported:'bad'}},'task-2')).rejects.toThrow('Unsupported Jira field');
  });
  it('handles revoked access, restricted projects and updates only the approved project',async()=>{
    await expect(new JiraConnector(vi.fn(async()=>new Response('',{status:401})) as typeof fetch).listSites('revoked')).rejects.toThrow('Jira access failed');
    const mock=vi.fn(async (url:string,init?:RequestInit)=>{
      url=new URL(url).pathname;
      if(url.includes('project/search')) return Response.json({values:[{id:'100',key:'LOCKED',name:'Locked'}],isLast:true});
      if(url.endsWith('/issuetypes')) return new Response('',{status:403});
      if(url.endsWith('/editmeta')) return Response.json({fields:{summary:{required:true}}});
      if(url.endsWith('/issue/DEMO-1') && init?.method!=='PUT') return Response.json({fields:{project:{key:'DEMO'}}});
      return new Response(null,{status:204});
    });
    const adapter=new JiraConnector(mock as typeof fetch);
    expect(await adapter.listDestinations(connection)).toEqual([]);
    expect((await adapter.execute(connection,{action:'jira.update',projectKey:'DEMO',issueKey:'DEMO-1',fields:{summary:'Changed'}},'u1')).status).toBe('succeeded');
    await expect(adapter.execute(connection,{action:'jira.update',projectKey:'OTHER',issueKey:'DEMO-1',fields:{summary:'Changed'}},'u2')).rejects.toThrow('approved project');
  });
});
