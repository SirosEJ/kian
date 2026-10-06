import { CalendarReadError, type CalendarEventDetail, type CalendarEventRow, type CalendarEventsResult, type CalendarInfo, type GoogleConnection } from '@kian/connectors';
import type { LookupOutcome, ResultTable } from '../jira-insights/insights.js';
import { addDays } from '../jira-insights/lookups.js';
import { CAL_LIMITS, clampDay, dayLabel, dayOf, minutesBetween, timeOf, zonedInstant, type CalendarLookup } from './lookups.js';

export type CalendarReader = {
  event(connection: GoogleConnection, calendarId: string, eventId: string): Promise<CalendarEventRow & { recurring: boolean }>;
  events(connection: GoogleConnection, calendarId: string, timeMin: string, timeMax: string, options?: { q?: string; max?: number }): Promise<CalendarEventsResult>;
  details(connection: GoogleConnection, calendarId: string, timeMin: string, timeMax: string, q: string, max?: number): Promise<CalendarEventDetail[]>;
  calendars(connection: GoogleConnection): Promise<CalendarInfo[]>;
};
export type CalendarConnection = GoogleConnection & { calendarId: string };
export type CalendarContext = { today: string; timeZone: string; now: Date };

const MAX_CALENDARS = 8;
/** Calendars that hold no meetings: public holidays, birthdays from contacts, weather and week numbers. */
const NOT_EVENTS = /#holiday@|#contacts@|addressbook#|#weather@|#weeknum@/i;

/** An event that is really on the user's calendar: not cancelled and not declined. */
const live = (e: CalendarEventRow) => e.status !== 'cancelled' && e.myResponse !== 'declined';
const YOU: Record<string, string> = { accepted: 'Accepted', tentative: 'Maybe', needsAction: 'Not answered' };

function when(e: CalendarEventRow, timeZone: string): { day: string; time: string } {
  if (e.allDay) return { day: e.start.slice(0, 10), time: 'All day' };
  const day = dayOf(e.start, timeZone), endDay = dayOf(e.end, timeZone);
  return { day, time: endDay === day ? `${timeOf(e.start, timeZone)}–${timeOf(e.end, timeZone)}` : `${timeOf(e.start, timeZone)} → ${dayLabel(endDay).split(' ')[0]} ${timeOf(e.end, timeZone)}` };
}

/** An event read from one of the person's calendars. `readOnly` events are on a calendar other than the one chosen in Settings: they can be shown but not targeted by a delete or an update. */
type Seen = CalendarEventRow & { readOnly?: boolean; calendar?: string };

function eventTable(title: string, events: Seen[], timeZone: string, note?: string, showCalendar = false): ResultTable {
  const shown = events.slice(0, CAL_LIMITS.tableRows), extra = events.length - shown.length;
  return {
    title, columns: ['Day', 'Time', 'Event', 'Where', 'Invited', 'You', ...(showCalendar ? ['Calendar'] : [])],
    rows: shown.map(e => { const w = when(e, timeZone); return [dayLabel(w.day), w.time, e.title, e.location ?? '', e.attendeeCount > 1 ? String(e.attendeeCount) : '', e.myResponse ? YOU[e.myResponse] ?? '' : '', ...(showCalendar ? [e.calendar ?? ''] : [])]; }),
    links: shown.map(e => e.link),
    // No reference for an event on another calendar: Kian cannot delete or change it, so it must not look targetable.
    refs: shown.map(e => (e.readOnly ? '' : e.id)),
    note: [note, extra > 0 ? `${extra} more not shown: narrow the question to see them.` : ''].filter(Boolean).join(' ') || undefined,
  };
}
const compact = (e: Seen, timeZone: string) => { const w = when(e, timeZone); return { day: w.day, time: w.time, title: e.title.slice(0, 120), location: e.location, invited: e.attendeeCount > 1 ? e.attendeeCount : 0, you: e.myResponse, tentative: e.status === 'tentative', ...(e.calendar ? { calendar: e.calendar } : {}), ...(e.readOnly ? { readOnly: true } : {}) }; };

/**
 * Runs the calendar lookups the model asked for, with the user's own read-only Google connection. It only reads, never throws for a
 * Google problem (it becomes a note), and hands back tables built from the real events. Event text is untrusted data.
 */
export function createCalendarInsights(reader: CalendarReader) {
  // What is learned (calendar names the user mentioned, attendee names they asked about) goes on the outcome of each run: never addresses, event titles or descriptions, and never shared between runs.
  type Cal = { id: string; name: string; own: boolean };
  const isOwn = (conn: CalendarConnection, c: CalendarInfo) => c.id === conn.calendarId || (conn.calendarId === 'primary' && c.primary);
  async function resolve(conn: CalendarConnection, name: string | undefined, out: LookupOutcome): Promise<Cal> {
    const notes = out.notes;
    if (!name) return { id: conn.calendarId, name: 'your calendar', own: true };
    const calendars = await reader.calendars(conn);
    const wanted = name.trim().toLowerCase();
    const found = calendars.find(c => c.name.toLowerCase() === wanted || c.id.toLowerCase() === wanted) ?? calendars.find(c => c.name.toLowerCase().includes(wanted));
    if (found) { (out.learned ??= []).push({ kind: 'calendar', value: found.name, detail: 'Google Calendar' }); return { id: found.id, name: found.name, own: isOwn(conn, found) }; }
    notes.push(`I could not find a calendar called "${name}", so I used your selected calendar.`);
    return { id: conn.calendarId, name: 'your calendar', own: true };
  }

  /**
   * Which calendars a question reads. A calendar the person named: just that one. Otherwise every calendar shown in their Google
   * Calendar list (a work calendar, a team calendar), not only the one chosen in Settings: up to 8, without holidays, birthdays and
   * calendars that only share busy time. The calendar chosen in Settings is always included and first.
   */
  async function calendarsToRead(conn: CalendarConnection, name: string | undefined, out: LookupOutcome): Promise<Cal[]> {
    if (name) return [await resolve(conn, name, out)];
    let list: CalendarInfo[] = [];
    try { list = await reader.calendars(conn); } catch { /* the chosen calendar is still read below */ }
    const usable = list.filter(c => c.selected !== false && c.role !== 'freeBusyReader' && !NOT_EVENTS.test(c.id));
    const cals: Cal[] = usable.map(c => ({ id: c.id, name: c.name, own: isOwn(conn, c) }));
    if (!cals.some(c => c.own)) cals.unshift({ id: conn.calendarId, name: list.find(c => isOwn(conn, c))?.name ?? 'your calendar', own: true });
    cals.sort((a, b) => Number(b.own) - Number(a.own));
    return cals.slice(0, MAX_CALENDARS);
  }

  /** Events from all those calendars merged by start time, the same meeting on two calendars shown once. One calendar that cannot be read is a note, not a failure. */
  async function readEvents(conn: CalendarConnection, cals: Cal[], min: string, max: string, options: { q?: string; max?: number }, out: LookupOutcome): Promise<{ events: Seen[]; truncated: boolean }> {
    const settled = await Promise.allSettled(cals.map(c => reader.events(conn, c.id, min, max, options)));
    const merged: Seen[] = [], seen = new Set<string>();
    let truncated = false, failure: unknown;
    settled.forEach((r, i) => {
      if (r.status === 'rejected') { failure ??= r.reason; if (cals.length > 1) out.notes.push(`I could not read the calendar "${cals[i].name}".`); return; }
      truncated ||= r.value.truncated;
      for (const e of r.value.events) {
        const key = `${e.title}|${e.start}|${e.end}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push({ ...e, readOnly: !cals[i].own, ...(cals.length > 1 ? { calendar: cals[i].name } : {}) });
      }
    });
    if (failure && settled.every(r => r.status === 'rejected')) throw failure;
    merged.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    return { events: merged.slice(0, options.max ?? 200), truncated };
  }
  const searchedNote = (cals: Cal[], shown: Seen[]) => [cals.length > 1 ? `Searched calendars: ${cals.map(c => c.name).join(', ')}.` : '', shown.some(e => e.readOnly) ? 'Events on calendars other than the one chosen in Settings can be read here but not changed.' : ''].filter(Boolean).join(' ');

  async function one(conn: CalendarConnection, lookup: CalendarLookup, ctx: CalendarContext, out: LookupOutcome) {
    const { timeZone } = ctx;
    if (lookup.type === 'calendar.agenda') {
      const from = clampDay(lookup.from, ctx.today, out.notes) ?? ctx.today;
      const to = clampDay(lookup.to, ctx.today, out.notes) ?? from;
      const last = to < from ? from : to;
      const cals = await calendarsToRead(conn, lookup.calendar, out);
      const min = zonedInstant(from, '00:00', timeZone), max = zonedInstant(addDays(last, 1), '00:00', timeZone);
      const result = await readEvents(conn, cals, min, max, { q: lookup.text, max: CAL_LIMITS.events }, out);
      out.issuesRead += result.events.length;
      const shown = result.events.filter(live), declined = result.events.filter(e => e.status !== 'cancelled' && e.myResponse === 'declined').length;
      const note = [declined ? `${declined} declined event${declined === 1 ? '' : 's'} not shown.` : '', result.truncated ? `More than ${CAL_LIMITS.events} events matched.` : '', searchedNote(cals, shown)].filter(Boolean).join(' ');
      out.tables.push(eventTable(from === last ? `Agenda, ${dayLabel(from)}` : `Agenda, ${dayLabel(from)} to ${dayLabel(last)}`, shown, timeZone, note, cals.length > 1));
      const entry: Record<string, unknown> = { type: 'calendar.agenda', from, to: last, count: shown.length, declinedHidden: declined, moreExist: result.truncated, calendarsSearched: cals.map(c => c.name), events: shown.slice(0, CAL_LIMITS.digestRows).map(e => compact(e, timeZone)) };
      if (lookup.details && lookup.text) {
        // The event asked about may be on any of the searched calendars: the first that has a match answers.
        let details: CalendarEventDetail[] = [];
        for (const c of cals) { details = await reader.details(conn, c.id, min, max, lookup.text, CAL_LIMITS.detailEvents).catch(() => []); if (details.length) break; }
        for (const d of details) for (const a of d.attendees) if (a.name) (out.learned ??= []).push({ kind: 'person', value: a.name, detail: 'Calendar attendee' });
        entry.details = details.map(d => ({ title: d.title, day: when(d, timeZone).day, time: when(d, timeZone).time, description: d.description, attendees: d.attendees }));
      }
      out.digest.push(entry);
    } else if (lookup.type === 'calendar.free') {
      const day = clampDay(lookup.date, ctx.today, out.notes) ?? ctx.today;
      const startTime = lookup.startTime ?? '09:00', endTime = lookup.endTime ?? '18:00';
      const cals = await calendarsToRead(conn, lookup.calendar, out);
      const ws = zonedInstant(day, startTime, timeZone), we = zonedInstant(day, endTime, timeZone);
      if (Date.parse(we) <= Date.parse(ws)) { out.notes.push('The end of that window is not after its start, so I could not check it.'); out.digest.push({ type: 'calendar.free', error: 'invalid window' }); return; }
      const result = await readEvents(conn, cals, ws, we, { max: CAL_LIMITS.events }, out);
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
      const cals = await calendarsToRead(conn, lookup.calendar, out);
      const from = ctx.now.toISOString(), to = new Date(ctx.now.getTime() + CAL_LIMITS.windowDays * 86400000).toISOString();
      const result = await readEvents(conn, cals, from, to, { q: lookup.text, max: 30 }, out);
      out.issuesRead += result.events.length;
      const upcoming = result.events.filter(e => live(e) && (e.allDay || Date.parse(e.end) > ctx.now.getTime())).slice(0, CAL_LIMITS.nextEvents);
      out.tables.push(eventTable('Next events', upcoming, timeZone, [upcoming.length ? '' : `Nothing is coming up in the next ${CAL_LIMITS.windowDays} days.`, searchedNote(cals, upcoming)].filter(Boolean).join(' ') || undefined, cals.length > 1));
      out.digest.push({ type: 'calendar.next', count: upcoming.length, calendarsSearched: cals.map(c => c.name), events: upcoming.map(e => compact(e, timeZone)) });
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
