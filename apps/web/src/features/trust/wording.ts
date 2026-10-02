// Plain-language wording for approvals, trust and the activity log, kept in one place so the screens never disagree.
export const actionNames: Record<string, string> = { 'email.send': 'Send email', 'calendar.create': 'Create calendar event', 'calendar.update': 'Update calendar event', 'calendar.delete': 'Delete calendar event', 'jira.create': 'Create Jira issue', 'jira.update': 'Update Jira issue', 'jira.transition': 'Change Jira status' };

const phrases: Record<string, (destination: string) => string> = {
  'email.send': destination => `send email to ${destination}`,
  'calendar.create': destination => `create events in calendar ${destination}`,
  'jira.create': destination => `create issues in Jira project ${destination}`,
};
const phrase = (action: string, destination: string) => (phrases[action] ?? (() => `${(actionNames[action] ?? action).toLowerCase()} for ${destination}`))(destination);
const using = (connectionName?: string | null) => (connectionName ? ` using ${connectionName}` : '');
const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** What ticking the trust box means, in the user's terms: exactly which action, where, and how to undo it. */
export function trustPrompt(action: string, destination: string, connectionName?: string | null): string {
  return `Always do this without asking: ${phrase(action, destination)}${using(connectionName)}. A different recipient, calendar or project always asks you first. You can stop it any time in Settings.`;
}

/** Why a task cannot be trusted, when the box is off. */
export function trustUnavailable(action: string): string | null {
  return action.endsWith('.update') || action === 'jira.transition' || action === 'calendar.delete' ? 'Changes to existing items always need your approval.' : null;
}

export function ruleSentence(rule: { action: string; constraints: { destinations: string[] }; connection_name?: string | null }): string {
  return capitalise(phrase(rule.action, rule.constraints.destinations.join(', '))) + using(rule.connection_name);
}

const eventLabels: Record<string, string> = {
  'task.approved': 'Approved by you',
  'task.rejected': 'Rejected by you',
  'task.edited': 'You edited the details, so any earlier approval no longer applies',
  'task.trusted': 'Started automatically because it matches a trusted action',
  'task.replaced': 'Replaced by your later message in the conversation, so it was never approved or run',
  'jira.lookup': 'Kian read from Jira to answer you (nothing was changed)',
  'calendar.lookup': 'Kian read your Google Calendar to answer you (nothing was changed)',
  'memory.learned': 'Kian remembered new names (you can see and delete them in Settings)',
  'task.succeeded': 'Done',
  'task.failed': 'Failed, nothing was changed',
  'task.uncertain': 'Outcome unknown: check the result yourself before trying again',
};
export function eventLabel(event: string): string {
  return eventLabels[event] ?? event.replace('task.', '').replaceAll('.', ' ');
}

export function activityTitle(action?: string | null, destination?: string | null, event?: string): string {
  if (event === 'jira.lookup') return 'Jira lookup';
  if (event === 'calendar.lookup') return 'Calendar lookup';
  if (event === 'memory.learned') return 'Kian learned';
  const name = action ? (actionNames[action] ?? action) : 'Task';
  return destination ? `${name} to ${destination}` : name;
}

/** What to tell the user when saving a decision failed: the server's own reason for a refusal (422), otherwise a generic hint. */
export function decisionError(error: unknown): string {
  const failure = error as { status?: number; message?: string };
  return failure.status === 422 && failure.message ? failure.message : 'Decision could not be saved. Refresh and review this task again.';
}
