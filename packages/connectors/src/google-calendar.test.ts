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
});
