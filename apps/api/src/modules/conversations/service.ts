import { randomUUID } from 'node:crypto';
import type { Queryable } from '@kian/db';
import type { TaskProposal } from '@kian/contracts';
import type { PendingSummary, PlanResult, Thread } from '../tasks/plan.js';
import type { Lookup } from '../jira-insights/lookups.js';
import type { CalendarLookup } from '../calendar-insights/lookups.js';
import type { CalendarContext } from '../calendar-insights/insights.js';
import type { LookupOutcome, ResultTable } from '../jira-insights/insights.js';
import { learnTerms, type LearnedTerm, type MemoryStore } from '../memory/store.js';
import { prepareDeletes } from '../calendar-insights/deletes.js';
import { prepareUpdates } from '../calendar-insights/updates.js';
import { prepareJiraUpdates, type IssueChecker } from '../jira-insights/updates.js';
import { prepareTransitions, type TransitionChecker } from '../jira-insights/transitions.js';
import { saveProposalsIn } from '../tasks/store.js';
import { transaction } from '../transaction.js';

/** Cost and abuse limits. They are checked before the model is called. */
export const LIMITS = { textLength: 4000, messagesPerConversation: 200, historyWindow: 20, messagesPerWindow: 40, windowMinutes: 10 } as const;

export class ConversationError extends Error {
  constructor(readonly statusCode: number, message: string) { super(message); }
}

export type Plan = (ownerId: string, text: string, locale: string, timeZone: string, thread: Thread) => Promise<PlanResult>;
export type TaskView = { id: string; action: string; state: string; version: number; connectionId: string | null; destination: string | null; parameters: Record<string, unknown>; uncertainties: string[] };
export type StoredMessage = { id: string; role: 'user' | 'assistant'; content: string; createdAt: string; tasks: TaskView[]; tables: ResultTable[] };
/** What the conversation needs from the Jira lookups: whether they are possible, and to run them. `run` returns null when no Jira site is connected. */
export type JiraLookupPort = {
  info(ownerId: string): Promise<{ connected: boolean; defaultProject: string | null }>;
  run(ownerId: string, lookups: Lookup[], today: string): Promise<LookupOutcome | null>;
  /** Asks Jira whether a proposed status change is possible now (read-only). Null when no Jira site is connected. */
  checkTransition: TransitionChecker;
  /** Looks up the issue a change would touch (exists, in the selected project). Null when Jira is not connected. */
  checkIssue?: IssueChecker;
};
export type ConversationSummary = { id: string; createdAt: string; title: string };
export type Converse = (ownerId: string, input: { text: string; conversationId?: string; locale: string; timeZone: string }) => Promise<{ conversationId: string; reply: string; tasks: TaskProposal[]; tables: ResultTable[] }>;

/**
 * One conversation per thread, always scoped to its owner. Kian answers every message; proposals the user has not
 * decided on can be superseded by a later message of the same conversation, and nothing else is ever changed here.
 */
/** What the conversation needs from the calendar lookups: whether they are possible, and to run them. `run` returns null when no Google Calendar is connected. */
export type CalendarLookupPort = {
  info(ownerId: string): Promise<{ connected: boolean }>;
  run(ownerId: string, lookups: CalendarLookup[], ctx: CalendarContext): Promise<LookupOutcome | null>;
  /** Looks up the exact event a delete would remove, with the user's own connection. Null when Google Calendar is not connected. */
  checkEvent?(ownerId: string, eventId: string, timeZone: string): Promise<EventCheck | null>;
};
export type EventCheck = { ok: true; calendarId: string; title: string; when: string; start: string; end: string; recurring: boolean } | { ok: false; reason: string };

/** Today's date (YYYY-MM-DD) where the user is, so "yesterday" means their yesterday. */
export function todayIn(timeZone: string, now = new Date()): string {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
  catch { return now.toISOString().slice(0, 10); }
}
/** "[Shown earlier: Issues: SFT-1, SFT-2]": the keys from the first column of each table, enough to refer back to them. */
export function shownNote(tables: ResultTable[] | null | undefined): string {
  const parts = (tables ?? []).flatMap(t => {
    const searched = /Searched: ([^.]*)\./.exec(t.note ?? '')?.[1];
    // Calendar rows keep their event ids (never shown on screen), so "delete it" can name the exact event; the titles are untrusted text, cut short.
    if (t.refs?.length) {
      const events = t.rows.slice(0, 10).map((r, i) => `[${t.refs![i]}] ${r[0]} ${r[1]} "${String(r[2]).slice(0, 60)}"`);
      return events.length ? [`${t.title}: ${events.join('; ')}`] : [];
    }
    const keys = t.rows.map(r => r[0]).filter(k => /^[A-Z][A-Z0-9_]+-\d+$/.test(k)).slice(0, 50);
    return keys.length ? [`${t.title}${searched ? ` (searched: ${searched})` : ''}: ${keys.join(', ')}`] : searched ? [`${t.title} (searched: ${searched}): nothing found`] : [];
  });
  return parts.length ? `\n[Shown earlier: ${parts.join('; ')}]` : '';
}
const NOT_CONNECTED = 'I could not find a connected Jira site. Connect Jira under Settings (open it from your profile at the top right) and ask me again.';
const CALENDAR_NOT_CONNECTED = 'I could not find a connected Google Calendar. Connect it under Settings (open it from your profile at the top right) and ask me again.';

export function createConversationService(db: Queryable, plan: Plan, jira?: JiraLookupPort, calendar?: CalendarLookupPort, memory?: MemoryStore) {
  async function ownedConversation(ownerId: string, conversationId: string): Promise<string> {
    const row = (await db.query('SELECT id FROM conversations WHERE id=$1 AND owner_id=$2', [conversationId, ownerId])).rows[0];
    if (!row) throw new ConversationError(404, 'Conversation not found');
    return conversationId;
  }
  async function create(ownerId: string): Promise<string> {
    await db.query('INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [ownerId]);
    const id = randomUUID();
    await db.query('INSERT INTO conversations (id,owner_id) VALUES ($1,$2)', [id, ownerId]);
    return id;
  }

  const converse: Converse = async (ownerId, { text, conversationId, locale, timeZone }) => {
    if (text.length > LIMITS.textLength) throw new ConversationError(400, `Messages can be up to ${LIMITS.textLength} characters. Please shorten it.`);
    await db.query('INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [ownerId]);
    const id = conversationId ? await ownedConversation(ownerId, conversationId) : await create(ownerId);
    const recent = Number((await db.query(`SELECT count(*) AS n FROM messages WHERE owner_id=$1 AND role='user' AND created_at > now() - ($2 || ' minutes')::interval`, [ownerId, String(LIMITS.windowMinutes)])).rows[0].n);
    if (recent >= LIMITS.messagesPerWindow) throw new ConversationError(429, 'You are sending messages very quickly. Wait a few minutes and try again.');
    const total = Number((await db.query('SELECT count(*) AS n FROM messages WHERE conversation_id=$1', [id])).rows[0].n);
    if (total >= LIMITS.messagesPerConversation) throw new ConversationError(409, 'This conversation is very long. Start a new conversation to continue.');

    // A reply that showed Jira tables remembers which issues they held, so a follow-up ("who created them?") can look those issues up again.
    const history = (await db.query('SELECT role,content,attachments FROM messages WHERE conversation_id=$1 ORDER BY created_at DESC, id DESC LIMIT $2', [id, LIMITS.historyWindow])).rows.reverse()
      .map((m: { role: 'user' | 'assistant'; content: string; attachments: ResultTable[] }) => ({ role: m.role, content: m.role === 'assistant' ? `${m.content}${shownNote(m.attachments)}` : m.content })) as Thread['history'];
    const pendingRows = (await db.query(`SELECT t.id,t.action,t.parameters FROM tasks t JOIN instructions i ON i.id=t.instruction_id WHERE t.owner_id=$1 AND i.conversation_id=$2 AND t.state='proposed' ORDER BY t.created_at`, [ownerId, id])).rows as { id: string; action: string; parameters: { destination?: string | null; fields?: Record<string, unknown>; uncertainties?: string[] } }[];
    const pending: PendingSummary[] = pendingRows.map(r => ({ action: r.action, destination: r.parameters.destination ?? null, fields: r.parameters.fields ?? {}, uncertainties: r.parameters.uncertainties ?? [] }));
    // Names and types only: credentials and settings never reach the model.
    const connections = (await db.query('SELECT provider,display_name FROM connections WHERE owner_id=$1 AND disconnected_at IS NULL ORDER BY created_at', [ownerId])).rows.map(c => ({ provider: c.provider as string, name: c.display_name as string }));

    const jiraInfo = jira ? await jira.info(ownerId) : { connected: false, defaultProject: null };
    const calendarInfo = calendar ? await calendar.info(ownerId) : { connected: false };
    // What Kian remembers that matters for this message and the one before it (names, projects, epics, spoken-form corrections).
    const lastUser = [...history].reverse().find(m => m.role === 'user')?.content;
    const hints = memory ? await memory.relevant(ownerId, lastUser ? [text, lastUser] : [text]) : [];
    const thread: Thread = { history, pending, connections, jira: jiraInfo, calendar: calendarInfo, ...(hints.length ? { memory: hints } : {}) };
    let result = await plan(ownerId, text, locale, timeZone, thread);
    const toldByUser: LearnedTerm[] = result.learn ?? [];
    let learnedFromJira: LearnedTerm[] = [], learnedFromCalendar: LearnedTerm[] = [];
    let tables: ResultTable[] = [];
    let lookedUp: { issues: number; types: string[] } | null = null;
    let calendarLookedUp: { events: number } | null = null;
    const jiraAsked = result.lookups?.length && jira ? result.lookups : [];
    const calendarAsked = result.calendarLookups?.length && calendar ? result.calendarLookups : [];
    if (jiraAsked.length || calendarAsked.length) {
      // A lookup turn only reads and answers: proposals are never created or replaced here.
      const today = todayIn(timeZone);
      const jiraOutcome = jiraAsked.length ? await jira!.run(ownerId, jiraAsked, today) : null;
      const calendarOutcome = calendarAsked.length ? await calendar!.run(ownerId, calendarAsked, { today, timeZone: timeZone || 'UTC', now: new Date() }) : null;
      const outcomes = [jiraOutcome, calendarOutcome].filter((o): o is LookupOutcome => !!o);
      if (!outcomes.length) result = { reply: jiraAsked.length ? NOT_CONNECTED : CALENDAR_NOT_CONNECTED, tasks: [], pending: 'keep', lookups: [] };
      else {
        const digest = outcomes.flatMap(o => o.digest);
        const answer = await plan(ownerId, text, locale, timeZone, { ...thread, lookupResults: digest });
        const notes = [...new Set(outcomes.flatMap(o => o.notes))].join(' ');
        learnedFromJira = jiraOutcome?.learned ?? [];
        learnedFromCalendar = calendarOutcome?.learned ?? [];
        if (jiraOutcome) lookedUp = { issues: jiraOutcome.issuesRead, types: [...new Set(jiraOutcome.digest.map(d => String((d as { type?: unknown }).type)))] };
        if (calendarOutcome) calendarLookedUp = { events: calendarOutcome.issuesRead };
        result = { reply: [answer.reply, notes].filter(Boolean).join('\n\n').slice(0, 3000), tasks: [], pending: 'keep', lookups: [] };
        tables = outcomes.flatMap(o => o.tables);
      }
    }

    // Status changes are checked with Jira before they can be approved: current status, title, project, and whether Jira offers the move.
    if (result.tasks.some(t => t.action === 'jira.transition')) result = { ...result, tasks: await prepareTransitions(jira?.checkTransition, ownerId, result.tasks, jiraInfo.defaultProject) };

    // Changes to existing issues and events are checked first: the card shows what they are now next to what they will become.
    if (result.tasks.some(t => t.action === 'jira.update')) result = { ...result, tasks: await prepareJiraUpdates(jira?.checkIssue, ownerId, result.tasks, jiraInfo.defaultProject) };
    if (result.tasks.some(t => t.action === 'calendar.update')) result = { ...result, tasks: await prepareUpdates(calendar, ownerId, result.tasks, timeZone || 'UTC') };
    // Deletes are checked with Google first: the card shows the real title, time and calendar of the event it would remove.
    if (result.tasks.some(t => t.action === 'calendar.delete')) result = { ...result, tasks: await prepareDeletes(calendar, ownerId, result.tasks, timeZone || 'UTC') };

    return transaction(db, async client => {
      const tasks = await saveProposalsIn(client, ownerId, text, result.tasks, id);
      // What was read is logged by count only: issue contents never go into Activity.
      if (lookedUp) await client.query('INSERT INTO activity(id,owner_id,task_id,event,details) VALUES ($1,$2,NULL,$3,$4)', [randomUUID(), ownerId, 'jira.lookup', JSON.stringify(lookedUp)]);
      // Names the lookups revealed and the user's own corrections go into their memory (a count is logged, never the names).
      if (memory) {
        const added = (await learnTerms(client, ownerId, learnedFromJira, 'jira')) + (await learnTerms(client, ownerId, learnedFromCalendar, 'calendar')) + (await learnTerms(client, ownerId, toldByUser, 'chat'));
        if (added > 0) await client.query('INSERT INTO activity(id,owner_id,task_id,event,details) VALUES ($1,$2,NULL,$3,$4)', [randomUUID(), ownerId, 'memory.learned', JSON.stringify({ terms: added })]);
      }
      if (calendarLookedUp) await client.query('INSERT INTO activity(id,owner_id,task_id,event,details) VALUES ($1,$2,NULL,$3,$4)', [randomUUID(), ownerId, 'calendar.lookup', JSON.stringify(calendarLookedUp)]);
      if (result.pending === 'replace') {
        for (const row of pendingRows) {
          // Only a still-undecided task can be superseded: a task approved in the meantime is left alone.
          const updated = await client.query(`UPDATE tasks SET state='replaced',version=version+1 WHERE owner_id=$1 AND id=$2 AND state='proposed' RETURNING id`, [ownerId, row.id]);
          if (updated.rows.length) await client.query('INSERT INTO activity(id,owner_id,task_id,event,details) VALUES ($1,$2,$3,$4,$5)', [randomUUID(), ownerId, row.id, 'task.replaced', JSON.stringify({ conversationId: id })]);
        }
      }
      await client.query(`INSERT INTO messages (id,conversation_id,owner_id,role,content,task_ids,attachments,created_at) VALUES ($1,$2,$3,'user',$4,'[]','[]',clock_timestamp()),($5,$2,$3,'assistant',$6,$7,$8,clock_timestamp() + interval '1 millisecond')`, [randomUUID(), id, ownerId, text, randomUUID(), result.reply, JSON.stringify(tasks.map(t => t.id)), JSON.stringify(tables)]);
      await client.query('UPDATE conversations SET updated_at=now() WHERE id=$1', [id]);
      return { conversationId: id, reply: result.reply, tasks, tables };
    });
  };

  async function view(ownerId: string, conversationId: string): Promise<{ conversationId: string; messages: StoredMessage[] }> {
    const rows = (await db.query('SELECT id,role,content,task_ids,attachments,created_at FROM messages WHERE conversation_id=$1 AND owner_id=$2 ORDER BY created_at DESC, id DESC LIMIT 100', [conversationId, ownerId])).rows.reverse();
    const ids = [...new Set(rows.flatMap(m => m.task_ids as string[]))];
    // Current state of each task, so a card shows approved, rejected or replaced as it is now.
    const found = ids.length ? (await db.query('SELECT id,action,state,parameters,version FROM tasks WHERE owner_id=$1 AND id = ANY($2::text[])', [ownerId, ids])).rows : [];
    const byId = new Map<string, TaskView>(found.map(t => [t.id as string, { id: t.id, action: t.action, state: t.state, version: t.version, connectionId: t.parameters.connectionId ?? null, destination: t.parameters.destination ?? null, parameters: t.parameters.fields ?? {}, uncertainties: t.parameters.uncertainties ?? [] }]));
    return { conversationId, messages: rows.map(m => ({ id: m.id, role: m.role, content: m.content, createdAt: new Date(m.created_at).toISOString(), tasks: (m.task_ids as string[]).map(id => byId.get(id)).filter((t): t is TaskView => !!t), tables: (m.attachments ?? []) as ResultTable[] })) };
  }

  async function latest(ownerId: string): Promise<{ conversationId: string | null; messages: StoredMessage[] }> {
    const row = (await db.query('SELECT id FROM conversations WHERE owner_id=$1 ORDER BY created_at DESC, id DESC LIMIT 1', [ownerId])).rows[0];
    return row ? view(ownerId, row.id) : { conversationId: null, messages: [] };
  }

  async function get(ownerId: string, conversationId: string) {
    return view(ownerId, await ownedConversation(ownerId, conversationId));
  }

  /** Past conversations, newest first, each named by what the user first said. Empty ones are left out. */
  async function list(ownerId: string): Promise<ConversationSummary[]> {
    const rows = (await db.query(`SELECT c.id,c.created_at,(SELECT content FROM messages m WHERE m.conversation_id=c.id AND m.role='user' ORDER BY m.created_at,m.id LIMIT 1) AS first FROM conversations c WHERE c.owner_id=$1 AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id=c.id) ORDER BY c.created_at DESC, c.id DESC LIMIT 30`, [ownerId])).rows;
    return rows.map(r => ({ id: r.id, createdAt: new Date(r.created_at).toISOString(), title: String(r.first ?? 'Conversation').replace(/\s+/g, ' ').slice(0, 80) }));
  }

  return { converse, latest, get, list, create };
}
