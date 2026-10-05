import type { Connector,Destination,ExecutionResult } from '@kian/contracts';

export type JiraConnection={accessToken:string;siteId:string;siteUrl:string};
export type JiraCommand={action:'jira.create'|'jira.update';projectKey:string;issueTypeId?:string;issueKey?:string;fields:Record<string,unknown>}|{action:'jira.transition';projectKey:string;issueKey:string;toStatus:string};
export type JiraSite={id:string;name:string;url:string;scopes:string[]};
type Field={fieldId?:string;required?:boolean;hasDefaultValue?:boolean};

export class JiraConnector implements Connector<JiraConnection,JiraCommand> {
  constructor(private readonly request:typeof fetch=(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(30000)})) {}
  async connect(input:unknown):Promise<JiraConnection> {
    const value=input as JiraConnection;
    if(!value?.accessToken || !value.siteId || !value.siteUrl) throw new Error('Jira authorization and site selection required');
    if(!(await this.listSites(value.accessToken)).some(site=>site.id===value.siteId && site.url===value.siteUrl)) throw new Error('Jira site is not authorized');
    return value;
  }
  async listSites(accessToken:string):Promise<JiraSite[]> {
    const response=await this.request('https://api.atlassian.com/oauth/token/accessible-resources',{headers:{Authorization:`Bearer ${accessToken}`,Accept:'application/json'}});
    if(!response.ok) throw new Error('Jira access failed');
    const sites=await response.json() as JiraSite[];
    return sites.filter(site=>site.scopes.includes('read:jira-work') && site.scopes.includes('write:jira-work'));
  }
  private async api(connection:JiraConnection,path:string,init:RequestInit={}) {
    const response=await this.request(`https://api.atlassian.com/ex/jira/${encodeURIComponent(connection.siteId)}/rest/api/3/${path}`,{...init,headers:{Authorization:`Bearer ${connection.accessToken}`,Accept:'application/json','Content-Type':'application/json',...init.headers}});
    if(!response.ok) throw new Error(`Jira access failed (${response.status})`);
    return response;
  }
  async test(connection:JiraConnection) { try { await this.connect(connection); return true; } catch { return false; } }
  async listDestinations(connection:JiraConnection):Promise<(Destination & {siteId:string;projectKey:string;issueTypes:{id:string;name:string}[]})[]> {
    const result:(Destination & {siteId:string;projectKey:string;issueTypes:{id:string;name:string}[]})[]=[];
    let startAt=0;
    for(let page=0;page<100;page++) {
      const body=await (await this.api(connection,`project/search?maxResults=100&startAt=${startAt}`)).json() as {values:{id:string;key:string;name:string}[];isLast?:boolean;total?:number};
      for(const project of body.values) {
        try { const types=await this.issueTypes(connection,project.key); if(types.length) result.push({id:project.key,projectKey:project.key,siteId:connection.siteId,name:project.name,canWrite:true,issueTypes:types}); }
        catch(error) { if(!/\((403|404)\)/.test(String(error))) throw error; }
      }
      startAt+=body.values.length;
      if(body.isLast || !body.values.length || (body.total!==undefined && startAt>=body.total)) return result;
    }
    throw new Error('Too many Jira projects to discover');
  }
  async issueTypes(connection:JiraConnection,projectKey:string):Promise<{id:string;name:string}[]> {
    const body=await (await this.api(connection,`issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes?maxResults=100`)).json() as {issueTypes:{id:string;name:string}[];isLast?:boolean};
    if(body.isLast===false) throw new Error('Too many issue types for this project');
    return body.issueTypes || [];
  }
  async fields(connection:JiraConnection,projectKey:string,issueTypeId:string):Promise<Field[]> {
    const types=await this.issueTypes(connection,projectKey);
    if(!types.some(type=>type.id===issueTypeId)) throw new Error('Unsupported Jira issue type');
    const body=await (await this.api(connection,`issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes/${encodeURIComponent(issueTypeId)}?maxResults=100`)).json() as {fields:Field[];isLast?:boolean};
    if(body.isLast===false) throw new Error('Too many fields for this issue type');
    return body.fields || [];
  }
  /** A status change: the issue must be in the approved project and the target status must be a plain name. */
  private validateTransition(command:Extract<JiraCommand,{action:'jira.transition'}>) {
    if(!/^[A-Z][A-Z0-9_]*$/.test(command.projectKey) || !/^[A-Z][A-Z0-9_]*-\d{1,7}$/.test(command.issueKey) || !command.issueKey.startsWith(`${command.projectKey}-`)) throw new Error('Issue must belong to the approved project');
    if(typeof command.toStatus!=='string' || !command.toStatus.trim() || command.toStatus.length>80) throw new Error('A status to move to is required');
  }
  validate(command:JiraCommand) {
    if(command.action==='jira.transition') return this.validateTransition(command);
    if(!/^[A-Z][A-Z0-9_]*$/.test(command.projectKey) || !command.fields || typeof command.fields!=='object' || Array.isArray(command.fields)) throw new Error('Valid Jira project and fields required');
    if(command.action==='jira.create' && (!command.issueTypeId || typeof command.fields.summary!=='string' || !command.fields.summary.trim())) throw new Error('Issue type and summary required');
    if(command.action==='jira.update' && (!command.issueKey || !command.issueKey.startsWith(`${command.projectKey}-`))) throw new Error('Issue must belong to the approved project');
    if('project' in command.fields || 'issuetype' in command.fields) throw new Error('Project and issue type must use the selected mapping');
  }
  /** The moves Jira allows for this issue right now (read-only). */
  async transitions(connection:JiraConnection,issueKey:string):Promise<{id:string;name:string;to:string}[]> {
    const body=await (await this.api(connection,`issue/${encodeURIComponent(issueKey)}/transitions`)).json() as {transitions?:{id:string;name:string;to?:{name?:string}}[]};
    return (body.transitions ?? []).map(t=>({id:String(t.id),name:String(t.name),to:String(t.to?.name ?? t.name)}));
  }
  private async executeTransition(connection:JiraConnection,command:Extract<JiraCommand,{action:'jira.transition'}>):Promise<ExecutionResult> {
    const issue=await (await this.api(connection,`issue/${encodeURIComponent(command.issueKey)}?fields=project,status`)).json() as {fields:{project:{key:string};status:{name:string}}};
    if(issue.fields.project.key!==command.projectKey) throw new Error('Issue must belong to the approved project');
    const link=`${connection.siteUrl.replace(/\/$/,'')}/browse/${encodeURIComponent(command.issueKey)}`;
    const wanted=command.toStatus.trim().toLowerCase();
    // Already there: nothing to write.
    if(issue.fields.status.name.toLowerCase()===wanted) return {status:'succeeded',externalId:command.issueKey,link};
    const options=await this.transitions(connection,command.issueKey);
    const match=options.find(t=>t.to.toLowerCase()===wanted) ?? options.find(t=>t.name.toLowerCase()===wanted);
    if(!match) throw new Error(`Jira does not allow moving ${command.issueKey} to ${command.toStatus} right now. Available: ${options.map(t=>t.to).join(', ') || 'none'}.`);
    try { await this.api(connection,`issue/${encodeURIComponent(command.issueKey)}/transitions`,{method:'POST',body:JSON.stringify({transition:{id:match.id}})}); }
    catch(error) { throw new Error(`Jira refused to move ${command.issueKey} to ${command.toStatus}. It may need extra fields on its transition screen, or you may lack permission. (${String(error instanceof Error ? error.message : error)})`); }
    return {status:'succeeded',externalId:command.issueKey,link};
  }
  async execute(connection:JiraConnection,command:JiraCommand,_idempotencyKey:string):Promise<ExecutionResult> {
    this.validate(command);
    if(command.action==='jira.transition') return this.executeTransition(connection,command);
    let metadata:Record<string,Field>;
    if(command.action==='jira.create') metadata=Object.fromEntries((await this.fields(connection,command.projectKey,command.issueTypeId!)).map(field=>[field.fieldId!,field]));
    else {
      const issue=await (await this.api(connection,`issue/${encodeURIComponent(command.issueKey!)}?fields=project`)).json() as {fields:{project:{key:string}}};
      if(issue.fields.project.key!==command.projectKey) throw new Error('Issue must belong to the approved project');
      metadata=(await (await this.api(connection,`issue/${encodeURIComponent(command.issueKey!)}/editmeta`)).json() as {fields:Record<string,Field>}).fields;
    }
    for(const field of Object.keys(command.fields)) if(!(field in metadata)) throw new Error(`Unsupported Jira field: ${field}`);
    if(command.action==='jira.create') for(const [key,field] of Object.entries(metadata)) if(field.required && !field.hasDefaultValue && !['project','issuetype'].includes(key) && (command.fields[key]===undefined || command.fields[key]==='')) throw new Error(`Required Jira field: ${key}`);
    const fields={...command.fields};
    if(typeof fields.description==='string') fields.description={type:'doc',version:1,content:[{type:'paragraph',content:fields.description ? [{type:'text',text:fields.description}]:[]}]};
    if(command.action==='jira.create') { fields.project={key:command.projectKey}; fields.issuetype={id:command.issueTypeId}; }
    const response=await this.api(connection,command.action==='jira.create' ? 'issue':`issue/${encodeURIComponent(command.issueKey!)}`,{method:command.action==='jira.create' ? 'POST':'PUT',body:JSON.stringify({fields})});
    const key=command.action==='jira.create' ? (await response.json() as {key:string}).key:command.issueKey!;
    return {status:'succeeded',externalId:key,link:`${connection.siteUrl.replace(/\/$/,'')}/browse/${encodeURIComponent(key)}`};
  }
  async disconnect(_connection:JiraConnection) {}
}
