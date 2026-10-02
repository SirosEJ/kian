import { JiraReadError, type JiraConnection, type JiraIssueDetail, type JiraIssueRow, type JiraSearchResult } from '@kian/connectors';
import { addDays, clampDate, describeSearch, LIMITS, quote, searchJql, type Lookup } from './lookups.js';

/** A table the chat can show. It is always built from Jira's own answer, never from model text. */
export type ResultTable = { title: string; columns: string[]; rows: string[][]; links: (string | null)[]; note?: string; /** Not shown: ids of the items in each row (calendar event ids), so a follow-up like "delete it" can name the exact one. */ refs?: string[] };
export type Reader = { search(connection: JiraConnection, jql: string, max: number): Promise<JiraSearchResult>; issue(connection: JiraConnection, key: string): Promise<JiraIssueDetail> };
export type LookupConnection = JiraConnection & { defaultProject?: string | null };
export type LookupOutcome = { tables: ResultTable[]; digest: unknown[]; issuesRead: number; notes: string[] };

const day = (value: string | null) => (value ? value.slice(0, 10) : '');
const link = (connection: JiraConnection, key: string) => `${connection.siteUrl.replace(/\/$/, '')}/browse/${encodeURIComponent(key)}`;

function issueTable(connection: JiraConnection, title: string, issues: JiraIssueRow[], note?: string, limit: number = LIMITS.tableRows): ResultTable {
  const shown = issues.slice(0, Math.min(limit, LIMITS.tableRows));
  const extra = issues.length - shown.length;
  return {
    title, columns: ['Key', 'Summary', 'Type', 'Status', 'Assignee', 'Updated'],
    rows: shown.map(i => [i.key, i.summary, i.type, i.status, i.assignee ?? 'Unassigned', day(i.updated)]),
    links: shown.map(i => link(connection, i.key)),
    note: [note, extra > 0 ? `${extra} more not shown: narrow the question to see them.` : ''].filter(Boolean).join(' ') || undefined,
  };
}

const compact = (i: JiraIssueRow) => ({ key: i.key, summary: i.summary.slice(0, 120), issueType: i.type, status: i.status, assignee: i.assignee, reporter: i.reporter, created: day(i.created), updated: day(i.updated), due: i.due });

function tally<T>(items: T[], by: (item: T) => string): [string, number][] {
  const map = new Map<string, number>();
  for (const item of items) map.set(by(item), (map.get(by(item)) ?? 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

const projectClause = (project: string | null | undefined) => (project ? `project = ${quote(project)} AND ` : '');

/**
 * Runs the lookups the model asked for, with the user's own read-only Jira connection. It only reads, it never throws for a
 * Jira problem (the problem becomes a note and a digest entry), and it hands back tables built from the real rows.
 */
export function createInsights(reader: Reader) {
  async function one(connection: LookupConnection, lookup: Lookup, today: string, outcome: LookupOutcome) {
    const notes = outcome.notes;
    if (lookup.type === 'search') {
      const { jql, notes: n } = searchJql(lookup, today, connection.defaultProject);
      notes.push(...n);
      const result = await reader.search(connection, jql, LIMITS.searchIssues);
      outcome.issuesRead += result.issues.length;
      const limit = lookup.limit ?? LIMITS.tableRows;
      const searched = describeSearch(lookup, connection.defaultProject);
      outcome.tables.push(issueTable(connection, 'Issues', result.issues, [`Searched: ${searched}.`, result.truncated ? `More than ${LIMITS.searchIssues} matched.` : ''].filter(Boolean).join(' '), limit));
      // A search narrowed to the user's own issues that finds nothing is checked again without that narrowing, so the answer can say so instead of just "none".
      let withoutAssignee: number | undefined;
      if (!result.issues.length && lookup.assignee === 'me') {
        const wider = searchJql({ ...lookup, assignee: undefined }, today, connection.defaultProject);
        const again = await reader.search(connection, wider.jql, LIMITS.searchIssues);
        withoutAssignee = again.issues.length;
        if (withoutAssignee) notes.push(`Nothing is assigned to you, but ${withoutAssignee}${again.truncated ? '+' : ''} match without that filter. Ask me to show them.`);
      }
      outcome.digest.push({ type: 'search', searched, ...(withoutAssignee !== undefined ? { matchWithoutAssigneeFilter: withoutAssignee } : {}), found: result.issues.length, moreExist: result.truncated, issues: result.issues.slice(0, LIMITS.digestRows).map(compact) });
    } else if (lookup.type === 'issue') {
      const detail = await reader.issue(connection, lookup.key);
      outcome.issuesRead += 1;
      outcome.tables.push(issueTable(connection, lookup.key, [detail]));
      outcome.digest.push({ type: 'issue', ...compact(detail), priority: detail.priority, resolved: day(detail.resolved), labels: detail.labels, parent: detail.parentKey, blockedBy: detail.blockedBy, description: detail.description, comments: detail.comments, links: detail.links, subtasks: detail.subtasks });
    } else if (lookup.type === 'epic') {
      const epic = await reader.issue(connection, lookup.key);
      const children = await reader.search(connection, `parent = ${quote(lookup.key)} ORDER BY status ASC, updated DESC`, LIMITS.searchIssues);
      outcome.issuesRead += 1 + children.issues.length;
      const byCategory = tally(children.issues, i => i.statusCategory || 'Unknown');
      outcome.tables.push(issueTable(connection, `${lookup.key}: ${epic.summary}`, children.issues, byCategory.map(([k, v]) => `${k}: ${v}`).join(', ') || 'No child issues.'));
      outcome.digest.push({ type: 'epic', ...compact(epic), description: epic.description, children: children.issues.length, byStatusCategory: Object.fromEntries(byCategory), items: children.issues.slice(0, LIMITS.digestRows).map(compact) });
    } else {
      await report(connection, lookup, today, outcome);
    }
  }

  async function report(connection: LookupConnection, lookup: Extract<Lookup, { type: 'report' }>, today: string, outcome: LookupOutcome) {
    const notes = outcome.notes;
    const project = lookup.project ?? connection.defaultProject ?? null;
    const scope = project ? `project ${project}` : 'all projects you can see';
    const window = addDays(today, -LIMITS.lookbackDays);
    const fetchAll = async (jql: string) => { const r = await reader.search(connection, jql, LIMITS.reportIssues); outcome.issuesRead += r.issues.length; return r; };
    const capNote = (r: JiraSearchResult) => (r.truncated ? `Based on the first ${LIMITS.reportIssues} issues; there are more.` : '');
    const finish = (tables: ResultTable[], digestNote: string) => { outcome.tables.push(...tables); outcome.digest.push({ type: 'report', kind: lookup.kind, scope, note: digestNote, tables: tables.map(t => ({ title: t.title, columns: t.columns, rows: t.rows.slice(0, LIMITS.digestRows), note: t.note })) }); };
    const plain = (title: string, columns: string[], rows: string[][], note?: string): ResultTable => ({ title, columns, rows, links: rows.map(() => null), note });

    if (lookup.kind === 'status_summary' || lookup.kind === 'by_assignee') {
      const r = await fetchAll(`${projectClause(project)}(statusCategory != "Done" OR updated >= ${quote(window)}) ORDER BY updated DESC`);
      const basis = `Open work plus anything updated in the last ${LIMITS.lookbackDays} days in ${scope}: ${r.issues.length} issues.`;
      if (lookup.kind === 'status_summary') {
        finish([plain('By status', ['Status', 'Issues'], [...tally(r.issues, i => i.status), ['Total', String(r.issues.length)]].map(([a, b]) => [String(a), String(b)]), [basis, capNote(r)].filter(Boolean).join(' ')), plain('By type', ['Type', 'Issues'], tally(r.issues, i => i.type).map(([a, b]) => [a, String(b)]))], basis);
      } else {
        const names = [...new Set(r.issues.map(i => i.assignee ?? 'Unassigned'))].sort();
        const rows = names.map(n => { const mine = r.issues.filter(i => (i.assignee ?? 'Unassigned') === n); const c = (cat: string) => String(mine.filter(i => i.statusCategory === cat).length); return [n, c('To Do'), c('In Progress'), c('Done'), String(mine.length)]; });
        finish([plain('Work per person', ['Person', 'To do', 'In progress', 'Done', 'Total'], rows, [basis, capNote(r)].filter(Boolean).join(' '))], basis);
      }
    } else if (lookup.kind === 'created_vs_resolved') {
      const to = clampDate(lookup.to, today, notes) ?? today;
      const from = clampDate(lookup.from, today, notes) ?? addDays(to, -6);
      const [created, resolved] = await Promise.all([
        fetchAll(`${projectClause(project)}created >= ${quote(from)} AND created < ${quote(addDays(to, 1))} ORDER BY created ASC`),
        fetchAll(`${projectClause(project)}resolutiondate >= ${quote(from)} AND resolutiondate < ${quote(addDays(to, 1))} ORDER BY resolutiondate ASC`),
      ]);
      const days: string[] = [];
      for (let d = from; d <= to && days.length < LIMITS.lookbackDays + 1; d = addDays(d, 1)) days.push(d);
      const cs = new Map(tally(created.issues, i => day(i.created))), rs = new Map(tally(resolved.issues, i => day(i.resolved)));
      const rows = days.map(d => [d, String(cs.get(d) ?? 0), String(rs.get(d) ?? 0)]);
      rows.push(['Total', String(created.issues.length), String(resolved.issues.length)]);
      finish([plain(`Created and resolved, ${from} to ${to}`, ['Day', 'Created', 'Resolved'], rows, [`Days are Jira's own dates. ${scope}.`, capNote(created), capNote(resolved)].filter(Boolean).join(' '))], `${created.issues.length} created and ${resolved.issues.length} resolved from ${from} to ${to}.`);
    } else if (lookup.kind === 'epic_progress') {
      const epics = await fetchAll(`${projectClause(project)}issuetype = "Epic" AND statusCategory != "Done" ORDER BY updated DESC`);
      const shown = epics.issues.slice(0, 25);
      const kids = shown.length ? await fetchAll(`parent in (${shown.map(e => quote(e.key)).join(', ')})`) : { issues: [], truncated: false };
      const rows = shown.map(e => { const mine = kids.issues.filter(i => i.parentKey === e.key); const c = (cat: string) => mine.filter(i => i.statusCategory === cat).length; const done = c('Done'); return [e.key, e.summary, String(c('To Do')), String(c('In Progress')), String(done), String(mine.length), mine.length ? `${Math.round((done / mine.length) * 100)}%` : 'n/a']; });
      const table = plain('Open epics', ['Epic', 'Summary', 'To do', 'In progress', 'Done', 'Total', '% done'], rows, [epics.issues.length > shown.length ? `Showing 25 of ${epics.issues.length} open epics.` : '', capNote(kids)].filter(Boolean).join(' ') || undefined);
      table.links = shown.map(e => link(connection, e.key));
      finish([table], `${epics.issues.length} open epics in ${scope}.`);
    } else if (lookup.kind === 'blocked_overdue') {
      const r = await fetchAll(`${projectClause(project)}statusCategory != "Done" ORDER BY updated DESC`);
      const flagged = r.issues.flatMap(i => {
        const reasons: string[] = [];
        if (i.due && i.due < today) reasons.push(`overdue since ${i.due}`);
        if (/block/i.test(i.status) || i.labels.some(l => /^blocked$/i.test(l))) reasons.push('marked blocked');
        if (i.blockedBy.length) reasons.push(`blocked by ${i.blockedBy.join(', ')}`);
        return reasons.length ? [{ i, reason: reasons.join('; ') }] : [];
      });
      const table = plain('Blocked or overdue', ['Key', 'Summary', 'Status', 'Assignee', 'Due', 'Why'], flagged.slice(0, LIMITS.tableRows).map(({ i, reason }) => [i.key, i.summary, i.status, i.assignee ?? 'Unassigned', i.due ?? '', reason]), flagged.length ? [`${flagged.length} of ${r.issues.length} open issues in ${scope}.`, capNote(r)].filter(Boolean).join(' ') : `Nothing is blocked or overdue among ${r.issues.length} open issues in ${scope}.`);
      table.links = flagged.slice(0, LIMITS.tableRows).map(({ i }) => link(connection, i.key));
      finish([table], `${flagged.length} blocked or overdue of ${r.issues.length} open issues.`);
    } else {
      const from = clampDate(lookup.from, today, notes) ?? addDays(today, -7);
      const r = await fetchAll(`${projectClause(project)}updated >= ${quote(from)} ORDER BY updated DESC`);
      finish([issueTable(connection, `Changed since ${from}`, r.issues, [`${r.issues.length} issues in ${scope}.`, capNote(r)].filter(Boolean).join(' '))], `${r.issues.length} issues changed since ${from}.`);
    }
  }

  return {
    async run(connection: LookupConnection, lookups: Lookup[], today: string): Promise<LookupOutcome> {
      const outcome: LookupOutcome = { tables: [], digest: [], issuesRead: 0, notes: [] };
      for (const lookup of lookups.slice(0, LIMITS.lookupsPerMessage)) {
        try { await one(connection, lookup, today, outcome); }
        catch (error) {
          const message = error instanceof JiraReadError ? error.message : 'Jira could not be reached.';
          outcome.notes.push(message);
          outcome.digest.push({ type: lookup.type, error: message });
        }
      }
      return outcome;
    },
  };
}
