import { z } from 'zod';

/** Limits that keep a question cheap and bounded. */
export const LIMITS = { lookupsPerMessage: 3, lookbackDays: 90, tableRows: 50, searchIssues: 200, reportIssues: 500, digestRows: 40 } as const;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const projectKey = z.string().regex(/^[A-Z][A-Z0-9_]{1,19}$/);
const issueKey = z.string().regex(/^[A-Z][A-Z0-9_]{1,19}-\d{1,7}$/);
const word = z.string().trim().min(1).max(60);

export const REPORT_KINDS = ['status_summary', 'created_vs_resolved', 'by_assignee', 'epic_progress', 'blocked_overdue', 'changes_since'] as const;

/** What the model may ask for. It never writes JQL: the server builds the query from these fields. */
export const LookupSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('search'), project: projectKey.optional(), issueTypes: z.array(word).max(5).optional(), statuses: z.array(word).max(8).optional(),
    statusCategory: z.enum(['To Do', 'In Progress', 'Done']).optional(), assignee: z.enum(['me', 'unassigned']).optional(),
    createdFrom: date.optional(), createdTo: date.optional(), updatedFrom: date.optional(), updatedTo: date.optional(), resolvedFrom: date.optional(), resolvedTo: date.optional(),
    epic: issueKey.optional(), text: z.string().trim().min(1).max(100).optional(), orderBy: z.enum(['created', 'updated']).optional(), limit: z.number().int().min(1).max(LIMITS.tableRows).optional(),
  }),
  z.object({ type: z.literal('issue'), key: issueKey }),
  z.object({ type: z.literal('epic'), key: issueKey }),
  z.object({ type: z.literal('report'), kind: z.enum(REPORT_KINDS), project: projectKey.optional(), from: date.optional(), to: date.optional() }),
]);
export type Lookup = z.infer<typeof LookupSchema>;
export type SearchLookup = Extract<Lookup, { type: 'search' }>;

/** Parses the model's lookups; anything invalid is dropped (and counted), never guessed at. */
export function parseLookups(raw: unknown): { lookups: Lookup[]; dropped: number } {
  if (!Array.isArray(raw)) return { lookups: [], dropped: 0 };
  const lookups: Lookup[] = [];
  let dropped = 0;
  for (const value of raw.slice(0, 10)) {
    const parsed = LookupSchema.safeParse(value);
    if (parsed.success && lookups.length < LIMITS.lookupsPerMessage) lookups.push(parsed.data); else dropped++;
  }
  return { lookups, dropped };
}

// --- dates (plain YYYY-MM-DD arithmetic, no time zones) ---
const toDay = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
export const addDays = (iso: string, days: number) => new Date(toDay(iso) + days * 86400000).toISOString().slice(0, 10);
export const validDate = (iso: string) => !Number.isNaN(toDay(iso)) && addDays(iso, 0) === iso;

/** Pulls a date back to the look-back limit and says so; returns the date to use plus any note. */
export function clampDate(value: string | undefined, today: string, notes: string[]): string | undefined {
  if (!value) return undefined;
  if (!validDate(value)) { notes.push(`I ignored a date I could not read: ${value.slice(0, 20)}.`); return undefined; }
  const earliest = addDays(today, -LIMITS.lookbackDays);
  if (value < earliest) { notes.push(`I can look back ${LIMITS.lookbackDays} days at most, so I started from ${earliest}.`); return earliest; }
  return value;
}

/** A value for JQL: quotes, backslashes and control characters are removed, never escaped, so nothing can break out of the string. */
export const quote = (value: string) => `"${value.replace(/[\\"\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim()}"`;

export function searchJql(lookup: SearchLookup, today: string, defaultProject: string | null | undefined): { jql: string; notes: string[] } {
  const notes: string[] = [];
  const parts: string[] = [];
  const project = lookup.project ?? (defaultProject && !lookup.epic ? defaultProject : undefined);
  if (project) parts.push(`project = ${quote(project)}`);
  if (!lookup.project && project) notes.push(`Searching project ${project}, the one you chose in Settings.`);
  if (lookup.epic) parts.push(`parent = ${quote(lookup.epic)}`);
  if (lookup.issueTypes?.length) parts.push(`issuetype in (${lookup.issueTypes.map(quote).join(', ')})`);
  if (lookup.statuses?.length) parts.push(`status in (${lookup.statuses.map(quote).join(', ')})`);
  if (lookup.statusCategory) parts.push(`statusCategory = ${quote(lookup.statusCategory)}`);
  if (lookup.assignee === 'me') parts.push('assignee = currentUser()');
  if (lookup.assignee === 'unassigned') parts.push('assignee is EMPTY');
  let dated = false;
  for (const [field, from, to] of [['created', lookup.createdFrom, lookup.createdTo], ['updated', lookup.updatedFrom, lookup.updatedTo], ['resolutiondate', lookup.resolvedFrom, lookup.resolvedTo]] as const) {
    const f = clampDate(from, today, notes), t = clampDate(to, today, notes);
    if (f) { parts.push(`${field} >= ${quote(f)}`); dated = true; }
    if (t) { parts.push(`${field} < ${quote(addDays(t, 1))}`); dated = true; }
  }
  if (lookup.text) parts.push(`text ~ ${quote(lookup.text)}`);
  // Jira refuses queries with no restriction at all, and an unbounded question would be slow: default to the look-back window.
  if (!project && !lookup.epic && !dated) { parts.push(`updated >= ${quote(addDays(today, -LIMITS.lookbackDays))}`); notes.push(`No project or period given, so I searched the last ${LIMITS.lookbackDays} days.`); }
  return { jql: `${parts.join(' AND ')} ORDER BY ${lookup.orderBy ?? 'updated'} DESC`, notes };
}
