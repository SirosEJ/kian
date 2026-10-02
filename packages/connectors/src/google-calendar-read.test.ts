import { describe, expect, it, vi } from 'vitest';
import { CalendarReadError, GoogleCalendarReader } from './google-calendar-read.js';

const connection = { accessToken: 'token' };
const item = (id: string, over: Record<string, unknown> = {}) => ({ id, status: 'confirmed', summary: `Event ${id}`, start: { dateTime: '2026-10-03T10:00:00+03:00' }, end: { dateTime: '2026-10-03T10:30:00+03:00' }, htmlLink: `https://www.google.com/calendar/event?eid=${id}`, ...over });

describe('Google Calendar read-only reader', () => {
  it('asks for real occurrences in start order and maps events to plain rows without descriptions or addresses', async () => {
    const urls: string[] = [];
    const request = vi.fn(async (url: string) => { urls.push(url); return Response.json({ items: [item('a', { location: 'Room 1', description: 'secret agenda', attendees: [{ self: true, responseStatus: 'accepted' }, { email: 'x@y.co', responseStatus: 'needsAction' }] })] }); });
    const result = await new GoogleCalendarReader(request as typeof fetch).events(connection, 'primary', '2026-10-03T00:00:00+03:00', '2026-10-04T00:00:00+03:00');
    const u = new URL(urls[0]);
    expect(u.pathname).toBe('/calendar/v3/calendars/primary/events');
    expect(u.searchParams.get('singleEvents')).toBe('true');
    expect(u.searchParams.get('orderBy')).toBe('startTime');
    expect(u.searchParams.get('timeMin')).toBe('2026-10-03T00:00:00+03:00');
    expect(result.events[0]).toEqual({ id: 'a', title: 'Event a', start: '2026-10-03T10:00:00+03:00', end: '2026-10-03T10:30:00+03:00', allDay: false, location: 'Room 1', link: 'https://www.google.com/calendar/event?eid=a', status: 'confirmed', myResponse: 'accepted', attendeeCount: 2, busy: true });
    expect(JSON.stringify(result)).not.toMatch(/secret agenda|x@y\.co/);
    expect(decodeURIComponent(u.searchParams.get('fields')!)).not.toMatch(/description|email|displayName/);
  });

  it('handles all-day, cancelled, transparent and untitled events', async () => {
    const request = vi.fn(async () => Response.json({ items: [item('d', { start: { date: '2026-10-03' }, end: { date: '2026-10-04' } }), item('c', { status: 'cancelled' }), item('t', { transparency: 'transparent' }), item('n', { summary: undefined })] }));
    const { events } = await new GoogleCalendarReader(request as typeof fetch).events(connection, 'primary', 'a', 'b');
    expect(events.map(e => [e.id, e.allDay, e.status, e.busy, e.title])).toEqual([['d', true, 'confirmed', true, 'Event d'], ['c', false, 'cancelled', true, 'Event c'], ['t', false, 'confirmed', false, 'Event t'], ['n', false, 'confirmed', true, '(No title)']]);
  });

  it('follows pages up to the maximum and says when the list was cut', async () => {
    const request = vi.fn(async () => Response.json({ items: [item('a'), item('b'), item('c')], nextPageToken: 'more' }));
    const result = await new GoogleCalendarReader(request as typeof fetch).events(connection, 'primary', 'a', 'b', { max: 2 });
    expect(result.events).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it('never trusts a link that is not https, and cuts very long text', async () => {
    const request = vi.fn(async () => Response.json({ items: [item('a', { htmlLink: 'javascript:alert(1)', summary: 'x'.repeat(900) })] }));
    const { events } = await new GoogleCalendarReader(request as typeof fetch).events(connection, 'primary', 'a', 'b');
    expect(events[0].link).toBeNull();
    expect(events[0].title.length).toBe(200);
  });

  it('returns descriptions and attendee names only through the explicit details call', async () => {
    const request = vi.fn(async (url: string) => Response.json({ items: [item('a', { description: 'Discuss  the   plan\n\nlater', attendees: [{ displayName: 'Sam', email: 'sam@example.com', responseStatus: 'accepted' }] })] }));
    const [detail] = await new GoogleCalendarReader(request as typeof fetch).details(connection, 'primary', 'a', 'b', 'plan');
    expect(detail.description).toBe('Discuss the plan later');
    expect(detail.attendees).toEqual([{ name: 'Sam', email: 'sam@example.com', response: 'accepted' }]);
  });

  it('lists the user\'s calendars by name', async () => {
    const request = vi.fn(async () => Response.json({ items: [{ id: 'me@x.com', summary: 'Me', primary: true }, { id: 'w@group', summary: 'Work', summaryOverride: 'Team calendar' }] }));
    expect(await new GoogleCalendarReader(request as typeof fetch).calendars(connection)).toEqual([{ id: 'me@x.com', name: 'Me', primary: true }, { id: 'w@group', name: 'Team calendar', primary: false }]);
  });

  it('only ever sends GET requests, so nothing can be written to the calendar through it', async () => {
    const methods: string[] = [];
    const request = vi.fn(async (_u: string, init?: RequestInit) => { methods.push(init?.method ?? 'GET'); return Response.json({ items: [] }); });
    const reader = new GoogleCalendarReader(request as typeof fetch);
    await reader.events(connection, 'primary', 'a', 'b'); await reader.details(connection, 'primary', 'a', 'b', 'q'); await reader.calendars(connection);
    expect(new Set(methods)).toEqual(new Set(['GET']));
  });

  it('turns Google refusals into plain errors without the token', async () => {
    for (const [status, code] of [[401, 'expired'], [403, 'forbidden'], [404, 'not-found'], [429, 'rate-limited'], [500, 'failed']] as const) {
      const error = await new GoogleCalendarReader((async () => new Response('', { status })) as typeof fetch).events(connection, 'primary', 'a', 'b').catch(e => e);
      expect(error, String(status)).toBeInstanceOf(CalendarReadError);
      expect(error.code).toBe(code);
      expect(error.message).not.toContain('token');
    }
  });
});
