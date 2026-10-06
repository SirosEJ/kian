import type { Queryable } from '@kian/db';
import { isMailProvider } from '../connections/provider-groups.js';
import { GoogleCalendarConnector,JiraConnector,MailConnector,type MailConnection,type CalendarCommand,type EmailCommand } from '@kian/connectors';
import { decryptSecret,getGoogleAccessToken,type GoogleConfig } from '../connections/routes.js';
import { getJiraConnection,type JiraConfig } from '../connections/jira-routes.js';
import type { Executor } from './runner.js';
import type { StoredProposal } from '../tasks/approval.js';

export function createProviderExecutor(db:Queryable,key:Buffer,google?:GoogleConfig,jira?:JiraConfig,mail:MailConnector=new MailConnector()):Executor {
  return async(owner,task,idempotencyKey)=>{
    const proposal=task.parameters as StoredProposal;
    if(!proposal.connectionId || !proposal.destination || proposal.uncertainties?.length) return {status:'failed',error:'A connection, destination and clarified task are required.'};
    const connection=(await db.query('SELECT provider,secret_ciphertext,settings FROM connections WHERE owner_id=$1 AND id=$2 AND disconnected_at IS NULL',[owner,proposal.connectionId])).rows[0];
    if(!connection) return {status:'failed',error:'Connection is unavailable. Reconnect in Settings.'};
    const p=proposal.fields;
    if(task.action.startsWith('calendar.')) {
      if(!google || connection.provider!=='google_calendar') return {status:'failed',error:'Google Calendar is not configured for this task.'};
      const adapter=new GoogleCalendarConnector(),token={accessToken:await getGoogleAccessToken(db,owner,proposal.connectionId,google)};
      if(!(await adapter.listDestinations(token)).some(c=>c.id===proposal.destination && c.canWrite)) return {status:'failed',error:'The approved calendar is no longer writable.'};
      if(task.action==='calendar.delete') {
        const eventId=typeof p.eventId==='string' ? p.eventId.trim():'';
        if(!eventId) return {status:'failed',error:'Check which event should be deleted.'};
        return adapter.delete(token,{calendarId:proposal.destination,eventId});
      }
      const command={action:task.action,calendarId:proposal.destination,summary:p.summary,start:p.start,end:p.end,timeZone:p.timeZone,eventId:p.eventId,description:p.description} as CalendarCommand;
      try {adapter.validate(command);} catch {return {status:'failed',error:'Check the event title, exact start/end times and time zone.'};}
      return adapter.execute(token,command,idempotencyKey);
    }
    if(task.action.startsWith('jira.')) {
      if(!jira || connection.provider!=='jira') return {status:'failed',error:'Jira is not configured for this task.'};
      if(!p._jiraSiteId || p._jiraSiteId!==connection.settings.siteId || (task.action!=='jira.transition' && !p.issueTypeId)) return {status:'failed',error:'Jira mapping changed or is incomplete. Edit and review this task again.'};
      const adapter=new JiraConnector(),authorized=await getJiraConnection(db,owner,proposal.connectionId,jira);
      if(authorized.siteId!==p._jiraSiteId) return {status:'failed',error:'Jira site changed. Edit and review this task again.'};
      await adapter.connect(authorized);
      if(task.action==='jira.transition') {
        const move={action:'jira.transition' as const,projectKey:proposal.destination,issueKey:String(p.issueKey ?? ''),toStatus:String(p.toStatus ?? '')};
        try {adapter.validate(move);} catch {return {status:'failed',error:'Check the issue key and the status to move it to. The issue must be in the project selected in Settings.'};}
        return adapter.execute(authorized,move,idempotencyKey);
      }
      const fields=typeof p.fields==='object' && p.fields!==null && !Array.isArray(p.fields) ? {...p.fields as Record<string,unknown>}:{};
      if(p.summary!==undefined) fields.summary=p.summary;
      if(p.description!==undefined) fields.description=p.description;
      const command={action:task.action as 'jira.create'|'jira.update',projectKey:proposal.destination,issueTypeId:String(p.issueTypeId),issueKey:typeof p.issueKey==='string' ? p.issueKey:undefined,fields};
      try {adapter.validate(command);} catch {return {status:'failed',error:'Check the selected Jira project, issue type, summary and issue key.'};}
      return adapter.execute(authorized,command,idempotencyKey);
    }
    if(task.action==='email.send') {
      if(!isMailProvider(connection.provider)) return {status:'failed',error:'Select one of your connected mailboxes for this email.'};
      const adapter=mail,command={action:'email.send',to:p.to,subject:p.subject,body:p.body} as EmailCommand;
      try {adapter.validate(command);} catch {return {status:'failed',error:'Check exact recipient addresses, subject and message body.'};}
      const mailbox=decryptSecret<MailConnection>(connection.secret_ciphertext,key);
      return adapter.execute(mailbox,command,idempotencyKey);
    }
    return {status:'failed',error:'Unsupported action'};
  };
}
