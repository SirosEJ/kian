import { createHash } from 'node:crypto';
import type { Connector, Destination, ExecutionResult } from '@kian/contracts';

export type GoogleConnection = { accessToken:string };
export type CalendarCommand = { action:'calendar.create'|'calendar.update'; calendarId:string; summary:string; start:string; end:string; timeZone:string; eventId?:string; description?:string };

export class GoogleCalendarConnector implements Connector<GoogleConnection,CalendarCommand> {
  constructor(private readonly request: typeof fetch = (input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(30000)})) {}
  async connect(input:unknown): Promise<GoogleConnection> {
    if (!input || typeof input !== 'object' || !('accessToken' in input) || typeof input.accessToken !== 'string') throw new Error('Google authorization required');
    return { accessToken:input.accessToken };
  }
  async test(connection:GoogleConnection) { try { await this.listDestinations(connection); return true; } catch { return false; } }
  async listDestinations(connection:GoogleConnection): Promise<Destination[]> {
    const response = await this.request('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250', { headers:{Authorization:`Bearer ${connection.accessToken}`} });
    if (!response.ok) throw new Error('Google Calendar access failed');
    const body = await response.json() as {items?:{id:string;summary?:string;accessRole:string}[]};
    return (body.items || []).map(item=>({id:item.id,name:item.summary || item.id,canWrite:['writer','owner'].includes(item.accessRole)}));
  }
  validate(command:CalendarCommand) {
    if (!command.calendarId || !command.summary?.trim() || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/.test(command.start) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/.test(command.end) || !Number.isFinite(Date.parse(command.start)) || !Number.isFinite(Date.parse(command.end)) || Date.parse(command.end) <= Date.parse(command.start)) throw new Error('Valid event title and start/end times required');
    try { new Intl.DateTimeFormat('en-US',{timeZone:command.timeZone}); } catch { throw new Error('Invalid time zone'); }
    if (command.action === 'calendar.update' && !command.eventId) throw new Error('Event ID required');
  }
  async execute(connection:GoogleConnection,command:CalendarCommand,idempotencyKey:string): Promise<ExecutionResult> {
    this.validate(command);
    const calendar = encodeURIComponent(command.calendarId);
    const id = command.action === 'calendar.create' ? createHash('sha256').update(idempotencyKey).digest('hex').slice(0,32) : command.eventId!;
    const url = `https://www.googleapis.com/calendar/v3/calendars/${calendar}/events${command.action === 'calendar.update' ? `/${encodeURIComponent(id)}` : ''}`;
    const response = await this.request(url,{method:command.action === 'calendar.create' ? 'POST':'PATCH',headers:{Authorization:`Bearer ${connection.accessToken}`,'Content-Type':'application/json'},body:JSON.stringify({ ...(command.action === 'calendar.create' ? {id}:{}),summary:command.summary,description:command.description,start:{dateTime:command.start,timeZone:command.timeZone},end:{dateTime:command.end,timeZone:command.timeZone} })});
    if (response.status === 409 && command.action === 'calendar.create') {
      const existing = await this.request(`${url}/${id}`,{headers:{Authorization:`Bearer ${connection.accessToken}`}});
      if (existing.ok) { const event = await existing.json() as {id:string;htmlLink?:string}; return {status:'succeeded',externalId:event.id,link:event.htmlLink}; }
    }
    if (!response.ok) return {status:'failed',error:`Google Calendar returned ${response.status}`};
    const event = await response.json() as {id:string;htmlLink?:string};
    return {status:'succeeded',externalId:event.id,link:event.htmlLink};
  }
  async disconnect(_connection:GoogleConnection) { /* The API clears stored credentials and revokes trust rules. */ }
}
