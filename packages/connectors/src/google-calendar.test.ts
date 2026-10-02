import { describe,expect,it,vi } from 'vitest';
import { GoogleCalendarConnector } from './google-calendar.js';

describe('Google Calendar connector',()=>{
  it('lists writable calendars and creates an event with a stable id',async()=>{
    const calls:{url:string;init?:RequestInit}[]=[];
    const fetcher=vi.fn(async (url:string,init?:RequestInit)=>{ calls.push({url,init}); if(url.includes('calendarList')) return new Response(JSON.stringify({items:[{id:'primary',summary:'My calendar',accessRole:'owner'},{id:'shared',summary:'Shared',accessRole:'reader'}]}),{status:200}); return new Response(JSON.stringify({id:'event123',htmlLink:'https://calendar.google.com/event?eid=abc'}),{status:200}); });
    const connector=new GoogleCalendarConnector(fetcher as typeof fetch);
    expect(await connector.listDestinations({accessToken:'token'})).toEqual([{id:'primary',name:'My calendar',canWrite:true},{id:'shared',name:'Shared',canWrite:false}]);
    const command={action:'calendar.create' as const,calendarId:'primary',summary:'Demo',start:'2026-10-01T10:00:00+03:00',end:'2026-10-01T11:00:00+03:00',timeZone:'Europe/Istanbul'};
    expect((await connector.execute({accessToken:'token'},command,'task-1')).status).toBe('succeeded');
    expect(calls[1].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[1].init?.body)).id).toMatch(/^[0-9a-f]+$/);
  });
  it('rejects invalid times and revoked access',async()=>{
    const connector=new GoogleCalendarConnector(vi.fn(async()=>new Response('unauthorized',{status:401})) as typeof fetch);
    expect(()=>connector.validate({action:'calendar.create',calendarId:'primary',summary:'X',start:'Friday',end:'later',timeZone:'UTC'})).toThrow();
    await expect(connector.listDestinations({accessToken:'revoked'})).rejects.toThrow('Google Calendar access failed');
  });
  it('updates an explicit event and recovers a duplicate create by its stable id',async()=>{
    const mock=vi.fn(async (_url:string,init?:RequestInit)=>new Response(JSON.stringify({id:'existing',htmlLink:'https://calendar.google.com/event?eid=existing'}),{status:init?.method==='POST' ? 409:200}));
    const connector=new GoogleCalendarConnector(mock as typeof fetch);
    const command={action:'calendar.create' as const,calendarId:'primary',summary:'Demo',start:'2026-10-01T10:00:00+03:00',end:'2026-10-01T11:00:00+03:00',timeZone:'Europe/Istanbul'};
    expect((await connector.execute({accessToken:'token'},command,'stable-task')).externalId).toBe('existing');
    expect(mock).toHaveBeenCalledTimes(2);
    await connector.execute({accessToken:'token'},{...command,action:'calendar.update',eventId:'existing'},'update-task');
    expect(mock.mock.calls[2][1]?.method).toBe('PATCH');
  });

  it('deletes one event only through DELETE on that exact event, and reports a missing event as nothing changed',async()=>{
    const calls:{url:string;method?:string}[]=[];
    const ok=new GoogleCalendarConnector((async (url:string,init?:RequestInit)=>{calls.push({url,method:init?.method});return new Response(null,{status:204});}) as typeof fetch);
    expect(await ok.delete({accessToken:'t'},{calendarId:'me@example.com',eventId:'abc123'})).toEqual({status:'succeeded',externalId:'abc123'});
    expect(calls).toEqual([{url:'https://www.googleapis.com/calendar/v3/calendars/me%40example.com/events/abc123?sendUpdates=none',method:'DELETE'}]);
    const gone=new GoogleCalendarConnector((async ()=>new Response(null,{status:410})) as typeof fetch);
    expect(await gone.delete({accessToken:'t'},{calendarId:'primary',eventId:'x'})).toMatchObject({status:'failed',error:expect.stringContaining('Nothing was changed')});
    const denied=new GoogleCalendarConnector((async ()=>new Response(null,{status:403})) as typeof fetch);
    expect(await denied.delete({accessToken:'t'},{calendarId:'primary',eventId:'x'})).toEqual({status:'failed',error:'Google Calendar returned 403'});
    await expect(ok.delete({accessToken:'t'},{calendarId:'primary',eventId:''})).rejects.toThrow('Event ID required');
    await expect(ok.delete({accessToken:'t'},{calendarId:'primary',eventId:'a/b'})).rejects.toThrow('Event ID required');
  });
});
