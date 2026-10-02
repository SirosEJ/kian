import type { TaskProposal } from '@kian/contracts';
import { JiraReadError, type JiraConnection, type JiraIssueBrief } from '@kian/connectors';
import { short, withReview, type ReviewChange } from '../tasks/review.js';

/** What Jira says about one issue a change would touch. `ok` is false when the card must not be approvable. */
export type IssueCheck = { ok: true; key: string; title: string; status: string; projectKey: string } | { ok: false; reason: string };
export type IssueChecker = (ownerId: string, issueKey: string) => Promise<IssueCheck | null>;

const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d{1,7}$/;

/** The issue must exist and be in the project chosen in Settings. Read-only. */
export async function checkIssue(reader: { brief(connection: JiraConnection, key: string): Promise<JiraIssueBrief> }, connection: JiraConnection, selectedProject: string | null, issueKey: string): Promise<IssueCheck> {
  if (!selectedProject) return { ok: false, reason: 'Choose the Jira project under Settings first (open it from your profile at the top right), then ask again. Kian only changes issues in the selected project.' };
  if (!ISSUE_KEY.test(issueKey)) return { ok: false, reason: 'Which issue should I change? I need its key, like SFT-123.' };
  try {
    const issue = await reader.brief(connection, issueKey);
    if (issue.projectKey !== selectedProject) return { ok: false, reason: `${issueKey} is in project ${issue.projectKey}, but the project selected in Settings is ${selectedProject}. Kian only changes issues in the selected project.` };
    return { ok: true, key: issueKey, title: issue.summary, status: issue.status, projectKey: issue.projectKey };
  } catch (error) {
    if (error instanceof JiraReadError) return { ok: false, reason: error.code === 'failed' || error.code === 'bad-query' ? `Jira could not find or open ${issueKey}.` : error.message };
    return { ok: false, reason: 'Jira could not be reached to check this change. Try again in a moment.' };
  }
}

/**
 * An issue change is checked with Jira first: the issue must exist in the selected project, and the card shows the title it has
 * now next to what it will become (only fields that really change). Open questions block approval.
 */
export async function prepareJiraUpdates(check: IssueChecker | undefined, ownerId: string, tasks: TaskProposal[], defaultProject: string | null): Promise<TaskProposal[]> {
  const out = [...tasks];
  const seen = new Set<string>();
  const work: { index: number; key: string }[] = [];
  tasks.forEach((task, index) => {
    if (task.action !== 'jira.update') return;
    let key = String(task.parameters.issueKey ?? '').trim().toUpperCase();
    if (/^\d{1,7}$/.test(key) && defaultProject) key = `${defaultProject}-${key}`;
    out[index] = { ...task, parameters: { ...task.parameters, issueKey: key } };
    if (!ISSUE_KEY.test(key)) { out[index] = { ...out[index], uncertainties: [...task.uncertainties, 'Which issue should I change? I need its key, like SFT-123.'] }; return; }
    if (seen.has(key)) { out[index] = { ...out[index], uncertainties: [...task.uncertainties, `${key} appears more than once in this request. Reject this card or the other one.`] }; return; }
    seen.add(key);
    work.push({ index, key });
  });
  for (let i = 0; i < work.length; i += 5) {
    await Promise.all(work.slice(i, i + 5).map(async ({ index, key }) => {
      const task = out[index];
      const result = check ? await check(ownerId, key) : null;
      if (!result) { out[index] = { ...task, uncertainties: [...task.uncertainties, 'Jira is not connected. Connect it under Settings first.'] }; return; }
      if (!result.ok) { out[index] = { ...task, uncertainties: [...task.uncertainties, result.reason] }; return; }
      const p = task.parameters;
      const changes: ReviewChange[] = [];
      if (typeof p.summary === 'string' && p.summary.trim() && p.summary.trim() !== result.title) changes.push({ field: 'Title', before: short(result.title), after: short(p.summary) });
      if (typeof p.description === 'string' && p.description.trim()) changes.push({ field: 'Description', before: 'Current text is not shown here', after: short(p.description) });
      const extra = p.fields && typeof p.fields === 'object' && !Array.isArray(p.fields) ? Object.entries(p.fields as Record<string, unknown>) : [];
      for (const [name, value] of extra.slice(0, 5)) changes.push({ field: short(name, 40), before: 'Current value is not shown here', after: short(typeof value === 'string' ? value : JSON.stringify(value), 80) });
      const uncertainties = changes.length ? task.uncertainties : [...task.uncertainties, `Nothing would change on ${key}. Tell me what to change.`];
      out[index] = { ...task, destination: result.projectKey, uncertainties, parameters: withReview(p, { matched: `${key} "${short(result.title, 60)}" exists in Jira project ${result.projectKey} (the project chosen in Settings).`, changes }) };
    }));
  }
  return out;
}
