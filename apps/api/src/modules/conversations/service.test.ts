import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import type { TaskProposal } from '@kian/contracts';
import { createApprovalService } from '../tasks/approval.js';
import { ConversationError, createConversationService, LIMITS, type Plan } from './service.js';
import type { Thread } from '../tasks/plan.js';

async function setup(plan: Plan) {
  const db = new PGlite();
  for (const file of ['001_core.sql', '002_conversations.sql']) await db.exec(await readFile(new URL(`../../../../../packages/db/migrations/${file}`, import.meta.url), 'utf8'));
  await db.query("INSERT INTO users(id) VALUES ('alice'),('bob')");
  await db.query("INSERT INTO connections(id,owner_id,provider,display_name,secret_ciphertext) VALUES ('mail','alice','ionos','Work mailbox','\\x0102'),('bob-mail','bob','ionos','Bob mailbox','\\x0304')");
  return { db, service: createConversationService(db, plan), approvals: createApprovalService(db) };
}
let counter = 0;
const meeting = (start?: string): TaskProposal => ({ id: `t${++counter}`, action: 'calendar.create', connectionId: null, destination: 'primary', parameters: { summary: 'Planning', ...(start ? { start, end: start } : {}) }, uncertainties: start ? [] : ['Confirm the exact start date and time.'], state: 'proposed' }) as TaskProposal;
const input = (text: string, conversationId?: string) => ({ text, conversationId, locale: 'en-GB', timeZone: 'Europe/London' });
const stateOf = async (db: PGlite, id: string) => (await db.query<{ state: string }>('SELECT state FROM tasks WHERE id=$1', [id])).rows[0].state;

describe('conversation with Kian', () => {
  it('asks one question, then refines the same proposal instead of duplicating it', async () => {
    const seen: Thread[] = [];
    const plan: Plan = async (_o, text, _l, _t, thread) => {
      seen.push(thread);
      if (text === 'Set up a planning meeting') return { reply: 'What day and time should it start?', tasks: [meeting()], pending: 'keep' };
      return { reply: 'Booked for Friday at 3pm is ready for you to review.', tasks: [meeting('2026-10-02T15:00:00+01:00')], pending: 'replace' };
    };
    const { db, service } = await setup(plan);
    const first = await service.converse('alice', input('Set up a planning meeting'));
    expect(first.reply).toBe('What day and time should it start?');
    expect(first.tasks[0].uncertainties).toEqual(['Confirm the exact start date and time.']);
    const second = await service.converse('alice', input('Friday at 3pm', first.conversationId));
    expect(second.conversationId).toBe(first.conversationId);
    // The model saw the earlier exchange and the undecided proposal.
    expect(seen[1].history).toEqual([{ role: 'user', content: 'Set up a planning meeting' }, { role: 'assistant', content: 'What day and time should it start?' }]);
    expect(seen[1].pending).toMatchObject([{ action: 'calendar.create', uncertainties: ['Confirm the exact start date and time.'] }]);
    // Exactly one live proposal remains; the first is marked replaced and the change is in Activity.
    expect(await stateOf(db, first.tasks[0].id)).toBe('replaced');
    expect(await stateOf(db, second.tasks[0].id)).toBe('proposed');
    expect((await db.query("SELECT count(*)::int AS n FROM tasks WHERE state='proposed'")).rows[0]).toEqual({ n: 1 });
    expect((await db.query("SELECT event FROM activity WHERE task_id=$1", [first.tasks[0].id])).rows).toEqual([{ event: 'task.replaced' }]);
    const thread = await service.latest('alice');
    expect(thread.conversationId).toBe(first.conversationId);
    expect(thread.messages.map(m => `${m.role}: ${m.content}`)).toEqual(['user: Set up a planning meeting', 'assistant: What day and time should it start?', 'user: Friday at 3pm', 'assistant: Booked for Friday at 3pm is ready for you to review.']);
    await db.close();
  });

  it('answers an out-of-scope request in words, creates nothing and still remembers it', async () => {
    const { db, service } = await setup(async () => ({ reply: 'I cannot book flights, but I can create calendar events.', tasks: [], pending: 'keep' }));
    const result = await service.converse('alice', input('Book me a flight'));
    expect(result.tasks).toEqual([]);
    expect((await db.query('SELECT count(*)::int AS n FROM tasks')).rows[0]).toEqual({ n: 0 });
    expect((await service.latest('alice')).messages).toHaveLength(2);
    await db.close();
  });

  it('keeps a pending proposal when the new message is about something else', async () => {
    let n = 0;
    const { db, service } = await setup(async () => (n++ === 0 ? { reply: 'One.', tasks: [meeting('2026-10-02T15:00:00+01:00')], pending: 'keep' } : { reply: 'Two.', tasks: [meeting('2026-10-03T15:00:00+01:00')], pending: 'keep' }));
    const a = await service.converse('alice', input('first'));
    await service.converse('alice', input('second', a.conversationId));
    expect((await db.query("SELECT count(*)::int AS n FROM tasks WHERE state='proposed'")).rows[0]).toEqual({ n: 2 });
    await db.close();
  });

  it('cancelling replaces the pending proposals with nothing', async () => {
    let n = 0;
    const { db, service } = await setup(async () => (n++ === 0 ? { reply: 'One.', tasks: [meeting('2026-10-02T15:00:00+01:00')], pending: 'keep' } : { reply: 'Cancelled.', tasks: [], pending: 'replace' }));
    const a = await service.converse('alice', input('first'));
    await service.converse('alice', input('forget it', a.conversationId));
    expect(await stateOf(db, a.tasks[0].id)).toBe('replaced');
    await db.close();
  });

  it('never changes a task the user already decided, even if the model asks to replace', async () => {
    let n = 0;
    const { db, service, approvals } = await setup(async () => (n++ === 0 ? { reply: 'One.', tasks: [meeting('2026-10-02T15:00:00+01:00')], pending: 'keep' } : { reply: 'Changed.', tasks: [], pending: 'replace' }));
    const a = await service.converse('alice', input('first'));
    await db.query("UPDATE tasks SET parameters=jsonb_set(jsonb_set(parameters,'{connectionId}','\"mail\"'),'{destination}','\"primary\"') WHERE id=$1", [a.tasks[0].id]);
    await approvals.decideTask('alice', a.tasks[0].id, 1, 'reject');
    const seen = await service.converse('alice', input('change it', a.conversationId));
    expect(seen.tasks).toEqual([]);
    expect(await stateOf(db, a.tasks[0].id)).toBe('rejected');
    await db.close();
  });

  it('a replaced task cannot be approved', async () => {
    let n = 0;
    const { db, service, approvals } = await setup(async () => (n++ === 0 ? { reply: 'One.', tasks: [meeting('2026-10-02T15:00:00+01:00')], pending: 'keep' } : { reply: 'New.', tasks: [meeting('2026-10-04T15:00:00+01:00')], pending: 'replace' }));
    const a = await service.converse('alice', input('first'));
    await service.converse('alice', input('actually Sunday', a.conversationId));
    await expect(approvals.decideTask('alice', a.tasks[0].id, 1, 'approve')).rejects.toMatchObject({ statusCode: 409 });
    await db.close();
  });

  it('gives the model connection names and types only, never credentials or other users', async () => {
    let seen: Thread | undefined;
    const { db, service } = await setup(async (_o, _t, _l, _z, thread) => { seen = thread; return { reply: 'ok', tasks: [], pending: 'keep' }; });
    await service.converse('alice', input('What am I connected to?'));
    expect(seen?.connections).toEqual([{ provider: 'ionos', name: 'Work mailbox' }]);
    expect(JSON.stringify(seen)).not.toMatch(/Bob|0102|secret/);
    await db.close();
  });

  it('isolates users: another account cannot read, continue or influence a conversation', async () => {
    let seen: Thread | undefined;
    const { db, service } = await setup(async (_o, _t, _l, _z, thread) => { seen = thread; return { reply: 'Hi.', tasks: [meeting('2026-10-02T15:00:00+01:00')], pending: 'replace' }; });
    const a = await service.converse('alice', input('private plan for alice'));
    await expect(service.converse('bob', input('hello', a.conversationId))).rejects.toMatchObject({ statusCode: 404 });
    expect((await service.latest('bob'))).toEqual({ conversationId: null, messages: [] });
    // Bob's own conversation neither sees Alice's history nor can replace Alice's proposal.
    await service.converse('bob', input('hello'));
    expect(seen).toMatchObject({ history: [], pending: [] });
    expect(await stateOf(db, a.tasks[0].id)).toBe('proposed');
    expect(JSON.stringify((await service.latest('bob')).messages)).not.toContain('alice');
    await db.close();
  });

  it('deleting the account deletes its conversations and messages', async () => {
    const { db, service } = await setup(async () => ({ reply: 'Hi.', tasks: [], pending: 'keep' }));
    await service.converse('alice', input('hello'));
    await service.converse('bob', input('hello'));
    await db.query("DELETE FROM users WHERE id='alice'");
    expect((await db.query("SELECT count(*)::int AS n FROM conversations WHERE owner_id='alice'")).rows[0]).toEqual({ n: 0 });
    expect((await db.query("SELECT count(*)::int AS n FROM messages WHERE owner_id='alice'")).rows[0]).toEqual({ n: 0 });
    expect((await db.query("SELECT count(*)::int AS n FROM messages WHERE owner_id='bob'")).rows[0]).toEqual({ n: 2 });
    await db.close();
  });

  it('applies limits before calling the model, with clear messages', async () => {
    let calls = 0;
    const { db, service } = await setup(async () => { calls++; return { reply: 'ok', tasks: [], pending: 'keep' }; });
    await expect(service.converse('alice', input('x'.repeat(LIMITS.textLength + 1)))).rejects.toBeInstanceOf(ConversationError);
    expect(calls).toBe(0);
    const c = await service.create('alice');
    await db.query(`INSERT INTO messages(id,conversation_id,owner_id,role,content) SELECT 'm'||g,'${c}','alice','assistant','x' FROM generate_series(1,${LIMITS.messagesPerConversation}) g`);
    await expect(service.converse('alice', input('more', c))).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/new conversation/) });
    const d = await service.create('alice');
    await db.query(`INSERT INTO messages(id,conversation_id,owner_id,role,content) SELECT 'u'||g,'${d}','alice','user','x' FROM generate_series(1,${LIMITS.messagesPerWindow}) g`);
    await expect(service.converse('alice', input('too fast', d))).rejects.toMatchObject({ statusCode: 429 });
    // The limit is per user: Bob is unaffected.
    await service.converse('bob', input('hi'));
    expect(calls).toBe(1);
    await db.close();
  });

  it('saves nothing and keeps the earlier state when the model fails, so the user can retry', async () => {
    let fail = true;
    const { db, service } = await setup(async () => { if (fail) throw new Error('model down'); return { reply: 'ok', tasks: [], pending: 'keep' }; });
    const c = await service.create('alice');
    await expect(service.converse('alice', input('hello', c))).rejects.toThrow('model down');
    expect((await service.latest('alice')).messages).toEqual([]);
    fail = false;
    await service.converse('alice', input('hello', c));
    expect((await service.latest('alice')).messages).toHaveLength(2);
    await db.close();
  });

  it('only sends a bounded window of history', async () => {
    let seen: Thread | undefined;
    const { db, service } = await setup(async (_o, _t, _l, _z, thread) => { seen = thread; return { reply: 'ok', tasks: [], pending: 'keep' }; });
    const c = await service.create('alice');
    await db.query(`INSERT INTO messages(id,conversation_id,owner_id,role,content,created_at) SELECT 'm'||g,'${c}','alice',CASE WHEN g%2=0 THEN 'assistant' ELSE 'user' END,'msg '||g,now() - (100-g) * interval '1 second' FROM generate_series(1,60) g`);
    await service.converse('alice', input('latest', c));
    expect(seen?.history).toHaveLength(LIMITS.historyWindow);
    expect(seen?.history.at(-1)).toEqual({ role: 'assistant', content: 'msg 60' });
    await db.close();
  });
});
