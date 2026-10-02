import { actionNames } from '../trust/wording.js';

export type BatchTask = { id: string; action: string; state: string; version?: number; uncertainties: string[]; connectionId?: string | null; destination: string | null };

/** A card can be approved in a batch only when it could be approved on its own: undecided, no open question, an account and a destination. */
export const eligibleForBatch = (task: BatchTask) => task.state === 'proposed' && task.uncertainties.length === 0 && Boolean(task.connectionId) && Boolean(task.destination);

/** "12 Change Jira status": what the confirmation lists, so nobody approves a batch without seeing what is in it. */
export function describeBatch(tasks: BatchTask[]): string {
  const counts = new Map<string, number>();
  for (const t of tasks) counts.set(actionNames[t.action] ?? t.action, (counts.get(actionNames[t.action] ?? t.action) ?? 0) + 1);
  return [...counts.entries()].map(([name, n]) => `${n} × ${name}`).join(', ');
}

export type BatchOutcome = { approved: BatchTask[]; skipped: { task: BatchTask; reason: string }[] };

/**
 * Approves each task on its own, one after the other, through the same decision as the card's own Approve button
 * (so each keeps its version check, its Activity entry and its own result). A card that changed or was already decided
 * is skipped, never forced; a failure on one does not stop the rest.
 */
export async function approveBatch(tasks: BatchTask[], decide: (task: BatchTask) => Promise<BatchTask>): Promise<BatchOutcome> {
  const outcome: BatchOutcome = { approved: [], skipped: [] };
  for (const task of tasks.filter(eligibleForBatch)) {
    try { outcome.approved.push(await decide(task)); }
    catch (error) {
      const failure = error as { status?: number; message?: string };
      outcome.skipped.push({ task, reason: failure.status === 409 ? 'it changed or was already decided' : failure.status === 422 && failure.message ? failure.message : 'it could not be saved' });
    }
  }
  return outcome;
}

export function batchSummary(total: number, outcome: BatchOutcome): string {
  const skipped = outcome.skipped.length;
  if (!skipped) return `Approved ${outcome.approved.length} of ${total}. Each one is queued and will appear in Activity.`;
  return `Approved ${outcome.approved.length} of ${total}. Skipped ${skipped}: ${[...new Set(outcome.skipped.map(s => s.reason))].join('; ')}.`;
}
