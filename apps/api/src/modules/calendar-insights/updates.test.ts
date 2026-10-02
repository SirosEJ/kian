import { describe, expect, it } from 'vitest';
import type { TaskProposal } from '@kian/contracts';
import type { CalendarLookupPort, EventCheck } from '../conversations/service.js';
import { prepareUpdates } from './updates.js';

const found: EventCheck = { ok: true, calendarId: 'me@example.com', title: 'Planning', when: 'Sat 3 Oct 10:00–10:30', start: '2026-10-03T10:00:00+01:00', end: '2026-10-03T10:30:00+01:00', recurring: false };
const port = (check?: CalendarLookupPort['checkEvent']): CalendarLookupPort => ({ info: async () => ({ connected: true }), run: async () => null, checkEvent: check });
const update = (parameters: Record<string, unknown>, id = 'u1'): TaskProposal => ({ id, action: 'calendar.update', connectionId: null, destination: null, parameters, uncertainties: [], state: 'proposed' });
const review = (t: TaskProposal) => t.parameters._review as { matched: string; changes: { field: string; before: string; after: string }[] };

describe('calendar update cards', () => {
  it('shows only what really changes, with the title and time as they are now', async () => {
    const [task] = await prepareUpdates(port(async () => found), 'alice', [update({ eventId: 'abc', summary: 'Planning v2', start: '2026-10-03T16:00:00+01:00', end: '2026-10-03T16:30:00+01:00' })], 'Europe/London');
    expect(task.uncertainties).toEqual([]);
    expect(task.destination).toBe('me@example.com');
    expect(review(task).changes).toEqual([{ field: 'Title', before: 'Planning', after: 'Planning v2' }, { field: 'When', before: 'Sat 3 Oct 10:00–10:30', after: 'Sat 3 Oct 16:00–16:30' }]);
    expect(review(task).matched).toContain('Planning');
    expect(review(task).matched).toContain('Google confirmed it still exists');
  });

  it('keeps the end time when only the start moves, and skips fields that are already right', async () => {
    const [task] = await prepareUpdates(port(async () => found), 'alice', [update({ eventId: 'abc', summary: 'Planning', start: '2026-10-03T11:00:00+01:00' })], 'Europe/London');
    expect(review(task).changes).toEqual([{ field: 'When', before: 'Sat 3 Oct 10:00–10:30', after: 'Sat 3 Oct 11:00–10:30' }]);
  });

  it('blocks approval when nothing would change, the event is missing, cancelled or the id is blank', async () => {
    const same = await prepareUpdates(port(async () => found), 'alice', [update({ eventId: 'abc', summary: 'Planning' })], 'Europe/London');
    expect(same[0].uncertainties.join(' ')).toMatch(/Nothing would change/);
    const gone = await prepareUpdates(port(async () => ({ ok: false as const, reason: 'I could not find that event in your calendar. Ask me to look it up again.' })), 'alice', [update({ eventId: 'abc', summary: 'x' })], 'UTC');
    expect(gone[0].uncertainties.join(' ')).toMatch(/could not find that event/);
    const blank = await prepareUpdates(port(async () => found), 'alice', [update({ summary: 'x' })], 'UTC');
    expect(blank[0].uncertainties.join(' ')).toMatch(/Which event/);
    const none = await prepareUpdates(port(async () => null), 'alice', [update({ eventId: 'abc', summary: 'x' })], 'UTC');
    expect(none[0].uncertainties.join(' ')).toMatch(/not connected/);
    const noPort = await prepareUpdates(undefined, 'alice', [update({ eventId: 'abc', summary: 'x' })], 'UTC');
    expect(noPort[0].uncertainties.join(' ')).toMatch(/not connected/);
  });

  it('says a repeating event changes one occurrence, flags the same event named twice, and leaves other actions alone', async () => {
    const tasks = await prepareUpdates(port(async () => ({ ...found, recurring: true })), 'alice', [update({ eventId: 'abc', summary: 'A' }, 'a'), update({ eventId: 'abc', summary: 'B' }, 'b'), { ...update({}, 'c'), action: 'calendar.create' }], 'UTC');
    expect(tasks[0].parameters.scope).toMatch(/Only this occurrence/);
    expect(tasks[1].uncertainties.join(' ')).toMatch(/more than once/);
    expect(tasks[2].parameters._review).toBeUndefined();
  });

  it('checks the event with the asking user\'s own id', async () => {
    const seen: string[] = [];
    await prepareUpdates(port(async owner => { seen.push(owner); return found; }), 'alice', [update({ eventId: 'abc', summary: 'x' })], 'UTC');
    expect(seen).toEqual(['alice']);
  });
});
