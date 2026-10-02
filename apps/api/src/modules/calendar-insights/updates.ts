import type { TaskProposal } from '@kian/contracts';
import type { CalendarLookupPort } from '../conversations/service.js';
import { dayLabel, dayOf, safeZone, timeOf } from './lookups.js';
import { short, withReview, type ReviewChange } from '../tasks/review.js';

const when = (iso: string, zone: string) => `${dayLabel(dayOf(iso, zone))} ${timeOf(iso, zone)}`;

/**
 * An event change is checked against Google first: the event must exist and not be cancelled, and the card shows the title and
 * time it has now next to what it will become (only the fields that really change). Open questions block approval.
 */
export async function prepareUpdates(port: CalendarLookupPort | undefined, ownerId: string, tasks: TaskProposal[], timeZone: string): Promise<TaskProposal[]> {
  const out = [...tasks];
  const seen = new Set<string>();
  const work: { index: number; eventId: string }[] = [];
  tasks.forEach((task, index) => {
    if (task.action !== 'calendar.update') return;
    const eventId = String(task.parameters.eventId ?? '').trim();
    out[index] = { ...task, parameters: { ...task.parameters, eventId } };
    if (!eventId) { out[index] = { ...out[index], uncertainties: [...task.uncertainties, 'Which event should I change? Ask me to look it up first.'] }; return; }
    if (seen.has(eventId)) { out[index] = { ...out[index], uncertainties: [...task.uncertainties, 'This event appears more than once in this request. Reject this card or the other one.'] }; return; }
    seen.add(eventId);
    work.push({ index, eventId });
  });
  const zone = safeZone(timeZone);
  for (let i = 0; i < work.length; i += 5) {
    await Promise.all(work.slice(i, i + 5).map(async ({ index, eventId }) => {
      const task = out[index];
      const result = port?.checkEvent ? await port.checkEvent(ownerId, eventId, timeZone) : null;
      if (!result) { out[index] = { ...task, uncertainties: [...task.uncertainties, 'Google Calendar is not connected. Connect it under Settings first.'] }; return; }
      if (!result.ok) { out[index] = { ...task, uncertainties: [...task.uncertainties, result.reason] }; return; }
      const p = task.parameters;
      const changes: ReviewChange[] = [];
      if (typeof p.summary === 'string' && p.summary.trim() && p.summary.trim() !== result.title) changes.push({ field: 'Title', before: short(result.title), after: short(p.summary) });
      const startChanged = typeof p.start === 'string' && Date.parse(p.start) !== Date.parse(result.start);
      const endChanged = typeof p.end === 'string' && Date.parse(p.end) !== Date.parse(result.end);
      if ((startChanged || endChanged) && !Number.isNaN(Date.parse(String(p.start ?? result.start)))) {
        const start = String(p.start ?? result.start), end = String(p.end ?? result.end);
        changes.push({ field: 'When', before: `${when(result.start, zone)}–${timeOf(result.end, zone)}`, after: `${when(start, zone)}–${timeOf(end, zone)}` });
      }
      if (typeof p.description === 'string' && p.description.trim()) changes.push({ field: 'Description', before: 'Not shown', after: short(p.description) });
      const uncertainties = changes.length ? task.uncertainties : [...task.uncertainties, `Nothing would change: "${short(result.title, 60)}" already has these details. Tell me what to change.`];
      out[index] = { ...task, destination: result.calendarId, uncertainties, parameters: withReview({ ...p, ...(result.recurring ? { scope: 'Only this occurrence changes, not the whole series.' } : {}) }, { matched: `The event "${short(result.title, 60)}" (${result.when}) in your calendar, found by the id from an agenda Kian showed you. Google confirmed it still exists.`, changes }) };
    }));
  }
  return out;
}
