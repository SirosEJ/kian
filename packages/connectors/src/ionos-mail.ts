import { createHash } from 'node:crypto';
import nodemailer from 'nodemailer';
import type { Connector,ExecutionResult } from '@kian/contracts';

export type IonosConnection={host:string;user:string;password:string};
export type EmailCommand={action:'email.send';to:string[];subject:string;body:string};
type Message={from:string;to:string[];subject:string;text:string;messageId:string};
export type MailTransport={verify:()=>Promise<unknown>;sendMail:(message:Message)=>Promise<{accepted?:unknown[];rejected?:unknown[];messageId?:string}>;close:()=>void};
type Factory=(connection:IonosConnection)=>MailTransport;
const address=/^[^\s<>@,;\r\n]+@[^\s<>@,;\r\n]+\.[^\s<>@,;\r\n]+$/;
export type MailFailureReason='auth'|'host'|'tls'|'timeout'|'unknown';
export class MailConnectionError extends Error {constructor(readonly reason:MailFailureReason){super(`Mailbox connection failed: ${reason}`);}}
function classify(raw:unknown):MailFailureReason {
  const error=raw as {code?:string;message?:string;responseCode?:number};
  const text=`${error.code||''} ${error.message||''}`;
  if(error.code==='EAUTH' || error.responseCode===535) return 'auth';
  if(/CERT|TLS|SSL|ALTNAME/i.test(text)) return 'tls';
  if(/ENOTFOUND|ECONNREFUSED|EDNS|EAI_AGAIN/.test(text)) return 'host';
  if(/TIMEDOUT|ETIMEOUT|ESOCKET|ECONNRESET/.test(text)) return 'timeout';
  return 'unknown';
}
const hosts=['smtp.ionos.co.uk','smtp.ionos.com','smtp.ionos.de'];
const transport:Factory=connection=>nodemailer.createTransport({host:connection.host,port:465,secure:true,auth:{user:connection.user,pass:connection.password},tls:{minVersion:'TLSv1.2'},connectionTimeout:15000,greetingTimeout:15000,socketTimeout:30000,logger:false,debug:false});

export class IonosMailConnector implements Connector<IonosConnection,EmailCommand> {
  constructor(private readonly makeTransport:Factory=transport) {}
  async connect(input:unknown):Promise<IonosConnection> {
    const value=input as IonosConnection;
    if(!value || !hosts.includes(value.host) || !address.test(value.user) || typeof value.password!=='string' || !value.password) throw new Error('Valid IONOS server, mailbox and password required');
    const result=await this.diagnose(value);
    if(!result.ok) throw new MailConnectionError(result.reason);
    return value;
  }
  async diagnose(connection:IonosConnection):Promise<{ok:true}|{ok:false;reason:MailFailureReason}> {
    const mail=this.makeTransport(connection);
    try {await mail.verify();return {ok:true};} catch(raw) {return {ok:false,reason:classify(raw)};} finally {mail.close();}
  }
  async test(connection:IonosConnection) {return (await this.diagnose(connection)).ok;}
  async listDestinations(_connection:IonosConnection) {return [];}
  validate(command:EmailCommand) {
    if(!Array.isArray(command.to) || !command.to.length || command.to.length>20 || command.to.some(to=>typeof to!=='string' || !address.test(to))) throw new Error('Every recipient needs an exact email address');
    if(typeof command.subject!=='string' || !command.subject.trim() || command.subject.length>500 || /[\r\n]/.test(command.subject)) throw new Error('Valid email subject required');
    if(typeof command.body!=='string' || !command.body.trim() || command.body.length>100000) throw new Error('Email body required');
  }
  async execute(connection:IonosConnection,command:EmailCommand,idempotencyKey:string):Promise<ExecutionResult> {
    this.validate(command);
    const mail=this.makeTransport(connection),messageId=`<${createHash('sha256').update(idempotencyKey).digest('hex')}@${connection.user.split('@')[1]}>`;
    try {
      const result=await mail.sendMail({from:connection.user,to:command.to,subject:command.subject,text:command.body,messageId});
      if(result.rejected?.length || result.accepted?.length!==command.to.length) return {status:'uncertain',externalId:result.messageId || messageId,error:'Some recipients may have received this message. Check the mailbox before sending again.'};
      return {status:'succeeded',externalId:result.messageId || messageId};
    } catch(raw) {
      const error=raw as {code?:string;command?:string};
      const beforeSend=error.code==='EAUTH' || ['CONN','AUTH LOGIN','AUTH PLAIN','MAIL FROM','RCPT TO'].includes(error.command || '');
      return beforeSend ? {status:'failed',error:'Email was not sent. Check mailbox access and recipient details.'} : {status:'uncertain',externalId:messageId,error:'The mail server outcome is uncertain. Check the mailbox before sending again.'};
    } finally {mail.close();}
  }
  async disconnect(_connection:IonosConnection) {}
}
