import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import type { TaskProposal } from '@kian/contracts';
import { createApprovalService } from './approval.js';
import { saveProposals } from './store.js';

async function setup() {
  const db = new PGlite();
  await db.exec(await readFile(new URL('../../../../../packages/db/migrations/001_core.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../../../../../packages/db/migrations/002_conversations.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../../../../../packages/db/migrations/003_message_tasks.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../../../../../packages/db/migrations/004_message_tables.sql', import.meta.url), 'utf8'));
  await db.query("INSERT INTO users(id) VALUES ('alice'),('bob')");
  await db.query("INSERT INTO connections(id,owner_id,provider,display_name) VALUES ('mail','alice','ionos','Work mailbox'),('bob-mail','bob','ionos','Bob mailbox')");
  return { db, approvals: createApprovalService(db) };
}
let counter = 0;
const email = (to: string, uncertainties: string[] = []): TaskProposal => ({ id: `t${++counter}`, action: 'email.send', connectionId: null, destination: to, parameters: { to: [to], subject: 'Hello', body: 'Hi' }, uncertainties, state: 'proposed' }) as TaskProposal;
const stateOf = async (db: PGlite, id: string) => (await db.query<{ state: string; parameters: { trustRuleId?: string } }>('SELECT state,parameters FROM tasks WHERE id=$1', [id])).rows[0];
const events = async (db: PGlite, id: string) => (await db.query<{ event: string; details: { ruleId?: string } }>('SELECT event,details FROM activity WHERE task_id=$1 ORDER BY created_at,id', [id])).rows;

describe('proposals and trust: when Kian acts alone and when it asks', () => {
  it('asks first until the user trusts that exact action, then runs automatically only for a match', async () => {
    const { db, approvals } = await setup();
    // 1. No rule yet: every proposal waits for the user, and nothing is queued.
    const [first] = await saveProposals(db, 'alice', 'Email Sam', [email('sam@example.com')]);
    expect(first).toMatchObject({ state: 'proposed', connectionId: 'mail' });
    expect((await stateOf(db, first.id)).state).toBe('proposed');
    // 2. The user approves it and chooses to trust this connection, action and recipient.
    const approved = await approvals.decideTask('alice', first.id, 1, 'approve', { connectionId: 'mail', action: 'email.send', destinations: ['sam@example.com'] });
    expect(approved.state).toBe('queued');
    // 3. The same recipient later: queued automatically, with the rule recorded as the basis.
    const [again] = await saveProposals(db, 'alice', 'Email Sam again', [email('sam@example.com')]);
    expect(again.state).toBe('queued');
    const rule = (await db.query<{ id: string }>('SELECT id FROM trust_rules WHERE owner_id=$1', ['alice'])).rows[0];
    expect((await stateOf(db, again.id)).parameters.trustRuleId).toBe(rule.id);
    expect(await events(db, again.id)).toEqual([{ event: 'task.trusted', details: { ruleId: rule.id } }]);
    // 4. A new recipient is never covered by the rule.
    const [other] = await saveProposals(db, 'alice', 'Email Alex', [email('alex@example.com')]);
    expect(other.state).toBe('proposed');
    expect(await events(db, other.id)).toEqual([]);
    await db.close();
  });

  it('returns to review when anything is unclear, even for a trusted recipient', async () => {
    const { db, approvals } = await setup();
    const [seed] = await saveProposals(db, 'alice', 'x', [email('sam@example.com')]);
    await approvals.decideTask('alice', seed.id, 1, 'approve', { connectionId: 'mail', action: 'email.send', destinations: ['sam@example.com'] });
    const [unclear] = await saveProposals(db, 'alice', 'Email Sam about the thing', [email('sam@example.com', ['Which thing do you mean?'])]);
    expect(unclear.state).toBe('proposed');
    // Several recipients are not covered by a single-recipient rule.
    const multi = { ...email('sam@example.com'), parameters: { to: ['sam@example.com', 'pat@example.com'], subject: 'x', body: 'y' } } as TaskProposal;
    expect((await saveProposals(db, 'alice', 'Email both', [multi]))[0].state).toBe('proposed');
    await db.close();
  });

  it('never runs updates automatically, even if a rule row exists for them', async () => {
    const { db } = await setup();
    await db.query("INSERT INTO connections(id,owner_id,provider,display_name,settings) VALUES ('cal','alice','google_calendar','Calendar','{\"destination\":\"primary\"}')");
    await db.query("INSERT INTO trust_rules(id,owner_id,connection_id,action,constraints) VALUES ('r','alice','cal','calendar.update',$1)", [JSON.stringify({ destinations: ['primary'] })]);
    const update = { id: 'u1', action: 'calendar.update', connectionId: null, destination: 'primary', parameters: { eventId: 'e1', summary: 'Moved' }, uncertainties: [], state: 'proposed' } as unknown as TaskProposal;
    expect((await saveProposals(db, 'alice', 'Move the meeting', [update]))[0].state).toBe('proposed');
    await db.close();
  });

  it('stops running automatically as soon as the rule is revoked, or the connection is removed', async () => {
    const { db, approvals } = await setup();
    const [seed] = await saveProposals(db, 'alice', 'x', [email('sam@example.com')]);
    await approvals.decideTask('alice', seed.id, 1, 'approve', { connectionId: 'mail', action: 'email.send', destinations: ['sam@example.com'] });
    expect((await saveProposals(db, 'alice', 'a', [email('sam@example.com')]))[0].state).toBe('queued');
    const rule = (await approvals.listRules('alice'))[0];
    await approvals.revokeRule('alice', rule.id);
    expect((await saveProposals(db, 'alice', 'b', [email('sam@example.com')]))[0].state).toBe('proposed');
    await db.close();
  });

  it('does not decide for the user when the connection is missing or ambiguous', async () => {
    const { db } = await setup();
    // Alice has no calendar connection: nothing to choose, so the proposal has no connection and waits.
    const event = { id: 'c1', action: 'calendar.create', connectionId: null, destination: null, parameters: { summary: 'x' }, uncertainties: [], state: 'proposed' } as unknown as TaskProposal;
    expect((await saveProposals(db, 'alice', 'Book it', [event]))[0]).toMatchObject({ state: 'proposed', connectionId: null });
    // Two mailboxes and the instruction does not say which one: Kian must not pick.
    await db.query("INSERT INTO connections(id,owner_id,provider,display_name) VALUES ('mail2','alice','ionos','Second mailbox')");
    const result = await saveProposals(db, 'alice', 'Email Sam', [email('sam@example.com')]);
    expect(result[0]).toMatchObject({ state: 'proposed', connectionId: null });
    await db.close();
  });

  it('keeps each user\'s rules and connections apart', async () => {
    const { db, approvals } = await setup();
    const [seed] = await saveProposals(db, 'bob', 'x', [email('sam@example.com')]);
    await approvals.decideTask('bob', seed.id, 1, 'approve', { connectionId: 'bob-mail', action: 'email.send', destinations: ['sam@example.com'] });
    expect((await saveProposals(db, 'bob', 'again', [email('sam@example.com')]))[0].state).toBe('queued');
    // Bob trusting sam@example.com says nothing about Alice's own proposals.
    expect((await saveProposals(db, 'alice', 'same recipient', [email('sam@example.com')]))[0].state).toBe('proposed');
    await db.close();
  });

  it('rolls everything back if one proposal in the instruction cannot be stored', async () => {
    const { db } = await setup();
    const ok = email('sam@example.com');
    const broken = { ...email('x@example.com'), id: ok.id } as TaskProposal; // duplicate primary key
    await expect(saveProposals(db, 'alice', 'two tasks', [ok, broken])).rejects.toThrow();
    expect((await db.query('SELECT id FROM tasks')).rows).toEqual([]);
    expect((await db.query('SELECT id FROM instructions')).rows).toEqual([]);
    await db.close();
  });
});
