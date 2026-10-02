import { describe, expect, it } from 'vitest';
import { clampDay, dayLabel, dayOf, minutesBetween, parseCalendarLookups, safeZone, timeOf, zonedInstant } from './lookups.js';

describe('calendar lookups from the model', () => {
  it('keeps valid calendar lookups and ignores other kinds and invalid ones', () => {
    const lookups = parseCalendarLookups([
      { type: 'calendar.agenda', from: '2026-10-03' },
      { type: 'calendar.free', date: '2026-10-03', startTime: '14:00', endTime: '17:00', minutes: 30 },
      { type: 'calendar.next' },
      { type: 'search', project: 'SFT' },
      { type: 'calendar.agenda', from: 'tomorrow' },
      { type: 'calendar.delete', id: 'x' },
      { type: 'calendar.free', date: '2026-10-03', startTime: '25:00' },
      { type: 'calendar.free', date: '2026-10-03', minutes: 2 },
    ]);
    expect(lookups.map(l => l.type)).toEqual(['calendar.agenda', 'calendar.free', 'calendar.next']);
    expect(parseCalendarLookups('nope')).toEqual([]);
  });

  it('knows nothing about writing: no create, update or delete lookup exists', () => {
    for (const type of ['calendar.create', 'calendar.update', 'calendar.delete', 'calendar.invite']) expect(parseCalendarLookups([{ type, from: '2026-10-03' }])).toEqual([]);
  });
});

describe('days and times in the user\'s own time zone', () => {
  it('finds the instant a local time happens, including offsets and daylight saving', () => {
    expect(zonedInstant('2026-10-03', '00:00', 'Europe/Istanbul')).toBe('2026-10-02T21:00:00.000Z');
    expect(zonedInstant('2026-10-03', '10:30', 'UTC')).toBe('2026-10-03T10:30:00.000Z');
    // London is on summer time until 25 October 2026, then on winter time.
    expect(zonedInstant('2026-10-24', '09:00', 'Europe/London')).toBe('2026-10-24T08:00:00.000Z');
    expect(zonedInstant('2026-10-26', '09:00', 'Europe/London')).toBe('2026-10-26T09:00:00.000Z');
    expect(zonedInstant('2026-03-08', '12:00', 'America/New_York')).toBe('2026-03-08T16:00:00.000Z');
  });

  it('shows an instant as the local day and time, and labels days', () => {
    expect(dayOf('2026-10-02T22:30:00Z', 'Europe/Istanbul')).toBe('2026-10-03');
    expect(dayOf('2026-10-02T22:30:00Z', 'America/Los_Angeles')).toBe('2026-10-02');
    expect(timeOf('2026-10-03T07:00:00Z', 'Europe/Istanbul')).toBe('10:00');
    expect(dayLabel('2026-10-03')).toBe('Sat 3 Oct');
    expect(minutesBetween('2026-10-03T10:00:00Z', '2026-10-03T11:30:00Z')).toBe(90);
    expect(safeZone('Not/AZone')).toBe('UTC');
    expect(safeZone('Europe/London')).toBe('Europe/London');
  });

  it('keeps dates within 31 days of today and says so', () => {
    const notes: string[] = [];
    expect(clampDay('2026-10-10', '2026-10-02', notes)).toBe('2026-10-10');
    expect(clampDay('2025-01-01', '2026-10-02', notes)).toBe('2026-09-01');
    expect(clampDay('2027-06-01', '2026-10-02', notes)).toBe('2026-11-02');
    expect(clampDay('2026-02-31', '2026-10-02', notes)).toBeUndefined();
    expect(notes.length).toBe(3);
    expect(notes[0]).toContain('31 days back');
    expect(notes[1]).toContain('31 days ahead');
  });
});
