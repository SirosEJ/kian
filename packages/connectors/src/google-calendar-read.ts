import type { GoogleConnection } from './google-calendar.js';

/** One event as the lookups see it. No description and no attendee addresses: those stay behind an explicit request. */
export type CalendarEventRow = {
  id: string; title: string; start: string; end: string; allDay: boolean; location: string | null; link: string | null;
  status: 'confirmed' | 'tentative' | 'cancelled'; myResponse: 'accepted' | 'declined' | 'tentative' | 'needsAction' | null;
  attendeeCount: number; busy: boolean;
};
export type CalendarEventDetail = CalendarEventRow & { description: string; attendees: { name: string; email: string; response: string }[] };
/** `selected` is whether the calendar is shown in the person's Google Calendar list; `role` is their access (owner, writer, reader, freeBusyReader). */
export type CalendarInfo = { id: string; name: string; primary: boolean; selected?: boolean; role?: string };
export type CalendarEventsResult = { events: CalendarEventRow[]; truncated: boolean };

const MAX_TEXT = 500;
const FIELDS = 'items(id,status,summary,start,end,location,htmlLink,transparency,attendees(self,responseStatus)),nextPageToken';
const DETAIL_FIELDS = 'items(id,status,summary,start,end,location,htmlLink,transparency,description,attendees(self,responseStatus,displayName,email)),nextPageToken';

export class CalendarReadError extends Error {
  constructor(readonly code: 'expired' | 'forbidden' | 'rate-limited' | 'not-found' | 'failed', message: string) { super(message); }
}

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

function toRow(item: any): CalendarEventRow {
  const allDay = Boolean(item.start?.date && !item.start?.dateTime);
  const attendees = Array.isArray(item.attendees) ? item.attendees : [];
  const me = attendees.find((a: any) => a?.self);
  return {
    id: String(item.id), title: text(item.summary, 200) || '(No title)', start: String(item.start?.dateTime ?? item.start?.date ?? ''), end: String(item.end?.dateTime ?? item.end?.date ?? ''), allDay,
    location: text(item.location, 200) || null, link: typeof item.htmlLink === 'string' && item.htmlLink.startsWith('https://') ? item.htmlLink : null,
    status: item.status === 'cancelled' ? 'cancelled' : item.status === 'tentative' ? 'tentative' : 'confirmed',
    myResponse: me && ['accepted', 'declined', 'tentative', 'needsAction'].includes(me.responseStatus) ? me.responseStatus : null,
    attendeeCount: attendees.length, busy: item.transparency !== 'transparent',
  };
}

/**
 * Read-only access to a user's Google Calendar with their own token. Every request is a GET: there is deliberately no way
 * to write through this class, and its tests check that.
 */
export class GoogleCalendarReader {
  constructor(private readonly request: typeof fetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20000) })) {}

  private async get(connection: GoogleConnection, path: string, query: Record<string, string> = {}): Promise<any> {
    const url = new URL(`https://www.googleapis.com/calendar/v3/${path}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const response = await this.request(url.toString(), { method: 'GET', headers: { Authorization: `Bearer ${connection.accessToken}`, Accept: 'application/json' } });
    if (response.status === 401) throw new CalendarReadError('expired', 'Google access expired. Reconnect Google Calendar in Settings.');
    if (response.status === 403) throw new CalendarReadError('forbidden', 'Google did not allow that. Check the calendar sharing and permissions.');
    if (response.status === 404) throw new CalendarReadError('not-found', 'Google could not find that calendar.');
    if (response.status === 429) throw new CalendarReadError('rate-limited', 'Google is limiting requests right now. Try again in a minute.');
    if (!response.ok) throw new CalendarReadError('failed', `Google Calendar did not answer (${response.status}).`);
    return response.json();
  }

  async calendars(connection: GoogleConnection): Promise<CalendarInfo[]> {
    const body = await this.get(connection, 'users/me/calendarList', { maxResults: '250', fields: 'items(id,summary,summaryOverride,primary,selected,accessRole)' });
    return ((body.items ?? []) as any[]).map(c => ({ id: String(c.id), name: text(c.summaryOverride ?? c.summary, 100) || String(c.id), primary: Boolean(c.primary), selected: c.selected === undefined ? undefined : Boolean(c.selected), ...(typeof c.accessRole === 'string' ? { role: c.accessRole } : {}) }));
  }

  /** Real occurrences (recurring events expanded) between two instants, in start order. `details` also returns descriptions and attendee names, only when asked. */
  async events(connection: GoogleConnection, calendarId: string, timeMin: string, timeMax: string, options: { q?: string; max?: number } = {}): Promise<CalendarEventsResult> {
    const max = options.max ?? 200;
    const events: CalendarEventRow[] = [];
    let token: string | undefined;
    for (let page = 0; page < 10 && events.length < max; page++) {
      const body = await this.get(connection, `calendars/${encodeURIComponent(calendarId)}/events`, {
        singleEvents: 'true', orderBy: 'startTime', timeMin, timeMax, maxResults: String(Math.min(250, max - events.length)), fields: FIELDS, ...(options.q ? { q: options.q } : {}), ...(token ? { pageToken: token } : {}),
      });
      for (const item of body.items ?? []) events.push(toRow(item));
      token = body.nextPageToken;
      if (!token) return { events: events.slice(0, max), truncated: false };
    }
    return { events: events.slice(0, max), truncated: Boolean(token) };
  }

  /** One event by id (the exact one a delete would remove), without description or attendee addresses. */
  async event(connection: GoogleConnection, calendarId: string, eventId: string): Promise<CalendarEventRow & { recurring: boolean }> {
    const item = await this.get(connection, `calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { fields: 'id,status,summary,start,end,location,htmlLink,transparency,recurringEventId,attendees(self,responseStatus)' });
    return { ...toRow(item), recurring: typeof item.recurringEventId === 'string' };
  }

  /** Events matching words, with their description (cut short) and attendee names and addresses: used only when the user asks about specific events. */
  async details(connection: GoogleConnection, calendarId: string, timeMin: string, timeMax: string, q: string, max = 5): Promise<CalendarEventDetail[]> {
    const body = await this.get(connection, `calendars/${encodeURIComponent(calendarId)}/events`, { singleEvents: 'true', orderBy: 'startTime', timeMin, timeMax, maxResults: String(max), q, fields: DETAIL_FIELDS });
    return ((body.items ?? []) as any[]).map(item => ({
      ...toRow(item), description: text(item.description, MAX_TEXT),
      attendees: ((item.attendees ?? []) as any[]).slice(0, 10).map(a => ({ name: text(a.displayName, 80), email: text(a.email, 120), response: String(a.responseStatus ?? '') })),
    }));
  }
}
