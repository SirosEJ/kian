import { randomBytes,randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Queryable } from '@kian/db';
import { JiraConnector,type JiraConnection } from '@kian/connectors';
import { encryptSecret,decryptSecret,type GoogleConfig } from './routes.js';

export type JiraConfig=GoogleConfig;
const error=(statusCode:number,message:string)=>Object.assign(new Error(message),{statusCode});
type Tokens={access_token:string;refresh_token:string;expires_at:number};

export async function getJiraConnection(db:Queryable,owner:string,id:string,config:JiraConfig):Promise<JiraConnection> {
  const row=(await db.query("SELECT secret_ciphertext,settings FROM connections WHERE owner_id=$1 AND id=$2 AND provider='jira' AND disconnected_at IS NULL",[owner,id])).rows[0];
  if(!row) throw error(404,'Connection not found');
  let tokens=decryptSecret<Tokens>(row.secret_ciphertext,config.encryptionKey);
  if(!tokens.expires_at || tokens.expires_at<=Date.now()+60000) {
    const response=await (config.request || fetch)('https://auth.atlassian.com/oauth/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grant_type:'refresh_token',client_id:config.clientId,client_secret:config.clientSecret,refresh_token:tokens.refresh_token})});
    if(!response.ok) throw error(422,'Jira access expired. Reconnect in Settings.');
    const fresh=await response.json() as {access_token?:string;refresh_token?:string;expires_in?:number};
    if(!fresh.access_token || !fresh.refresh_token) throw error(502,'Jira token renewal failed');
    tokens={access_token:fresh.access_token,refresh_token:fresh.refresh_token,expires_at:Date.now()+(fresh.expires_in || 3600)*1000};
    await db.query('UPDATE connections SET secret_ciphertext=$3 WHERE owner_id=$1 AND id=$2 AND disconnected_at IS NULL',[owner,id,encryptSecret(tokens,config.encryptionKey)]);
  }
  return {accessToken:tokens.access_token,siteId:row.settings.siteId || '',siteUrl:row.settings.siteUrl || ''};
}

export function registerJiraConnectionRoutes(app:FastifyInstance,db:Queryable,authenticate:(req:{headers:{authorization?:string}})=>Promise<string>,config:JiraConfig) {
  const request=config.request || fetch,jira=new JiraConnector(request);
  app.post('/connections/jira/start',async req=>{
    const owner=await authenticate(req),state=`jira_${randomBytes(32).toString('base64url')}`;
    await db.query('INSERT INTO users(id) VALUES ($1) ON CONFLICT (id) DO NOTHING',[owner]);
    await db.query("INSERT INTO oauth_states(state,owner_id,provider,expires_at) VALUES ($1,$2,'jira',now()+interval '10 minutes')",[state,owner]);
    const url=new URL('https://auth.atlassian.com/authorize');
    url.search=new URLSearchParams({audience:'api.atlassian.com',client_id:config.clientId,scope:'read:jira-work write:jira-work offline_access',redirect_uri:config.redirectUri,state,response_type:'code',prompt:'consent'}).toString();
    return {url:url.toString()};
  });
  app.post<{Body:{state?:string;code?:string}}>('/connections/jira/complete',async(req,reply)=>{
    const owner=await authenticate(req),{state,code}=req.body || {};
    if(!state || !code || state.length>128 || code.length>4096) return reply.code(400).send({error:'Invalid authorization response'});
    const record=(await db.query("SELECT owner_id,expires_at,used_at FROM oauth_states WHERE state=$1 AND provider='jira'",[state])).rows[0];
    if(!record || record.used_at || new Date(record.expires_at).getTime()<=Date.now()) return reply.code(400).send({error:'Authorization expired or used'});
    if(record.owner_id!==owner) return reply.code(403).send({error:'Authorization belongs to another user'});
    if(!(await db.query('UPDATE oauth_states SET used_at=now() WHERE state=$1 AND owner_id=$2 AND used_at IS NULL AND expires_at>now() RETURNING state',[state,owner])).rows.length) return reply.code(400).send({error:'Authorization already used'});
    const response=await request('https://auth.atlassian.com/oauth/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grant_type:'authorization_code',client_id:config.clientId,client_secret:config.clientSecret,code,redirect_uri:config.redirectUri})});
    if(!response.ok) return reply.code(502).send({error:'Jira authorization failed'});
    const token=await response.json() as {access_token?:string;refresh_token?:string;expires_in?:number};
    if(!token.access_token || !token.refresh_token) return reply.code(502).send({error:'Jira offline access is required'});
    const sites=await jira.listSites(token.access_token),id=randomUUID();
    await db.query("INSERT INTO connections(id,owner_id,provider,display_name,secret_ciphertext,settings) VALUES ($1,$2,'jira','Jira Cloud',$3,$4)",[id,owner,encryptSecret({...token,expires_at:Date.now()+(token.expires_in || 3600)*1000},config.encryptionKey),JSON.stringify({destination:null,siteId:null,siteUrl:null})]);
    return reply.code(201).send({id,provider:'jira',sites});
  });
  app.get<{Params:{id:string}}>('/connections/jira/:id/sites',async req=>{
    const connection=await getJiraConnection(db,await authenticate(req),req.params.id,config);
    return jira.listSites(connection.accessToken);
  });
  app.put<{Params:{id:string};Body:{siteId?:string}}>('/connections/jira/:id/site',async(req,reply)=>{
    const owner=await authenticate(req),connection=await getJiraConnection(db,owner,req.params.id,config);
    const site=(await jira.listSites(connection.accessToken)).find(site=>site.id===req.body?.siteId);
    if(!site) return reply.code(422).send({error:'Select an authorized Jira site'});
    await db.query('UPDATE connections SET settings=$3 WHERE owner_id=$1 AND id=$2',[owner,req.params.id,JSON.stringify({siteId:site.id,siteUrl:site.url,destination:null,issueTypeId:null})]);
    return {id:req.params.id,siteId:site.id,siteUrl:site.url};
  });
  app.get<{Params:{id:string}}>('/connections/jira/:id/projects',async req=>{
    const connection=await getJiraConnection(db,await authenticate(req),req.params.id,config);
    if(!connection.siteId) throw error(422,'Choose a Jira site first');
    await jira.connect(connection);
    return jira.listDestinations(connection);
  });
  app.put<{Params:{id:string};Body:{projectKey?:string;issueTypeId?:string}}>('/connections/jira/:id/project',async(req,reply)=>{
    const owner=await authenticate(req),connection=await getJiraConnection(db,owner,req.params.id,config);
    if(!connection.siteId) throw error(422,'Choose a Jira site first');
    await jira.connect(connection);
    const project=(await jira.listDestinations(connection)).find(p=>p.projectKey===req.body?.projectKey);
    if(!project || !project.issueTypes.some(type=>type.id===req.body?.issueTypeId)) return reply.code(422).send({error:'Select an accessible project and issue type'});
    await db.query("UPDATE connections SET settings=settings || $3::jsonb WHERE owner_id=$1 AND id=$2",[owner,req.params.id,JSON.stringify({destination:project.projectKey,issueTypeId:req.body.issueTypeId})]);
    return {id:req.params.id,projectKey:project.projectKey,issueTypeId:req.body.issueTypeId};
  });
  app.get<{Params:{id:string;project:string;type:string}}>('/connections/jira/:id/fields/:project/:type',async req=>{
    const connection=await getJiraConnection(db,await authenticate(req),req.params.id,config);
    await jira.connect(connection);
    return jira.fields(connection,req.params.project,req.params.type);
  });
}
