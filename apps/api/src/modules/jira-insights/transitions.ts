import { JiraReadError, type JiraConnection, type JiraIssueBrief, type JiraTransitionOption } from '@kian/connectors';
import type { TaskProposal } from '@kian/contracts';
import { short, withReview } from '../tasks/review.js';

export type TransitionReader = {
  brief(connection: JiraConnection, key: string): Promise<JiraIssueBrief>;
  transitions(connection: JiraConnection, key: string): Promise<JiraTransitionOption[]>;
};
/** What Jira says about one proposed status change. `ok` is false when the card must not be approvable, with the reason in plain words. */
export type TransitionCheck = { ok: true; title: string; from: string; to: string; projectKey: string } | { ok: false; reason: string };
export type TransitionChecker = (ownerId: string, issueKey: string, toStatus: string) => Promise<TransitionCheck | null>;

const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d{1,7}$/;
export const MAX_TRANSITIONS_PER_MESSAGE = 20;

/**
 * Decides whether a status change can be offered for approval: the issue must exist and be in the project selected in
 * Settings, must not already be in that status, and Jira must offer the move for it right now. Read-only.
 */
export async function checkTransition(reader: TransitionReader, connection: JiraConnection, selectedProject: string | null, issueKey: string, toStatus: string): Promise<TransitionCheck> {
  if (!selectedProject) return { ok: false, reason: 'Choose the Jira project under Settings first (open it from your profile at the top right), then ask again. Kian only changes issues in the selected project.' };
  if (!ISSUE_KEY.test(issueKey)) return { ok: false, reason: 'Which issue should I move? I need its key, like SFT-123.' };
  if (!toStatus.trim()) return { ok: false, reason: 'Which status should it move to?' };
  try {
    const issue = await reader.brief(connection, issueKey);
    if (issue.projectKey !== selectedProject) return { ok: false, reason: `${issueKey} is in project ${issue.projectKey}, but the project selected in Settings is ${selectedProject}. Kian only changes issues in the selected project.` };
    const wanted = toStatus.trim().toLowerCase();
    if (issue.status.toLowerCase() === wanted) return { ok: false, reason: `${issueKey} is already ${issue.status}.` };
    const options = await reader.transitions(connection, issueKey);
    const match = options.find(o => o.to.toLowerCase() === wanted) ?? options.find(o => o.name.toLowerCase() === wanted);
    if (!match) return { ok: false, reason: `Jira does not allow moving ${issueKey} from ${issue.status} to ${toStatus} right now. Available: ${[...new Set(options.map(o => o.to))].join(', ') || 'none'}.` };
    return { ok: true, title: issue.summary, from: issue.status, to: match.to, projectKey: issue.projectKey };
  } catch (error) {
    if (error instanceof JiraReadError) return { ok: false, reason: error.code === 'failed' || error.code === 'bad-query' ? `Jira could not find or open ${issueKey}.` : error.message };
    return { ok: false, reason: 'Jira could not be reached to check this move. Try again in a moment.' };
  }
}

/**
 * Fills in what Jira says on each status-change proposal (current status, title, exact status name, project) or adds the
 * reason it cannot be approved. Other proposals pass through untouched. Checks run a few at a time.
 */
export async function prepareTransitions(check: TransitionChecker | undefined, ownerId: string, tasks: TaskProposal[], defaultProject: string | null): Promise<TaskProposal[]> {
  const out = [...tasks];
  const seen = new Set<string>();
  const work: { index: number; key: string; to: string }[] = [];
  tasks.forEach((task, index) => {
    if (task.action !== 'jira.transition') return;
    let key = String(task.parameters.issueKey ?? '').trim().toUpperCase();
    if (/^\d{1,7}$/.test(key) && defaultProject) key = `${defaultProject}-${key}`;
    const to = String(task.parameters.toStatus ?? '').trim();
    out[index] = { ...task, parameters: { ...task.parameters, issueKey: key, toStatus: to } };
    if (seen.has(key)) { out[index] = { ...out[index], uncertainties: [...task.uncertainties, `${key} appears more than once in this request. Reject this card or the other one.`] }; return; }
    seen.add(key);
    work.push({ index, key, to });
  });
  for (let i = 0; i < work.length; i += 5) {
    await Promise.all(work.slice(i, i + 5).map(async ({ index, key, to }) => {
      const task = out[index];
      const result = check ? await check(ownerId, key, to) : null;
      if (!result) out[index] = { ...task, uncertainties: [...task.uncertainties, 'Jira is not connected. Connect it under Settings first.'] };
      else if (!result.ok) out[index] = { ...task, uncertainties: [...task.uncertainties, result.reason] };
      else out[index] = { ...task, destination: result.projectKey, parameters: withReview({ ...task.parameters, issueKey: key, toStatus: result.to, fromStatus: result.from, issueTitle: result.title }, { matched: `${key} "${short(result.title, 60)}" exists in Jira project ${result.projectKey} (the project chosen in Settings), and Jira allows this move right now.`, changes: [{ field: 'Status', before: result.from, after: result.to }] }) };
    }));
  }
  return out;
}
