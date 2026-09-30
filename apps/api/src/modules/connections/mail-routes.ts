import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Queryable } from '@kian/db';
import { IonosMailConnector } from '@kian/connectors';
import { encryptSecret } from './routes.js';

export function registerMailConnectionRoutes(app:FastifyInstance,db:Queryable,authenticate:(req:{headers:{authorization?:string}})=>Promise<string>,key:Buffer,mail=new IonosMailConnector()) {
  app.post<{Body:{host?:string;user?:string;password?:string}}>('/connections/ionos',async(req,reply)=>{
    const owner=await authenticate(req);
    let connection;
    try {connection=await mail.connect(req.body);} catch {return reply.code(422).send({error:'Mailbox connection failed. Check the IONOS server and mailbox credentials.'});}
    await db.query('INSERT INTO users(id) VALUES ($1) ON CONFLICT (id) DO NOTHING',[owner]);
    const id=randomUUID();
    await db.query("INSERT INTO connections(id,owner_id,provider,display_name,secret_ciphertext,settings) VALUES ($1,$2,'ionos',$3,$4,$5)",[id,owner,connection.user,encryptSecret(connection,key),JSON.stringify({mailbox:connection.user,host:connection.host})]);
    return reply.code(201).send({id,provider:'ionos',displayName:connection.user,settings:{mailbox:connection.user,host:connection.host}});
  });
}
