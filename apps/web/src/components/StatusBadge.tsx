export type TaskState = 'proposed' | 'approved' | 'queued' | 'executing' | 'succeeded' | 'failed' | 'rejected' | 'uncertain' | 'replaced';
type Tone = 'info' | 'warning' | 'success' | 'error' | 'neutral';

const states: Record<TaskState, { label: string; tone: Tone }> = {
  proposed: { label: 'Needs review', tone: 'info' },
  approved: { label: 'Approved', tone: 'warning' },
  queued: { label: 'Queued', tone: 'warning' },
  executing: { label: 'Running', tone: 'warning' },
  succeeded: { label: 'Done', tone: 'success' },
  failed: { label: 'Failed', tone: 'error' },
  rejected: { label: 'Rejected', tone: 'neutral' },
  uncertain: { label: 'Check needed', tone: 'warning' },
  replaced: { label: 'Replaced', tone: 'neutral' },
};

/** A small pill showing where a task is. The words carry the meaning; the colour only reinforces it. */
export function StatusBadge({ state }: { state: string }) {
  const known = states[state as TaskState] ?? { label: state, tone: 'neutral' as Tone };
  return <span className={`badge badge-${known.tone}`} data-state={state}>{known.label}</span>;
}
