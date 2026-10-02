import { CalendarReadError, type CalendarEventDetail, type CalendarEventRow, type CalendarEventsResult, type CalendarInfo, type GoogleConnection } from '@kian/connectors';
import type { LookupOutcome, ResultTable } from '../jira-insights/insights.js';
import { addDays } from '../jira-insights/lookups.js';
import { CAL_LIMITS, clampDay, dayLabel, dayOf, minutesBetween, timeOf, zonedInstant, type CalendarLookup } from './lookups.js';

export type CalendarReader = {
  events(connection: GoogleConnection, calendarId: string, timeMin: string, timeMax: string, options?: { q?: string; max?: number }): Promise<CalendarEventsResult>;
  details(connection: GoogleConnection, calendarId: string, timeMin: string, timeMax: string, q: string, max?: number): Promise<CalendarEventDetail[]>;
  calendars(connection: GoogleConnection): Promise<CalendarInfo[]>;
};
export type CalendarConnection = GoogleConnection & { calendarId: string };
export type CalendarContext = { today: string; timeZone: string; now: Date };

/** An event that is really on the user's calendar: not cancelled and not declined. */
const live = (e: CalendarEventRow) => e.status !== 'cancelled' && e.myResponse !== 'declined';
const YOU: Record<string, string> = { accepted: 'Accepted', tentative: 'Maybe', needsAction: 'Not answered' };

function when(e: CalendarEventRow, timeZone: string): { day: string; time: string } {
  if (e.allDay) return { day: e.start.slice(0, 10), time: 'All day' };
  const day = dayOf(e.start, timeZone), endDay = dayOf(e.end, timeZone);
  return { day, time: endDay === day ? `${timeOf(e.start, timeZone)}–${timeOf(e.end, timeZone)}` : `${timeOf(e.start, timeZone)} → ${dayLabel(endDay).split(' ')[0]} ${timeOf(e.end, timeZone)}` };
}

function eventTable(title: string, events: CalendarEventRow[], timeZone: string, note?: string): ResultTable {
  const shown = events.slice(0, CAL_LIMITS.tableRows), extra = events.length - shown.length;
  return {
    title, columns: ['Day', 'Time', 'Event', 'Where', 'Invited', 'You'],
    rows: shown.map(e => { const w = when(e, timeZone); return [dayLabel(w.day), w.time, e.title, e.location ?? '', e.attendeeCount > 1 ? String(e.attendeeCount) : '', e.myResponse ? YOU[e.myResponse] ?? '' : '']; }),
    links: shown.map(e => e.link),
    note: [note, extra > 0 ? `${extra} more not shown: narrow the question to see them.` : ''].filter(Boolean).join(' ') || undefined,
  };
}
const compact = (e: CalendarEventRow, timeZone: string) => { const w = when(e, timeZone); return { day: w.day, time: w.time, title: e.title.slice(0, 120), location: e.location, invited: e.attendeeCount > 1 ? e.attendeeCount : 0, you: e.myResponse, tentative: e.status === 'tentative' }; };

/**
 * Runs the calendar lookups the model asked for, with the user's own read-only Google connection. It only reads, never throws for a
 * Google problem (it becomes a note), and hands back tables built from the real events. Event text is untrusted data.
 */
export function createCalendarInsights(reader: CalendarReader) {
  async function resolve(conn: CalendarConnection, name: string | undefined, notes: string[]): Promise<string> {
    if (!name) return conn.calendarId;
    const calendars = await reader.calendars(conn);
    const wanted = name.trim().toLowerCase();
    const found = calendars.find(c => c.name.toLowerCase() === wanted || c.id.toLowerCase() === wanted) ?? calendars.find(c => c.name.toLowerCase().includes(wanted));
    if (found) return found.id;
    notes.push(`I could not find a calendar called "${name}", so I used your selected calendar.`);
    return conn.calendarId;
  }

  async function one(conn: CalendarConnection, lookup: CalendarLookup, ctx: CalendarContext, out: LookupOutcome) {
    const { timeZone } = ctx;
    if (lookup.type === 'calendar.agenda') {
      const from = clampDay(lookup.from, ctx.today, out.notes) ?? ctx.today;
      const to = clampDay(lookup.to, ctx.today, out.notes) ?? from;
      const last = to < from ? from : to;
      const calendarId = await resolve(conn, lookup.calendar, out.notes);
      const min = zonedInstant(from, '00:00', timeZone), max = zonedInstant(addDays(last, 1), '00:00', timeZone);
      const result = await reader.events(conn, calendarId, min, max, { q: lookup.text, max: CAL_LIMITS.events });
      out.issuesRead += result.events.length;
      const shown = result.events.filter(live), declined = result.events.filter(e => e.status !== 'cancelled' && e.myResponse === 'declined').length;
      const note = [declined ? `${declined} declined event${declined === 1 ? '' : 's'} not shown.` : '', result.truncated ? `More than ${CAL_LIMITS.events} events matched.` : ''].filter(Boolean).join(' ');
      out.tables.push(eventTable(from === last ? `Agenda, ${dayLabel(from)}` : `Agenda, ${dayLabel(from)} to ${dayLabel(last)}`, shown, timeZone, note));
      const entry: Record<string, unknown> = { type: 'calendar.agenda', from, to: last, count: shown.length, declinedHidden: declined, moreExist: result.truncated, events: shown.slice(0, CAL_LIMITS.digestRows).map(e => compact(e, timeZone)) };
      if (lookup.details && lookup.text) {
        const details = await reader.details(conn, calendarId, min, max, lookup.text, CAL_LIMITS.detailEvents);
        entry.details = details.map(d => ({ title: d.title, day: when(d, timeZone).day, time: when(d, timeZone).time, description: d.description, attendees: d.attendees }));
      }
      out.digest.push(entry);
    } else if (lookup.type === 'calendar.free') {
      const day = clampDay(lookup.date, ctx.today, out.notes) ?? ctx.today;
      const startTime = lookup.startTime ?? '09:00', endTime = lookup.endTime ?? '18:00';
      const calendarId = await resolve(conn, lookup.calendar, out.notes);
      const ws = zonedInstant(day, startTime, timeZone), we = zonedInstant(day, endTime, timeZone);
      if (Date.parse(we) <= Date.parse(ws)) { out.notes.push('The end of that window is not after its start, so I could not check it.'); out.digest.push({ type: 'calendar.free', error: 'invalid window' }); return; }
      const result = await reader.events(conn, calendarId, ws, we, { max: CAL_LIMITS.events });
      out.issuesRead += result.events.length;
      const blocking = result.events.filter(e => live(e) && e.busy && !e.allDay);
      const allDay = result.events.filter(e => live(e) && e.allDay).map(e => e.title);
      // Busy blocks clipped to the window and merged; the free time is what is left.
      const busy: { from: string; to: string; titles: string[] }[] = [];
      for (const e of blocking) {
        const from = Date.parse(e.start) < Date.parse(ws) ? ws : e.start, to = Date.parse(e.end) > Date.parse(we) ? we : e.end;
        if (Date.parse(to) <= Date.parse(from)) continue;
        const last = busy[busy.length - 1];
        if (last && Date.parse(from) <= Date.parse(last.to)) { if (Date.parse(to) > Date.parse(last.to)) last.to = new Date(Date.parse(to)).toISOString(); last.titles.push(e.title); }
        else busy.push({ from: new Date(Date.parse(from)).toISOString(), to: new Date(Date.parse(to)).toISOString(), titles: [e.title] });
      }
      const free: { from: string; to: string }[] = [];
      let cursor = new Date(Date.parse(ws)).toISOString();
      for (const b of busy) { if (Date.parse(b.from) > Date.parse(cursor)) free.push({ from: cursor, to: b.from }); cursor = b.to; }
      if (Date.parse(cursor) < Date.parse(we)) free.push({ from: cursor, to: new Date(Date.parse(we)).toISOString() });
      const segments = [...busy.map(b => ({ kind: 'Busy', from: b.from, to: b.to, detail: [...new Set(b.titles)].join('; ') })), ...free.map(f => ({ kind: 'Free', from: f.from, to: f.to, detail: `${minutesBetween(f.from, f.to)} min` }))].sort((a, b) => Date.parse(a.from) - Date.parse(b.from));
      const longest = free.reduce((m, f) => Math.max(m, minutesBetween(f.from, f.to)), 0);
      const wanted = lookup.minutes;
      out.tables.push({ title: `Free and busy, ${dayLabel(day)} ${startTime}–${endTime}`, columns: ['Status', 'Time', 'Details'], rows: segments.map(s => [s.kind, `${timeOf(s.from, timeZone)}–${timeOf(s.to, timeZone)}`, s.detail]), links: segments.map(() => null), note: [allDay.length ? `All-day: ${allDay.join('; ')}.` : '', result.truncated ? 'The list was cut short.' : ''].filter(Boolean).join(' ') || undefined });
      out.digest.push({ type: 'calendar.free', day, window: `${startTime}-${endTime}`, busy: busy.map(b => ({ from: timeOf(b.from, timeZone), to: timeOf(b.to, timeZone), titles: [...new Set(b.titles)].slice(0, 5) })), free: free.map(f => ({ from: timeOf(f.from, timeZone), to: timeOf(f.to, timeZone), minutes: minutesBetween(f.from, f.to) })), allDayEvents: allDay.slice(0, 5), longestFreeMinutes: longest, ...(wanted ? { wantedMinutes: wanted, fits: longest >= wanted } : {}) });
    } else {
      const calendarId = await resolve(conn, lookup.calendar, out.notes);
      const from = ctx.now.toISOString(), to = new Date(ctx.now.getTime() + CAL_LIMITS.windowDays * 86400000).toISOString();
      const result = await reader.events(conn, calendarId, from, to, { q: lookup.text, max: 30 });
      out.issuesRead += result.events.length;
      const upcoming = result.events.filter(e => live(e) && (e.allDay || Date.parse(e.end) > ctx.now.getTime())).slice(0, CAL_LIMITS.nextEvents);
      out.tables.push(eventTable('Next events', upcoming, timeZone, upcoming.length ? undefined : `Nothing is coming up in the next ${CAL_LIMITS.windowDays} days.`));
      out.digest.push({ type: 'calendar.next', count: upcoming.length, events: upcoming.map(e => compact(e, timeZone)) });
    }
  }

  return {
    async run(conn: CalendarConnection, lookups: CalendarLookup[], ctx: CalendarContext): Promise<LookupOutcome> {
      const outcome: LookupOutcome = { tables: [], digest: [], issuesRead: 0, notes: [] };
      for (const lookup of lookups) {
        try { await one(conn, lookup, ctx, outcome); }
        catch (error) {
          const message = error instanceof CalendarReadError ? error.message : 'Google Calendar could not be reached.';
          outcome.notes.push(message);
          outcome.digest.push({ type: lookup.type, error: message });
        }
      }
      return outcome;
    },
  };
}
