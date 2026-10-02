import { describe, expect, it } from 'vitest';
import { JiraReadError, type JiraIssueDetail, type JiraIssueRow } from '@kian/connectors';
import { createInsights, type Reader } from './insights.js';

const connection = { accessToken: 'secret-token', siteId: 'site-1', siteUrl: 'https://demo.atlassian.net/', defaultProject: null as string | null };
const today = '2026-10-02';
const row = (key: string, over: Partial<JiraIssueRow> = {}): JiraIssueRow => ({ key, summary: `Summary ${key}`, type: 'Story', status: 'In Progress', statusCategory: 'In Progress', assignee: 'Siros EJ', reporter: 'Siros EJ', priority: 'Medium', created: '2026-10-01T09:00:00.000+0100', updated: '2026-10-02T09:00:00.000+0100', resolved: null, due: null, labels: [], parentKey: null, blockedBy: [], ...over });
const detail = (key: string, over: Partial<JiraIssueDetail> = {}): JiraIssueDetail => ({ ...row(key), description: 'Why this exists', comments: [{ author: 'A', created: '2026-10-01', text: 'looks good' }], links: [], subtasks: [], ...over });

function fake(answers: (jql: string) => JiraIssueRow[], issues: Record<string, JiraIssueDetail> = {}) {
  const calls: string[] = [];
  const reader: Reader = {
    search: async (_c, jql) => { calls.push(jql); return { issues: answers(jql), truncated: false }; },
    issue: async (_c, key) => { calls.push(`issue ${key}`); if (!issues[key]) throw new JiraReadError('forbidden', 'Jira did not allow that. Check your permissions on the project.'); return issues[key]; },
  };
  return { reader, calls };
}

describe('Jira lookups and reports', () => {
  it('searches and returns a linked table plus a compact digest for the model', async () => {
    const { reader, calls } = fake(() => [row('SFT-1'), row('SFT-2', { assignee: null, status: 'Done', statusCategory: 'Done' })]);
    const outcome = await createInsights(reader).run(connection, [{ type: 'search', project: 'SFT', createdFrom: '2026-10-01', createdTo: '2026-10-01' }], today);
    expect(calls[0]).toContain('project = "SFT" AND created >= "2026-10-01" AND created < "2026-10-02"');
    const table = outcome.tables[0];
    expect(table.columns).toEqual(['Key', 'Summary', 'Type', 'Status', 'Assignee', 'Updated']);
    expect(table.rows[1]).toEqual(['SFT-2', 'Summary SFT-2', 'Story', 'Done', 'Unassigned', '2026-10-02']);
    expect(table.links[0]).toBe('https://demo.atlassian.net/browse/SFT-1');
    expect(outcome.issuesRead).toBe(2);
    expect(outcome.digest[0]).toMatchObject({ type: 'search', found: 2 });
    // The model also gets who created each issue and when, so a follow-up like "who created them?" can be answered.
    expect((outcome.digest[0] as { issues: unknown[] }).issues[0]).toMatchObject({ key: 'SFT-1', reporter: 'Siros EJ', created: '2026-10-01' });
    expect(JSON.stringify(outcome)).not.toContain('secret-token');
  });

  it('shows at most 50 rows and says how many were left out', async () => {
    const { reader } = fake(() => Array.from({ length: 80 }, (_, i) => row(`SFT-${i + 1}`)));
    const outcome = await createInsights(reader).run(connection, [{ type: 'search', project: 'SFT' }], today);
    expect(outcome.tables[0].rows).toHaveLength(50);
    expect(outcome.tables[0].note).toContain('30 more not shown');
    expect((outcome.digest[0] as { issues: unknown[] }).issues.length).toBeLessThanOrEqual(40);
  });

  it('reads one issue with its description and comments', async () => {
    const { reader } = fake(() => [], { 'SFT-253': detail('SFT-253', { blockedBy: ['SFT-227'] }) });
    const outcome = await createInsights(reader).run(connection, [{ type: 'issue', key: 'SFT-253' }], today);
    expect(outcome.digest[0]).toMatchObject({ type: 'issue', key: 'SFT-253', description: 'Why this exists', blockedBy: ['SFT-227'] });
    expect(outcome.tables[0].rows[0][0]).toBe('SFT-253');
  });

  it('summarises an epic by its children', async () => {
    const { reader, calls } = fake(() => [row('SFT-3', { statusCategory: 'Done', status: 'Done' }), row('SFT-4'), row('SFT-5', { statusCategory: 'To Do', status: 'To Do' })], { 'SFT-225': detail('SFT-225', { type: 'Epic' }) });
    const outcome = await createInsights(reader).run(connection, [{ type: 'epic', key: 'SFT-225' }], today);
    expect(calls).toContain('issue SFT-225');
    expect(calls.some(c => c.startsWith('parent = "SFT-225"'))).toBe(true);
    expect(outcome.digest[0]).toMatchObject({ type: 'epic', children: 3, byStatusCategory: { Done: 1, 'In Progress': 1, 'To Do': 1 } });
  });

  it('builds the status summary and the per-person report from the same issues', async () => {
    const issues = [row('A-1'), row('A-2', { status: 'Done', statusCategory: 'Done' }), row('A-3', { assignee: 'Sam', status: 'To Do', statusCategory: 'To Do' }), row('A-4', { assignee: null, type: 'Bug' })];
    const { reader } = fake(() => issues);
    const insights = createInsights(reader);
    const status = await insights.run(connection, [{ type: 'report', kind: 'status_summary', project: 'A' }], today);
    expect(status.tables[0].rows).toEqual([['In Progress', '2'], ['Done', '1'], ['To Do', '1'], ['Total', '4']]);
    expect(status.tables[1].rows).toEqual([['Story', '3'], ['Bug', '1']]);
    const people = await insights.run(connection, [{ type: 'report', kind: 'by_assignee', project: 'A' }], today);
    expect(people.tables[0].rows).toEqual([['Sam', '1', '0', '0', '1'], ['Siros EJ', '0', '1', '1', '2'], ['Unassigned', '0', '1', '0', '1']]);
  });

  it('counts created and resolved per day over a period', async () => {
    const { reader } = fake(jql => jql.includes('resolutiondate >=') ? [row('A-1', { resolved: '2026-10-02T10:00:00.000+0100' })] : [row('A-1', { created: '2026-10-01T10:00:00.000+0100' }), row('A-2', { created: '2026-10-02T10:00:00.000+0100' })]);
    const outcome = await createInsights(reader).run(connection, [{ type: 'report', kind: 'created_vs_resolved', project: 'A', from: '2026-10-01', to: '2026-10-02' }], today);
    expect(outcome.tables[0].rows).toEqual([['2026-10-01', '1', '0'], ['2026-10-02', '1', '1'], ['Total', '2', '1']]);
  });

  it('shows epic progress with percentages', async () => {
    const { reader } = fake(jql => jql.startsWith('parent in') ? [row('A-2', { parentKey: 'A-1', statusCategory: 'Done' }), row('A-3', { parentKey: 'A-1' }), row('A-4', { parentKey: 'A-1', statusCategory: 'To Do' }), row('A-5', { parentKey: 'A-1', statusCategory: 'Done' })] : [row('A-1', { type: 'Epic', summary: 'Big' })]);
    const outcome = await createInsights(reader).run(connection, [{ type: 'report', kind: 'epic_progress', project: 'A' }], today);
    expect(outcome.tables[0].rows).toEqual([['A-1', 'Big', '1', '1', '2', '4', '50%']]);
  });

  it('finds blocked and overdue work and says why', async () => {
    const { reader } = fake(() => [row('A-1', { due: '2026-09-30' }), row('A-2', { status: 'Blocked', statusCategory: 'In Progress' }), row('A-3', { blockedBy: ['A-9'] }), row('A-4', { labels: ['blocked'] }), row('A-5', { due: '2026-10-09' })]);
    const outcome = await createInsights(reader).run(connection, [{ type: 'report', kind: 'blocked_overdue', project: 'A' }], today);
    expect(outcome.tables[0].rows.map(r => [r[0], r[5]])).toEqual([['A-1', 'overdue since 2026-09-30'], ['A-2', 'marked blocked'], ['A-3', 'blocked by A-9'], ['A-4', 'marked blocked']]);
  });

  it('lists what changed since a date, clamped to 90 days', async () => {
    const { reader, calls } = fake(() => [row('A-1')]);
    const outcome = await createInsights(reader).run(connection, [{ type: 'report', kind: 'changes_since', project: 'A', from: '2020-01-01' }], today);
    expect(calls[0]).toContain('updated >= "2026-07-04"');
    expect(outcome.notes.join(' ')).toContain('90 days');
  });

  it('turns a Jira refusal into a note and carries on with the other lookups', async () => {
    const { reader } = fake(() => [row('A-1')], {});
    const outcome = await createInsights(reader).run(connection, [{ type: 'issue', key: 'SECRET-1' }, { type: 'search', project: 'A' }], today);
    expect(outcome.notes).toContain('Jira did not allow that. Check your permissions on the project.');
    expect(outcome.digest[0]).toMatchObject({ type: 'issue', error: expect.stringContaining('permissions') });
    expect(outcome.tables).toHaveLength(1);
  });

  it('runs at most three lookups and can only read: the reader it is given has no write methods', async () => {
    const { reader, calls } = fake(() => []);
    await createInsights(reader).run(connection, Array.from({ length: 6 }, () => ({ type: 'search' as const, project: 'A' })), today);
    expect(calls).toHaveLength(3);
    expect(Object.keys(reader).sort()).toEqual(['issue', 'search']);
  });
});

describe('saying what was searched', () => {
  it('names the filters in the table note and the digest', async () => {
    const { reader } = fake(() => [row('SFT-1')]);
    const outcome = await createInsights(reader).run({ ...connection, defaultProject: 'SFT' }, [{ type: 'search', statusCategory: 'To Do' }], today);
    expect(outcome.tables[0].note).toBe('Searched: project SFT, status category To Do.');
    expect(outcome.digest[0]).toMatchObject({ searched: 'project SFT, status category To Do' });
  });

  it('when nothing is assigned to the user, checks without that filter and says how many match', async () => {
    const { reader, calls } = fake(jql => (jql.includes('currentUser()') ? [] : [row('SFT-1'), row('SFT-2')]));
    const outcome = await createInsights(reader).run(connection, [{ type: 'search', project: 'SFT', statusCategory: 'To Do', assignee: 'me' }], today);
    expect(calls).toHaveLength(2);
    expect(calls[1]).not.toContain('currentUser()');
    expect(outcome.tables[0].rows).toEqual([]);
    expect(outcome.digest[0]).toMatchObject({ found: 0, matchWithoutAssigneeFilter: 2 });
    expect(outcome.notes.join(' ')).toContain('2 match without that filter');
  });

  it('does not search again when the first search found something or had no assignee filter', async () => {
    const found = fake(() => [row('SFT-1')]);
    await createInsights(found.reader).run(connection, [{ type: 'search', project: 'SFT', assignee: 'me' }], today);
    expect(found.calls).toHaveLength(1);
    const none = fake(() => []);
    await createInsights(none.reader).run(connection, [{ type: 'search', project: 'SFT' }], today);
    expect(none.calls).toHaveLength(1);
  });
});

