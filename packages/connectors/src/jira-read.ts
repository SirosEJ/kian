import type { JiraConnection } from './jira.js';

/** What the read-only lookups return for one issue. Everything is plain text or a date string; nothing from Jira is executable. */
export type JiraIssueRow = {
  key: string; summary: string; type: string; status: string; statusCategory: string;
  assignee: string | null; reporter: string | null; priority: string | null;
  created: string | null; updated: string | null; resolved: string | null; due: string | null;
  labels: string[]; parentKey: string | null; blockedBy: string[];
};
export type JiraIssueDetail = JiraIssueRow & { description: string; comments: { author: string; created: string; text: string }[]; links: { type: string; key: string; summary: string }[]; subtasks: { key: string; summary: string; status: string }[] };
export type JiraSearchResult = { issues: JiraIssueRow[]; truncated: boolean };

const ROW_FIELDS = ['summary', 'issuetype', 'status', 'assignee', 'reporter', 'priority', 'created', 'updated', 'resolutiondate', 'duedate', 'labels', 'parent', 'issuelinks'];
const MAX_TEXT = 2000;

/** Atlassian Document Format to plain text: paragraphs, lists, headings and inline text; media and unknown nodes are dropped. */
export function adfToText(node: unknown): string {
  const out: string[] = [];
  const walk = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const n = value as { type?: string; text?: string; content?: unknown[] };
    if (n.type === 'text' && typeof n.text === 'string') out.push(n.text);
    else if (n.type === 'hardBreak') out.push('\n');
    else if (n.type === 'mention' || n.type === 'emoji' || n.type === 'inlineCard') out.push((value as { attrs?: { text?: string; shortName?: string; url?: string } }).attrs?.text ?? (value as { attrs?: { shortName?: string } }).attrs?.shortName ?? '');
    if (Array.isArray(n.content)) {
      for (const child of n.content) walk(child);
      if (['paragraph', 'heading', 'listItem', 'codeBlock', 'blockquote', 'tableRow'].includes(n.type ?? '')) out.push('\n');
    }
  };
  walk(node);
  return out.join('').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_TEXT);
}

const name = (u: unknown) => (u && typeof u === 'object' && typeof (u as { displayName?: unknown }).displayName === 'string' ? (u as { displayName: string }).displayName : null);

function toRow(issue: { key: string; fields?: Record<string, any> }): JiraIssueRow {
  const f = issue.fields ?? {};
  const blockedBy: string[] = [];
  for (const link of (f.issuelinks ?? []) as any[]) {
    // "is blocked by": the inward side of a Blocks link, still unresolved.
    if (link?.type?.inward === 'is blocked by' && link.inwardIssue && link.inwardIssue.fields?.status?.statusCategory?.key !== 'done') blockedBy.push(String(link.inwardIssue.key));
  }
  return {
    key: String(issue.key), summary: String(f.summary ?? ''), type: String(f.issuetype?.name ?? ''), status: String(f.status?.name ?? ''), statusCategory: String(f.status?.statusCategory?.name ?? ''),
    assignee: name(f.assignee), reporter: name(f.reporter), priority: f.priority?.name ?? null,
    created: f.created ?? null, updated: f.updated ?? null, resolved: f.resolutiondate ?? null, due: f.duedate ?? null,
    labels: Array.isArray(f.labels) ? f.labels.map(String) : [], parentKey: f.parent?.key ? String(f.parent.key) : null, blockedBy,
  };
}

/**
 * Read-only access to a Jira site with the user's own token. Every request is a GET: there is deliberately no way to
 * write through this class, and its tests check that.
 */
export class JiraReader {
  constructor(private readonly request: typeof fetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20000) })) {}

  private async get(connection: JiraConnection, path: string, query: Record<string, string> = {}): Promise<any> {
    if (!connection.siteId) throw new JiraReadError('no-site', 'Choose a Jira site in Settings first.');
    const url = new URL(`https://api.atlassian.com/ex/jira/${encodeURIComponent(connection.siteId)}/rest/api/3/${path}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const response = await this.request(url.toString(), { method: 'GET', headers: { Authorization: `Bearer ${connection.accessToken}`, Accept: 'application/json' } });
    if (response.status === 401) throw new JiraReadError('expired', 'Jira access expired. Reconnect Jira in Settings.');
    if (response.status === 403) throw new JiraReadError('forbidden', 'Jira did not allow that. Check your permissions on the project.');
    if (response.status === 429) throw new JiraReadError('rate-limited', 'Jira is limiting requests right now. Try again in a minute.');
    if (response.status === 400) throw new JiraReadError('bad-query', 'Jira could not run that query.');
    if (!response.ok) throw new JiraReadError('failed', `Jira did not answer (${response.status}).`);
    return response.json();
  }

  /** Runs a JQL search and follows pages until `max` issues are collected. */
  async search(connection: JiraConnection, jql: string, max: number): Promise<JiraSearchResult> {
    const issues: JiraIssueRow[] = [];
    let token: string | undefined;
    for (let page = 0; page < 20 && issues.length < max; page++) {
      const body = await this.get(connection, 'search/jql', { jql, maxResults: String(Math.min(100, max - issues.length)), fields: ROW_FIELDS.join(','), ...(token ? { nextPageToken: token } : {}) });
      for (const issue of body.issues ?? []) issues.push(toRow(issue));
      token = body.nextPageToken;
      if (!token || body.isLast) return { issues: issues.slice(0, max), truncated: false };
    }
    return { issues: issues.slice(0, max), truncated: Boolean(token) };
  }

  async issue(connection: JiraConnection, key: string): Promise<JiraIssueDetail> {
    const body = await this.get(connection, `issue/${encodeURIComponent(key)}`, { fields: [...ROW_FIELDS, 'description', 'comment', 'subtasks'].join(',') });
    const f = body.fields ?? {};
    const comments = ((f.comment?.comments ?? []) as any[]).slice(-5).map(c => ({ author: name(c.author) ?? 'Unknown', created: String(c.created ?? ''), text: adfToText(c.body).slice(0, 600) }));
    const links = ((f.issuelinks ?? []) as any[]).flatMap(l => {
      const other = l.outwardIssue ?? l.inwardIssue;
      return other ? [{ type: String(l.outwardIssue ? l.type?.outward : l.type?.inward), key: String(other.key), summary: String(other.fields?.summary ?? '') }] : [];
    });
    const subtasks = ((f.subtasks ?? []) as any[]).map(s => ({ key: String(s.key), summary: String(s.fields?.summary ?? ''), status: String(s.fields?.status?.name ?? '') }));
    return { ...toRow(body), description: adfToText(f.description), comments, links, subtasks };
  }
}

export class JiraReadError extends Error {
  constructor(readonly code: 'no-site' | 'expired' | 'forbidden' | 'rate-limited' | 'bad-query' | 'failed', message: string) { super(message); }
}
