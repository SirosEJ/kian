import { randomUUID } from 'node:crypto';
import type { Queryable } from '@kian/db';
import type { TaskProposal } from '@kian/contracts';
import type { PendingSummary, PlanResult, Thread } from '../tasks/plan.js';
import { saveProposalsIn } from '../tasks/store.js';
import { transaction } from '../transaction.js';

/** Cost and abuse limits. They are checked before the model is called. */
export const LIMITS = { textLength: 4000, messagesPerConversation: 200, historyWindow: 20, messagesPerWindow: 40, windowMinutes: 10 } as const;

export class ConversationError extends Error {
  constructor(readonly statusCode: number, message: string) { super(message); }
}

export type Plan = (ownerId: string, text: string, locale: string, timeZone: string, thread: Thread) => Promise<PlanResult>;
export type StoredMessage = { id: string; role: 'user' | 'assistant'; content: string; createdAt: string };
export type Converse = (ownerId: string, input: { text: string; conversationId?: string; locale: string; timeZone: string }) => Promise<{ conversationId: string; reply: string; tasks: TaskProposal[] }>;

/**
 * One conversation per thread, always scoped to its owner. Kian answers every message; proposals the user has not
 * decided on can be superseded by a later message of the same conversation, and nothing else is ever changed here.
 */
export function createConversationService(db: Queryable, plan: Plan) {
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

    const history = (await db.query('SELECT role,content FROM messages WHERE conversation_id=$1 ORDER BY created_at DESC, id DESC LIMIT $2', [id, LIMITS.historyWindow])).rows.reverse() as Thread['history'];
    const pendingRows = (await db.query(`SELECT t.id,t.action,t.parameters FROM tasks t JOIN instructions i ON i.id=t.instruction_id WHERE t.owner_id=$1 AND i.conversation_id=$2 AND t.state='proposed' ORDER BY t.created_at`, [ownerId, id])).rows as { id: string; action: string; parameters: { destination?: string | null; fields?: Record<string, unknown>; uncertainties?: string[] } }[];
    const pending: PendingSummary[] = pendingRows.map(r => ({ action: r.action, destination: r.parameters.destination ?? null, fields: r.parameters.fields ?? {}, uncertainties: r.parameters.uncertainties ?? [] }));
    // Names and types only: credentials and settings never reach the model.
    const connections = (await db.query('SELECT provider,display_name FROM connections WHERE owner_id=$1 AND disconnected_at IS NULL ORDER BY created_at', [ownerId])).rows.map(c => ({ provider: c.provider as string, name: c.display_name as string }));

    const result = await plan(ownerId, text, locale, timeZone, { history, pending, connections });

    return transaction(db, async client => {
      const tasks = await saveProposalsIn(client, ownerId, text, result.tasks, id);
      if (result.pending === 'replace') {
        for (const row of pendingRows) {
          // Only a still-undecided task can be superseded: a task approved in the meantime is left alone.
          const updated = await client.query(`UPDATE tasks SET state='replaced',version=version+1 WHERE owner_id=$1 AND id=$2 AND state='proposed' RETURNING id`, [ownerId, row.id]);
          if (updated.rows.length) await client.query('INSERT INTO activity(id,owner_id,task_id,event,details) VALUES ($1,$2,$3,$4,$5)', [randomUUID(), ownerId, row.id, 'task.replaced', JSON.stringify({ conversationId: id })]);
        }
      }
      await client.query(`INSERT INTO messages (id,conversation_id,owner_id,role,content,created_at) VALUES ($1,$2,$3,'user',$4,clock_timestamp()),($5,$2,$3,'assistant',$6,clock_timestamp() + interval '1 millisecond')`, [randomUUID(), id, ownerId, text, randomUUID(), result.reply]);
      await client.query('UPDATE conversations SET updated_at=now() WHERE id=$1', [id]);
      return { conversationId: id, reply: result.reply, tasks };
    });
  };

  async function latest(ownerId: string): Promise<{ conversationId: string | null; messages: StoredMessage[] }> {
    const row = (await db.query('SELECT id FROM conversations WHERE owner_id=$1 ORDER BY created_at DESC, id DESC LIMIT 1', [ownerId])).rows[0];
    if (!row) return { conversationId: null, messages: [] };
    const rows = (await db.query('SELECT id,role,content,created_at FROM messages WHERE conversation_id=$1 AND owner_id=$2 ORDER BY created_at DESC, id DESC LIMIT 100', [row.id, ownerId])).rows.reverse();
    return { conversationId: row.id, messages: rows.map(m => ({ id: m.id, role: m.role, content: m.content, createdAt: new Date(m.created_at).toISOString() })) };
  }

  return { converse, latest, create };
}
