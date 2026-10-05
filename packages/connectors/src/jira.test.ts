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

describe('listing Jira projects',()=>{
  it('skips a project that answers 404 or 403 for create metadata and still lists the others (one hidden project must not break Settings)',async()=>{
    const mock=vi.fn(async (url:string)=>{
      const path=new URL(url).pathname;
      if(path.includes('project/search')) return Response.json({values:[{id:'1',key:'NOPE',name:'No create'},{id:'2',key:'LOCKED',name:'Locked'},{id:'3',key:'SFT',name:'Kanban'}],isLast:true});
      if(path.includes('/NOPE/')) return new Response('',{status:404});
      if(path.includes('/LOCKED/')) return new Response('',{status:403});
      return Response.json({issueTypes:[{id:'10224',name:'Story'}],isLast:true});
    });
    const result=await new JiraConnector(mock as typeof fetch).listDestinations({accessToken:'t',siteId:'s',siteUrl:'https://s.atlassian.net'} as never);
    expect(result.map(p=>p.projectKey)).toEqual(['SFT']);
  });
  it('still fails loudly on a server error',async()=>{
    const mock=vi.fn(async (url:string)=>new URL(url).pathname.includes('project/search')?Response.json({values:[{id:'1',key:'A',name:'A'}],isLast:true}):new Response('',{status:500}));
    await expect(new JiraConnector(mock as typeof fetch).listDestinations({accessToken:'t',siteId:'s',siteUrl:'https://s.atlassian.net'} as never)).rejects.toThrow('500');
  });
});

describe('Jira status changes',()=>{
  const fake=(opts:{status?:string;project?:string;transitions?:{id:string;name:string;to:{name:string}}[];postStatus?:number}={})=>{
    const posts:string[]=[];
    const mock=vi.fn(async (url:string,init?:RequestInit)=>{
      const path=new URL(url).pathname;
      if(init?.method==='POST'){ posts.push(`${path} ${init.body}`); return opts.postStatus ? new Response('',{status:opts.postStatus}) : new Response(null,{status:204}); }
      if(path.endsWith('/transitions')) return Response.json({transitions:opts.transitions ?? [{id:'21',name:'Start',to:{name:'In Progress'}},{id:'31',name:'Finish',to:{name:'Done'}}]});
      return Response.json({fields:{project:{key:opts.project ?? 'DEMO'},status:{name:opts.status ?? 'To Do'}}});
    });
    return {adapter:new JiraConnector(mock as typeof fetch),posts};
  };
  const move=(toStatus:string,issueKey='DEMO-7')=>({action:'jira.transition' as const,projectKey:'DEMO',issueKey,toStatus});

  it('moves an issue through the transition Jira offers for the wanted status, and links to it',async()=>{
    const {adapter,posts}=fake();
    const result=await adapter.execute(connection,move('In Progress'),'k');
    expect(result).toMatchObject({status:'succeeded',externalId:'DEMO-7',link:'https://demo.atlassian.net/browse/DEMO-7'});
    expect(posts).toEqual(['/ex/jira/site-1/rest/api/3/issue/DEMO-7/transitions {"transition":{"id":"21"}}']);
  });

  it('matches the status name without caring about case, and also accepts the transition\'s own name',async()=>{
    expect((await fake().adapter.execute(connection,move('in progress'),'k')).status).toBe('succeeded');
    const {adapter,posts}=fake({transitions:[{id:'9',name:'Begin work',to:{name:'In Development'}}]});
    await adapter.execute(connection,move('begin work'),'k');
    expect(posts[0]).toContain('"id":"9"');
  });

  it('writes nothing when the issue is already in that status',async()=>{
    const {adapter,posts}=fake({status:'In Progress'});
    expect((await adapter.execute(connection,move('In Progress'),'k')).status).toBe('succeeded');
    expect(posts).toEqual([]);
  });

  it('refuses a move Jira does not offer, names what is available and writes nothing',async()=>{
    const {adapter,posts}=fake();
    await expect(adapter.execute(connection,move('Blocked'),'k')).rejects.toThrow('Available: In Progress, Done');
    expect(posts).toEqual([]);
  });

  it('refuses an issue outside the approved project, before reading or writing anything else',async()=>{
    expect(()=>fake().adapter.validate({...move('Done','OTHER-1')})).toThrow('approved project');
    const {adapter,posts}=fake({project:'ELSEWHERE'});
    await expect(adapter.execute(connection,move('Done'),'k')).rejects.toThrow('approved project');
    expect(posts).toEqual([]);
  });

  it('turns a refused transition into a clear failure',async()=>{
    const {adapter}=fake({postStatus:400});
    await expect(adapter.execute(connection,move('In Progress'),'k')).rejects.toThrow(/Jira refused to move DEMO-7.*transition screen/);
  });

  it('rejects bad keys and empty statuses',()=>{
    const {adapter}=fake();
    for(const bad of [move('Done','demo-7'),move('Done','DEMO-'),move('Done','DEMO-1; DROP'),move(''),move('x'.repeat(81))]) expect(()=>adapter.validate(bad)).toThrow();
  });

  it('lists the moves Jira allows, read-only',async()=>{
    const {adapter,posts}=fake();
    expect((await adapter.transitions(connection,'DEMO-7')).map(t=>t.to)).toEqual(['In Progress','Done']);
    expect(posts).toEqual([]);
  });
});

