import { z } from 'zod';
import { addDays, validDate } from '../jira-insights/lookups.js';

export const CAL_LIMITS = { windowDays: 31, tableRows: 50, digestRows: 40, detailEvents: 5, nextEvents: 5, events: 200 } as const;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const name = z.string().trim().min(1).max(80);

/** What the model may ask of the calendar. Reading only; the server turns these into Google requests. */
export const CalendarLookupSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('calendar.agenda'), from: date, to: date.optional(), calendar: name.optional(), text: z.string().trim().min(1).max(100).optional(), details: z.boolean().optional() }),
  z.object({ type: z.literal('calendar.free'), date, startTime: clock.optional(), endTime: clock.optional(), minutes: z.number().int().min(5).max(480).optional(), calendar: name.optional() }),
  z.object({ type: z.literal('calendar.next'), calendar: name.optional(), text: z.string().trim().min(1).max(100).optional() }),
]);
export type CalendarLookup = z.infer<typeof CalendarLookupSchema>;

/** Picks the calendar lookups out of the model's list (the Jira ones are parsed elsewhere) and drops anything invalid. */
export function parseCalendarLookups(raw: unknown): CalendarLookup[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 10).flatMap(value => {
    if (!value || typeof value !== 'object' || typeof (value as { type?: unknown }).type !== 'string' || !(value as { type: string }).type.startsWith('calendar.')) return [];
    const parsed = CalendarLookupSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
}

// --- time zones (done with Intl so daylight saving is right) ---
export const validZone = (timeZone: string) => { try { new Intl.DateTimeFormat('en-GB', { timeZone }); return true; } catch { return false; } };
export const safeZone = (timeZone: string) => (validZone(timeZone) ? timeZone : 'UTC');

function offsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find(p => p.type === type)!.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - utcMs;
}

/** The instant (as an ISO string in UTC) at which it is `time` on `day` in `timeZone`. */
export function zonedInstant(day: string, time: string, timeZone: string): string {
  const [y, m, d] = day.split('-').map(Number), [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = guess - offsetMs(guess, timeZone);
  return new Date(guess - offsetMs(first, timeZone)).toISOString();
}

export const dayOf = (iso: string, timeZone: string) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
export const timeOf = (iso: string, timeZone: string) => new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
export const dayLabel = (day: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${day}T12:00:00Z`));
export const minutesBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 60000);

/** Keeps a date within 31 days either side of today and says so when it moves it. */
export function clampDay(value: string | undefined, today: string, notes: string[]): string | undefined {
  if (!value) return undefined;
  if (!validDate(value)) { notes.push(`I ignored a date I could not read: ${value.slice(0, 20)}.`); return undefined; }
  const earliest = addDays(today, -CAL_LIMITS.windowDays), latest = addDays(today, CAL_LIMITS.windowDays);
  if (value < earliest) { notes.push(`I can look ${CAL_LIMITS.windowDays} days back at most, so I started from ${earliest}.`); return earliest; }
  if (value > latest) { notes.push(`I can look ${CAL_LIMITS.windowDays} days ahead at most, so I stopped at ${latest}.`); return latest; }
  return value;
}
