import { describe, expect, it } from 'vitest';
import type { TaskProposal } from '@kian/contracts';
import { JiraReadError } from '@kian/connectors';
import { checkIssue, prepareJiraUpdates, type IssueCheck } from './updates.js';

const conn = { accessToken: 't', siteId: 's', siteUrl: 'https://x.atlassian.net' };
const brief = (over: Partial<{ projectKey: string; summary: string; status: string }> = {}) => ({ key: 'SFT-1', summary: 'Old title', status: 'To Do', statusCategory: 'To Do', projectKey: 'SFT', ...over });
const update = (parameters: Record<string, unknown>, id = 'j1'): TaskProposal => ({ id, action: 'jira.update', connectionId: null, destination: null, parameters, uncertainties: [], state: 'proposed' });
const ok: IssueCheck = { ok: true, key: 'SFT-1', title: 'Old title', status: 'To Do', projectKey: 'SFT' };
const review = (t: TaskProposal) => t.parameters._review as { matched: string; changes: { field: string; before: string; after: string }[] };

describe('checking an issue before a change', () => {
  it('accepts an issue in the selected project and refuses another project, a bad key, no project, and Jira errors', async () => {
    expect(await checkIssue({ brief: async () => brief() as never }, conn, 'SFT', 'SFT-1')).toEqual({ ok: true, key: 'SFT-1', title: 'Old title', status: 'To Do', projectKey: 'SFT' });
    expect(await checkIssue({ brief: async () => brief({ projectKey: 'OPS' }) as never }, conn, 'SFT', 'SFT-1')).toMatchObject({ ok: false, reason: expect.stringContaining('project selected in Settings is SFT') });
    expect(await checkIssue({ brief: async () => brief() as never }, conn, 'SFT', 'nope')).toMatchObject({ ok: false });
    expect(await checkIssue({ brief: async () => brief() as never }, conn, null, 'SFT-1')).toMatchObject({ ok: false, reason: expect.stringContaining('Choose the Jira project') });
    expect(await checkIssue({ brief: async () => { throw new JiraReadError('forbidden', 'Jira did not allow that.'); } }, conn, 'SFT', 'SFT-1')).toEqual({ ok: false, reason: 'Jira did not allow that.' });
    expect(await checkIssue({ brief: async () => { throw new Error('net'); } }, conn, 'SFT', 'SFT-1')).toMatchObject({ ok: false, reason: expect.stringContaining('could not be reached') });
  });
});

describe('Jira update cards', () => {
  it('shows the title as it is now next to the new one, plus description and extra fields, and uses the project from Settings for a bare number', async () => {
    const seen: string[] = [];
    const [task] = await prepareJiraUpdates(async (_o, key) => { seen.push(key); return ok; }, 'alice', [update({ issueKey: '1', summary: 'New title', description: 'More detail', fields: { labels: ['a'] } })], 'SFT');
    expect(seen).toEqual(['SFT-1']);
    expect(task.destination).toBe('SFT');
    expect(task.uncertainties).toEqual([]);
    expect(review(task).changes.map(c => [c.field, c.before, c.after])).toEqual([['Title', 'Old title', 'New title'], ['Description', 'Current text is not shown here', 'More detail'], ['labels', 'Current value is not shown here', '["a"]']]);
    expect(review(task).matched).toContain('SFT-1');
  });

  it('blocks approval when nothing would change, Jira cannot find the issue, it is in another project, or Jira is not connected', async () => {
    const same = await prepareJiraUpdates(async () => ok, 'alice', [update({ issueKey: 'SFT-1', summary: 'Old title' })], 'SFT');
    expect(same[0].uncertainties.join(' ')).toMatch(/Nothing would change/);
    const other = await prepareJiraUpdates(async () => ({ ok: false, reason: 'SFT-1 is in project OPS, but the project selected in Settings is SFT.' }), 'alice', [update({ issueKey: 'SFT-1', summary: 'x' })], 'SFT');
    expect(other[0].uncertainties.join(' ')).toMatch(/project selected in Settings/);
    expect((await prepareJiraUpdates(async () => null, 'alice', [update({ issueKey: 'SFT-1', summary: 'x' })], 'SFT'))[0].uncertainties.join(' ')).toMatch(/not connected/);
    expect((await prepareJiraUpdates(undefined, 'alice', [update({ issueKey: 'SFT-1', summary: 'x' })], 'SFT'))[0].uncertainties.join(' ')).toMatch(/not connected/);
    expect((await prepareJiraUpdates(async () => ok, 'alice', [update({ summary: 'x' })], 'SFT'))[0].uncertainties.join(' ')).toMatch(/Which issue/);
  });

  it('flags the same issue named twice and leaves other actions alone', async () => {
    const tasks = await prepareJiraUpdates(async () => ok, 'alice', [update({ issueKey: 'SFT-1', summary: 'A' }, 'a'), update({ issueKey: 'sft-1', summary: 'B' }, 'b'), { ...update({}, 'c'), action: 'jira.create' }], 'SFT');
    expect(tasks[1].uncertainties.join(' ')).toMatch(/more than once/);
    expect(tasks[2].parameters._review).toBeUndefined();
  });
});
