import { describe, expect, it, vi } from 'vitest';
import { adfToText, JiraReader, JiraReadError } from './jira-read.js';

const connection = { accessToken: 'token', siteId: 'site-1', siteUrl: 'https://demo.atlassian.net' };
const issue = (key: string, over: Record<string, unknown> = {}) => ({ key, fields: { summary: `Summary ${key}`, issuetype: { name: 'Story' }, status: { name: 'In Progress', statusCategory: { name: 'In Progress', key: 'indeterminate' } }, assignee: { displayName: 'Siros EJ' }, created: '2026-10-01T09:00:00.000+0100', updated: '2026-10-02T09:00:00.000+0100', labels: [], issuelinks: [], ...over } });

describe('Jira read-only reader', () => {
  it('searches with the enhanced endpoint, follows pages and maps issues to plain rows', async () => {
    const urls: string[] = [];
    const request = vi.fn(async (url: string) => {
      urls.push(url);
      const page2 = url.includes('nextPageToken=t1');
      return Response.json(page2 ? { issues: [issue('SFT-3')], isLast: true } : { issues: [issue('SFT-1'), issue('SFT-2')], nextPageToken: 't1', isLast: false });
    });
    const result = await new JiraReader(request as typeof fetch).search(connection, 'project = "SFT"', 10);
    expect(result.issues.map(i => i.key)).toEqual(['SFT-1', 'SFT-2', 'SFT-3']);
    expect(result.truncated).toBe(false);
    expect(result.issues[0]).toMatchObject({ summary: 'Summary SFT-1', type: 'Story', status: 'In Progress', assignee: 'Siros EJ', statusCategory: 'In Progress' });
    expect(new URL(urls[0]).pathname).toBe('/ex/jira/site-1/rest/api/3/search/jql');
    expect(new URL(urls[0]).searchParams.get('jql')).toBe('project = "SFT"');
  });

  it('stops at the requested maximum and says the list was cut', async () => {
    const request = vi.fn(async () => Response.json({ issues: [issue('A-1'), issue('A-2'), issue('A-3')], nextPageToken: 'more', isLast: false }));
    const result = await new JiraReader(request as typeof fetch).search(connection, 'project = "A"', 2);
    expect(result.issues).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it('reads one issue with its description, last comments, links and subtasks', async () => {
    const adf = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world' }] }, { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] }] }] };
    const comments = Array.from({ length: 7 }, (_, i) => ({ author: { displayName: 'A' }, created: '2026-10-01', body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `c${i}` }] }] } }));
    const blocker = { type: { inward: 'is blocked by', outward: 'blocks' }, inwardIssue: { key: 'SFT-1', fields: { summary: 'Blocker', status: { statusCategory: { key: 'new' } } } } };
    const body = issue('SFT-9', { description: adf, comment: { comments }, subtasks: [{ key: 'SFT-10', fields: { summary: 'Sub', status: { name: 'Done' } } }], issuelinks: [blocker] });
    const request = vi.fn(async () => Response.json(body));
    const detail = await new JiraReader(request as typeof fetch).issue(connection, 'SFT-9');
    expect(detail.description).toBe('Hello world\none');
    expect(detail.comments.map(c => c.text)).toEqual(['c2', 'c3', 'c4', 'c5', 'c6']);
    expect(detail.subtasks).toEqual([{ key: 'SFT-10', summary: 'Sub', status: 'Done' }]);
    expect(detail.links[0]).toMatchObject({ key: 'SFT-1', type: 'is blocked by' });
    expect(detail.blockedBy).toEqual(['SFT-1']);
  });

  it('only ever sends GET requests, so nothing can be written to Jira through it', async () => {
    const methods: string[] = [];
    const request = vi.fn(async (_url: string, init?: RequestInit) => { methods.push(init?.method ?? 'GET'); return Response.json({ issues: [], isLast: true, fields: {} }); });
    const reader = new JiraReader(request as typeof fetch);
    await reader.search(connection, 'project = "A"', 5);
    await reader.issue(connection, 'A-1');
    expect(methods.length).toBeGreaterThan(0);
    expect(new Set(methods)).toEqual(new Set(['GET']));
  });

  it('turns Jira refusals into clear errors without leaking the token', async () => {
    for (const [status, code] of [[401, 'expired'], [403, 'forbidden'], [429, 'rate-limited'], [400, 'bad-query'], [500, 'failed']] as const) {
      const reader = new JiraReader((async () => new Response('', { status })) as typeof fetch);
      const error = await reader.search(connection, 'x', 1).catch(e => e);
      expect(error, String(status)).toBeInstanceOf(JiraReadError);
      expect(error.code).toBe(code);
      expect(error.message).not.toContain('token');
    }
    const noSite = await new JiraReader(vi.fn() as unknown as typeof fetch).search({ ...connection, siteId: '' }, 'x', 1).catch(e => e);
    expect(noSite.code).toBe('no-site');
  });

  it('converts ADF to text safely and caps its length', () => {
    expect(adfToText(null)).toBe('');
    expect(adfToText({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] }] })).toBe('a\nb');
    expect(adfToText({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(5000) }] }] }).length).toBe(2000);
  });

  it('reads an issue\'s title, status and project, and the moves Jira allows, with GET only', async () => {
    const methods: string[] = [];
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      methods.push(init?.method ?? 'GET');
      return url.includes('/transitions') ? Response.json({ transitions: [{ id: '21', name: 'Start', to: { name: 'In Progress' } }, { id: '5', name: 'Done' }] }) : Response.json({ key: 'SFT-269', fields: { summary: 'Scrum Playbook', status: { name: 'To Do' }, project: { key: 'SFT' } } });
    });
    const reader = new JiraReader(request as typeof fetch);
    expect(await reader.brief(connection, 'SFT-269')).toEqual({ key: 'SFT-269', summary: 'Scrum Playbook', status: 'To Do', projectKey: 'SFT' });
    expect(await reader.transitions(connection, 'SFT-269')).toEqual([{ id: '21', name: 'Start', to: 'In Progress' }, { id: '5', name: 'Done', to: 'Done' }]);
    expect(new Set(methods)).toEqual(new Set(['GET']));
  });
});

