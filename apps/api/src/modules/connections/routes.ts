import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Queryable } from '@kian/db';
import { GoogleCalendarConnector } from '@kian/connectors';

export type GoogleConfig = { clientId:string; clientSecret:string; redirectUri:string; encryptionKey:Buffer; request?:typeof fetch };
const error = (statusCode:number,message:string) => Object.assign(new Error(message),{statusCode});
export function encryptSecret(value:unknown,key:Buffer) {
  if(key.length!==32) throw new Error('Encryption key must contain 32 bytes');
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  return Buffer.concat([iv,cipher.update(JSON.stringify(value),'utf8'),cipher.final(),cipher.getAuthTag()]);
}
export function decryptSecret<T>(bytes:Buffer,key:Buffer):T {
  const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));
  decipher.setAuthTag(bytes.subarray(bytes.length-16));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12,-16)),decipher.final()]).toString('utf8')) as T;
}

export async function getGoogleAccessToken(db:Queryable,owner:string,id:string,config:GoogleConfig):Promise<string> {
  const row=(await db.query("SELECT secret_ciphertext FROM connections WHERE owner_id=$1 AND id=$2 AND provider='google_calendar' AND disconnected_at IS NULL",[owner,id])).rows[0];
  if(!row) throw error(404,'Connection not found');
  const token=decryptSecret<{access_token:string;refresh_token:string;expires_at?:number}>(row.secret_ciphertext,config.encryptionKey);
  if(token.expires_at && token.expires_at>Date.now()+60000) return token.access_token;
  const response=await (config.request || fetch)('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,refresh_token:token.refresh_token,grant_type:'refresh_token'})});
  if(!response.ok) throw error(422,'Google access expired. Reconnect in Settings.');
  const refreshed=await response.json() as {access_token?:string;expires_in?:number};
  if(!refreshed.access_token) throw error(502,'Google token refresh failed');
  const updated={...token,access_token:refreshed.access_token,expires_at:Date.now()+(refreshed.expires_in || 3600)*1000};
  await db.query('UPDATE connections SET secret_ciphertext=$3 WHERE owner_id=$1 AND id=$2 AND disconnected_at IS NULL',[owner,id,encryptSecret(updated,config.encryptionKey)]);
  return updated.access_token;
}

export function registerConnectionRoutes(app:FastifyInstance,db:Queryable,authenticate:(request:{headers:{authorization?:string}})=>Promise<string>,config:GoogleConfig) {
  const request=config.request || fetch,google=new GoogleCalendarConnector(request);
  app.post('/connections/google/start',async req=>{
    if(!config.clientId || !config.clientSecret || !config.redirectUri) throw error(503,'Google Calendar is not configured');
    const owner=await authenticate(req),state=randomBytes(32).toString('base64url');
    await db.query('INSERT INTO users(id) VALUES ($1) ON CONFLICT (id) DO NOTHING',[owner]);
    await db.query("INSERT INTO oauth_states(state,owner_id,provider,expires_at) VALUES ($1,$2,'google',now()+interval '10 minutes')",[state,owner]);
    const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search=new URLSearchParams({client_id:config.clientId,redirect_uri:config.redirectUri,response_type:'code',scope:'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly',access_type:'offline',prompt:'consent',state}).toString();
    return {url:url.toString()};
  });
  app.post<{Body:{state?:string;code?:string}}>('/connections/google/complete',async (req,reply)=>{
    if(!config.clientId || !config.clientSecret || !config.redirectUri) throw error(503,'Google Calendar is not configured');
    const owner=await authenticate(req),{state,code}=req.body || {};
    if(!state || !code || state.length>128 || code.length>4096) return reply.code(400).send({error:'Invalid authorization response'});
    const record=(await db.query('SELECT owner_id,expires_at,used_at FROM oauth_states WHERE state=$1 AND provider=$2',[state,'google'])).rows[0];
    if(!record || record.used_at || new Date(record.expires_at).getTime()<=Date.now()) return reply.code(400).send({error:'Authorization expired or used'});
    if(record.owner_id!==owner) return reply.code(403).send({error:'Authorization belongs to another user'});
    const used=await db.query('UPDATE oauth_states SET used_at=now() WHERE state=$1 AND owner_id=$2 AND used_at IS NULL AND expires_at>now() RETURNING state',[state,owner]);
    if(!used.rows.length) return reply.code(400).send({error:'Authorization already used'});
    const tokensResponse=await request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:config.clientId,client_secret:config.clientSecret,redirect_uri:config.redirectUri,grant_type:'authorization_code'})});
    if(!tokensResponse.ok) return reply.code(502).send({error:'Google authorization failed'});
    const tokens=await tokensResponse.json() as {access_token?:string;refresh_token?:string;expires_in?:number};
    if(!tokens.access_token || !tokens.refresh_token) return reply.code(502).send({error:'Google did not provide offline access'});
    const destinations=await google.listDestinations({accessToken:tokens.access_token}),id=randomUUID();
    await db.query("INSERT INTO connections(id,owner_id,provider,display_name,secret_ciphertext,settings) VALUES ($1,$2,'google_calendar','Google Calendar',$3,$4)",[id,owner,encryptSecret({...tokens,expires_at:Date.now()+(tokens.expires_in || 3600)*1000},config.encryptionKey),JSON.stringify({destination:null})]);
    return reply.code(201).send({id,provider:'google_calendar',displayName:'Google Calendar',destinations});
  });
  app.get('/connections',async req=>(await db.query('SELECT id,provider,display_name,settings FROM connections WHERE owner_id=$1 AND disconnected_at IS NULL',[await authenticate(req)])).rows);
  async function get(owner:string,id:string) {
    const row=(await db.query('SELECT id,provider,secret_ciphertext,settings FROM connections WHERE owner_id=$1 AND id=$2 AND disconnected_at IS NULL',[owner,id])).rows[0];
    if(!row) throw error(404,'Connection not found');
    return row as {secret_ciphertext:Buffer;provider:string};
  }
  app.get<{Params:{id:string}}>('/connections/:id/destinations',async req=>{
    const row=await get(await authenticate(req),req.params.id);
    if(row.provider!=='google_calendar') throw error(422,'Unsupported connection');
    return google.listDestinations({accessToken:await getGoogleAccessToken(db,await authenticate(req),req.params.id,config)});
  });
  app.put<{Params:{id:string};Body:{destination?:string}}>('/connections/:id/destination',async (req,reply)=>{
    const owner=await authenticate(req),row=await get(owner,req.params.id),destination=req.body?.destination;
    if(typeof destination!=='string') return reply.code(400).send({error:'Destination required'});
    if(row.provider!=='google_calendar') throw error(422,'Unsupported connection');
    if(!(await google.listDestinations({accessToken:await getGoogleAccessToken(db,owner,req.params.id,config)})).some(c=>c.id===destination && c.canWrite)) return reply.code(422).send({error:'Select a writable calendar'});
    await db.query("UPDATE connections SET settings=jsonb_set(settings,'{destination}',to_jsonb($3::text)) WHERE owner_id=$1 AND id=$2",[owner,req.params.id,destination]);
    return {id:req.params.id,destination};
  });
  app.delete<{Params:{id:string}}>('/connections/:id',async (req,reply)=>{
    const owner=await authenticate(req);
    const result=await db.query('UPDATE connections SET secret_ciphertext=NULL,disconnected_at=now() WHERE owner_id=$1 AND id=$2 AND disconnected_at IS NULL RETURNING id',[owner,req.params.id]);
    if(!result.rows.length) return reply.code(404).send({error:'Connection not found'});
    await db.query('UPDATE trust_rules SET revoked_at=now() WHERE owner_id=$1 AND connection_id=$2 AND revoked_at IS NULL',[owner,req.params.id]);
    return reply.code(204).send();
  });
}
