import { createHash } from 'node:crypto';
import nodemailer from 'nodemailer';
import type { Connector,ExecutionResult } from '@kian/contracts';
import { ALLOWED_MAIL_PORTS,presetById,type MailSecurity } from './mail-presets.js';
import { resolvePublicMailHost,systemResolver,UnsafeMailHost,type Resolver } from './mail-safety.js';

/** A mailbox Kian sends from. Rows saved before presets existed have only host, user and password (an IONOS mailbox on port 465). */
export type MailConnection={host:string;user:string;password:string;port?:number;security?:MailSecurity;preset?:string};
export type IonosConnection=MailConnection;
export type EmailCommand={action:'email.send';to:string[];subject:string;body:string};
type Message={from:string;to:string[];subject:string;text:string;messageId:string};
export type MailTransport={verify:()=>Promise<unknown>;sendMail:(message:Message)=>Promise<{accepted?:unknown[];rejected?:unknown[];messageId?:string}>;close:()=>void};
/** `target` is the address to connect to and the name to verify the certificate against (custom servers are connected by checked address). */
export type MailTarget={host:string;servername:string;port:number;security:MailSecurity};
type Factory=(connection:MailConnection,target:MailTarget)=>MailTransport;
const address=/^[^\s<>@,;\r\n]+@[^\s<>@,;\r\n]+\.[^\s<>@,;\r\n]+$/;
export type MailFailureReason='auth'|'app-password'|'basic-auth-disabled'|'host'|'blocked'|'input'|'tls'|'timeout'|'unknown';
export class MailConnectionError extends Error {constructor(readonly reason:MailFailureReason){super(`Mailbox connection failed: ${reason}`);}}
function classify(raw:unknown):MailFailureReason {
  const error=raw as {code?:string;message?:string;response?:string;responseCode?:number};
  const text=`${error.code||''} ${error.message||''} ${error.response||''}`;
  if(/5\.7\.139|5\.7\.30|basic authentication is disabled|SmtpClientAuthentication is disabled|authentication.*(?:disabled|not enabled)/i.test(text)) return 'basic-auth-disabled';
  if(/5\.7\.9\b|application-specific password|app(?:lication)? password|less secure app/i.test(text)) return 'app-password';
  if(error.code==='EAUTH' || error.responseCode===535 || error.responseCode===534) return 'auth';
  if(/CERT|TLS|SSL|ALTNAME/i.test(text)) return 'tls';
  if(/ENOTFOUND|ECONNREFUSED|EDNS|EAI_AGAIN/.test(text)) return 'host';
  if(/TIMEDOUT|ETIMEOUT|ESOCKET|ECONNRESET/.test(text)) return 'timeout';
  return 'unknown';
}
const IONOS_HOSTS=['smtp.ionos.co.uk','smtp.ionos.com','smtp.ionos.de'];
const transport:Factory=(connection,target)=>nodemailer.createTransport({host:target.host,port:target.port,secure:target.security==='ssl',requireTLS:target.security==='starttls',auth:{user:connection.user,pass:connection.password},tls:{minVersion:'TLSv1.2',servername:target.servername},connectionTimeout:15000,greetingTimeout:15000,socketTimeout:30000,logger:false,debug:false}) as unknown as MailTransport;

/** What a stored or submitted connection means: the server, port and security Kian will use, never taken on trust from a preset's id alone. */
export function settingsOf(input:unknown):{host:string;port:number;security:MailSecurity;preset:string;custom:boolean} {
  const value=input as MailConnection|null;
  if(!value || typeof value!=='object') throw new MailConnectionError('input');
  const preset=presetById(value.preset);
  if(preset && preset.host) return {host:preset.host,port:preset.port,security:preset.security,preset:preset.id,custom:false};
  if(preset?.id==='other' || (value.preset==='other')) {
    const host=typeof value.host==='string' ? value.host.trim().toLowerCase() : '';
    const port=Number(value.port),security=value.security;
    if(!host || !(ALLOWED_MAIL_PORTS as readonly number[]).includes(port) || (security!=='ssl' && security!=='starttls')) throw new MailConnectionError('input');
    // Port 465 is implicit TLS; the other mail ports must upgrade with STARTTLS. Nothing is ever sent unencrypted.
    if((port===465)!==(security==='ssl')) throw new MailConnectionError('input');
    return {host,port,security,preset:'other',custom:true};
  }
  // No preset: a mailbox saved before presets existed (or sent by the old IONOS form).
  if(typeof value.host==='string' && IONOS_HOSTS.includes(value.host)) return {host:value.host,port:465,security:'ssl',preset:'ionos',custom:false};
  throw new MailConnectionError('input');
}

export class MailConnector implements Connector<MailConnection,EmailCommand> {
  constructor(private readonly makeTransport:Factory=transport,private readonly resolve:Resolver=systemResolver) {}
  /** Works out where to connect. A custom server must resolve only to public addresses and is then connected by that address. */
  private async target(connection:MailConnection):Promise<MailTarget> {
    const s=settingsOf(connection);
    if(!s.custom) return {host:s.host,servername:s.host,port:s.port,security:s.security};
    try {return {host:await resolvePublicMailHost(s.host,this.resolve),servername:s.host,port:s.port,security:s.security};}
    catch(error) {throw new MailConnectionError(error instanceof UnsafeMailHost && error.why==='unresolved' ? 'host' : 'blocked');}
  }
  async connect(input:unknown):Promise<MailConnection> {
    const value=input as MailConnection;
    if(!value || !address.test(String(value.user)) || typeof value.password!=='string' || !value.password) throw new MailConnectionError('input');
    const s=settingsOf(value);
    const connection:MailConnection={host:s.host,user:value.user,password:value.password,port:s.port,security:s.security,preset:s.preset};
    const result=await this.diagnose(connection);
    if(!result.ok) throw new MailConnectionError(result.reason);
    return connection;
  }
  async diagnose(connection:MailConnection):Promise<{ok:true}|{ok:false;reason:MailFailureReason}> {
    let target:MailTarget;
    try {target=await this.target(connection);} catch(error) {return {ok:false,reason:error instanceof MailConnectionError ? error.reason : 'unknown'};}
    const mail=this.makeTransport(connection,target);
    try {await mail.verify();return {ok:true};} catch(raw) {return {ok:false,reason:classify(raw)};} finally {mail.close();}
  }
  async test(connection:MailConnection) {return (await this.diagnose(connection)).ok;}
  async listDestinations(_connection:MailConnection) {return [];}
  validate(command:EmailCommand) {
    if(!Array.isArray(command.to) || !command.to.length || command.to.length>20 || command.to.some(to=>typeof to!=='string' || !address.test(to))) throw new Error('Every recipient needs an exact email address');
    if(typeof command.subject!=='string' || !command.subject.trim() || command.subject.length>500 || /[\r\n]/.test(command.subject)) throw new Error('Valid email subject required');
    if(typeof command.body!=='string' || !command.body.trim() || command.body.length>100000) throw new Error('Email body required');
  }
  async execute(connection:MailConnection,command:EmailCommand,idempotencyKey:string):Promise<ExecutionResult> {
    this.validate(command);
    let target:MailTarget;
    try {target=await this.target(connection);} catch {return {status:'failed',error:'Email was not sent. The mail server could not be reached or is not allowed. Check the mailbox in Settings.'};}
    const mail=this.makeTransport(connection,target),messageId=`<${createHash('sha256').update(idempotencyKey).digest('hex')}@${connection.user.split('@')[1]}>`;
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
  async disconnect(_connection:MailConnection) {}
}
/** The name used before presets existed; the same connector. */
export const IonosMailConnector=MailConnector;
