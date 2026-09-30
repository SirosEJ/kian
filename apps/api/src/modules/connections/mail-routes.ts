import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Queryable } from '@kian/db';
import { IonosMailConnector, MailConnectionError, type IonosConnection, type MailFailureReason } from '@kian/connectors';
import { decryptSecret, encryptSecret } from './routes.js';

const messages:Record<MailFailureReason,string>={
  auth:'The mailbox rejected the email address or password. Check them, or create an app password if your IONOS account requires one.',
  host:'Could not reach the mail server. Check that the IONOS server region matches your mailbox.',
  tls:'The secure connection to the mail server failed. Check the IONOS server region and try again.',
  timeout:'The mail server did not respond in time. Try again shortly.',
  unknown:'Mailbox connection failed. Check the IONOS server and mailbox credentials.',
};
const reasonOf=(error:unknown):MailFailureReason=>error instanceof MailConnectionError ? error.reason : 'unknown';

export function registerMailConnectionRoutes(app:FastifyInstance,db:Queryable,authenticate:(req:{headers:{authorization?:string}})=>Promise<string>,key:Buffer,mail=new IonosMailConnector()) {
  async function mailbox(owner:string,id:string) {
    const row=(await db.query("SELECT secret_ciphertext FROM connections WHERE owner_id=$1 AND id=$2 AND provider='ionos' AND disconnected_at IS NULL",[owner,id])).rows[0];
    return row ? decryptSecret<IonosConnection>(row.secret_ciphertext as Buffer,key) : null;
  }
  app.post<{Body:{host?:string;user?:string;password?:string}}>('/connections/ionos',async(req,reply)=>{
    const owner=await authenticate(req);
    let connection;
    try {connection=await mail.connect(req.body);} catch(error) {const reason=reasonOf(error);return reply.code(422).send({error:messages[reason],reason});}
    await db.query('INSERT INTO users(id) VALUES ($1) ON CONFLICT (id) DO NOTHING',[owner]);
    const id=randomUUID();
    await db.query("INSERT INTO connections(id,owner_id,provider,display_name,secret_ciphertext,settings) VALUES ($1,$2,'ionos',$3,$4,$5)",[id,owner,connection.user,encryptSecret(connection,key),JSON.stringify({mailbox:connection.user,host:connection.host})]);
    return reply.code(201).send({id,provider:'ionos',displayName:connection.user,settings:{mailbox:connection.user,host:connection.host}});
  });
  app.post<{Params:{id:string}}>('/connections/ionos/:id/test',async(req,reply)=>{
    const connection=await mailbox(await authenticate(req),req.params.id);
    if(!connection) return reply.code(404).send({error:'Connection not found'});
    const result=await mail.diagnose(connection);
    return result.ok ? {ok:true} : {ok:false,reason:result.reason,message:messages[result.reason]};
  });
  app.put<{Params:{id:string};Body:{host?:string;password?:string}}>('/connections/ionos/:id',async(req,reply)=>{
    const owner=await authenticate(req),current=await mailbox(owner,req.params.id);
    if(!current) return reply.code(404).send({error:'Connection not found'});
    let updated;
    try {updated=await mail.connect({host:req.body?.host||current.host,user:current.user,password:req.body?.password});} catch(error) {const reason=reasonOf(error);return reply.code(422).send({error:messages[reason],reason});}
    await db.query("UPDATE connections SET secret_ciphertext=$3,settings=jsonb_set(settings,'{host}',to_jsonb($4::text)) WHERE owner_id=$1 AND id=$2 AND provider='ionos' AND disconnected_at IS NULL",[owner,req.params.id,encryptSecret(updated,key),updated.host]);
    return {id:req.params.id,provider:'ionos',displayName:updated.user,settings:{mailbox:updated.user,host:updated.host}};
  });
}
