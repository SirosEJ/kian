import type { TaskProposal } from '@kian/contracts';
import type { CalendarLookupPort } from '../conversations/service.js';
import { short, withReview } from '../tasks/review.js';

/**
 * A delete card is built from Google's own record of the event, never from the model's words: the title, time and calendar the
 * user sees are the ones the delete will act on. An event that cannot be found, is already cancelled, or is named twice
 * gets an open question, which blocks approval.
 */
export async function prepareDeletes(port: CalendarLookupPort | undefined, ownerId: string, tasks: TaskProposal[], timeZone: string): Promise<TaskProposal[]> {
  const out = [...tasks];
  const seen = new Set<string>();
  const work: { index: number; eventId: string }[] = [];
  tasks.forEach((task, index) => {
    if (task.action !== 'calendar.delete') return;
    const eventId = String(task.parameters.eventId ?? '').trim();
    out[index] = { ...task, parameters: { ...task.parameters, eventId } };
    if (!eventId) { out[index] = { ...out[index], uncertainties: [...task.uncertainties, 'Which event should I delete? Ask me to look it up first.'] }; return; }
    if (seen.has(eventId)) { out[index] = { ...out[index], uncertainties: [...task.uncertainties, 'This event appears more than once in this request. Reject this card or the other one.'] }; return; }
    seen.add(eventId);
    work.push({ index, eventId });
  });
  for (let i = 0; i < work.length; i += 5) {
    await Promise.all(work.slice(i, i + 5).map(async ({ index, eventId }) => {
      const task = out[index];
      const result = port?.checkEvent ? await port.checkEvent(ownerId, eventId, timeZone) : null;
      if (!result) out[index] = { ...task, uncertainties: [...task.uncertainties, 'Google Calendar is not connected. Connect it under Settings first.'] };
      else if (!result.ok) out[index] = { ...task, uncertainties: [...task.uncertainties, result.reason] };
      else out[index] = { ...task, destination: result.calendarId, parameters: withReview({ eventId, summary: result.title, when: result.when, start: result.start, end: result.end, ...(result.recurring ? { scope: 'Only this occurrence is deleted, not the whole series.' } : {}) }, { matched: `The event "${short(result.title, 60)}" in your calendar, found by the id from an agenda Kian showed you. Google confirmed it still exists.`, changes: [{ field: 'Event', before: `${short(result.title, 60)}, ${result.when}`, after: 'Deleted' }] }) };
    }));
  }
  return out;
}
