import { describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { createApprovalService } from './approval.js';

async function setup() {
  const db = new PGlite();
  await db.exec(await readFile(new URL('../../../../../packages/db/migrations/001_core.sql', import.meta.url), 'utf8'));
  await db.query("INSERT INTO users(id) VALUES ('alice'),('bob')");
  await db.query("INSERT INTO tasks(id,owner_id,action,state,parameters) VALUES ('a','alice','jira.create','proposed','{\"destination\":\"SFT\",\"connectionId\":\"jira-1\",\"fields\":{\"summary\":\"A\"},\"uncertainties\":[] }'),('b','alice','email.send','proposed','{\"destination\":\"x@example.com\",\"connectionId\":\"mail-1\",\"fields\":{\"to\":[\"x@example.com\"],\"subject\":\"Hi\",\"body\":\"Hello\"},\"uncertainties\":[] }'),('c','bob','jira.create','proposed','{}')");
  return { db, service: createApprovalService(db) };
}

describe('task decisions', () => {
  it('approves and rejects separately with version checks and owner isolation', async () => {
    const { db, service } = await setup();
    await expect(service.decideTask('bob', 'a', 1, 'approve')).rejects.toMatchObject({ statusCode: 404 });
    expect((await service.decideTask('alice', 'a', 1, 'approve')).state).toBe('queued');
    expect((await service.decideTask('alice', 'b', 1, 'reject')).state).toBe('rejected');
    await expect(service.decideTask('alice', 'a', 1, 'approve')).rejects.toMatchObject({ statusCode: 409 });
    const rows = await db.query<{ id:string; state:string }>('SELECT id,state FROM tasks ORDER BY id');
    expect(rows.rows).toMatchObject([{id:'a',state:'queued'},{id:'b',state:'rejected'},{id:'c',state:'proposed'}]);
    expect((await service.listActivity('alice')).map(a => a.event)).toEqual(['task.rejected','task.approved']);
    expect(await service.listActivity('bob')).toEqual([]);
    await db.close();
  });
  it('editing a proposal increments version and invalidates prior approval', async () => {
    const { db, service } = await setup();
    const changed = await service.editTask('alice', 'a', 1, { destination:'OTHER', connectionId:'jira-1', fields:{summary:'B'}, uncertainties:[] });
    expect(changed.version).toBe(2);
    await expect(service.decideTask('alice', 'a', 1, 'approve')).rejects.toMatchObject({ statusCode: 409 });
    expect((await service.decideTask('alice', 'a', 2, 'approve')).state).toBe('queued');
    await db.close();
  });
  it('creates narrow trust only for the selected connection and recipient, then revokes it', async () => {
    const { db, service } = await setup();
    await db.query("INSERT INTO connections(id,owner_id,provider,display_name) VALUES ('mail-1','alice','ionos','Mailbox')");
    await expect(service.decideTask('alice','b',1,'approve',{ connectionId:'mail-1',action:'email.send',destinations:['other@example.com'] })).rejects.toMatchObject({ statusCode:422 });
    expect((await db.query<{state:string}>('SELECT state FROM tasks WHERE id=$1',['b'])).rows[0].state).toBe('proposed');
    await service.decideTask('alice','b',1,'approve',{ connectionId:'mail-1',action:'email.send',destinations:['x@example.com'] });
    const rules = await service.listRules('alice');
    expect(rules).toHaveLength(1);
    expect(rules[0].constraints as object).toEqual({ destinations:['x@example.com'] });
    await service.revokeRule('alice',rules[0].id);
    expect((await service.listRules('alice'))[0].revoked_at).not.toBeNull();
    await db.close();
  });
});

describe('transactions on a connection pool', () => {
  it('uses one checked-out client without reconnecting it, as pg clients reject a second connect()', async () => {
    const { db } = await setup();
    const release = vi.fn();
    const client = { query: (sql: string, params?: unknown[]) => db.query(sql, params), connect: () => { throw new Error('Client has already been connected. You cannot reuse a client.'); }, release };
    const pool = { query: (sql: string, params?: unknown[]) => db.query(sql, params), connect: async () => client };
    const service = createApprovalService(pool as never);
    expect((await service.decideTask('alice', 'a', 1, 'approve')).state).toBe('queued');
    const edited = await service.editTask('alice', 'b', 1, { destination: 'y@example.com', connectionId: 'mail-1', fields: { to: ['y@example.com'] }, uncertainties: [] });
    expect(edited.version).toBe(2);
    expect(release).toHaveBeenCalledTimes(2);
    await db.close();
  });

  it('describes activity with the task it belongs to, and never joins another user\'s task', async () => {
    const { db, service } = await setup();
    await service.decideTask('alice', 'a', 1, 'approve');
    await service.decideTask('alice', 'b', 1, 'reject');
    const alice = await service.listActivity('alice');
    expect(alice.map(a => [a.event, a.action, a.destination]).sort()).toEqual([['task.approved', 'jira.create', 'SFT'], ['task.rejected', 'email.send', 'x@example.com']]);
    // Even if an activity row pointed at someone else's task id, the other user's details must not appear.
    await db.query("INSERT INTO activity(id,owner_id,task_id,event) VALUES ('stray','bob','a','task.approved')");
    expect((await service.listActivity('bob'))[0]).toMatchObject({ id: 'stray', action: null, destination: null });
    await db.close();
  });

  it('lists trusted actions with the name of the connection they apply to', async () => {
    const { db, service } = await setup();
    await db.query("INSERT INTO connections(id,owner_id,provider,display_name) VALUES ('mail-1','alice','ionos','Work mailbox'),('bob-mail','bob','ionos','Bob mailbox')");
    await db.query("INSERT INTO trust_rules(id,owner_id,connection_id,action,constraints) VALUES ('r1','alice','mail-1','email.send',$1)", [JSON.stringify({ destinations: ['x@example.com'] })]);
    const rules = await service.listRules('alice');
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ id: 'r1', connection_name: 'Work mailbox', action: 'email.send', revoked_at: null });
    expect(rules[0].created_at).toBeTruthy();
    expect(await service.listRules('bob')).toEqual([]);
    await db.close();
  });

  it('refuses to approve a task that is missing details it cannot run without', async () => {
    const { db, service } = await setup();
    await db.query("INSERT INTO tasks(id,owner_id,action,state,parameters) VALUES ('e1','alice','email.send','proposed',$1),('e2','alice','email.send','proposed',$2),('j1','alice','jira.create','proposed',$3),('c1','alice','calendar.create','proposed',$4)", [
      JSON.stringify({ destination: 'x@example.com', connectionId: 'mail-1', fields: { to: ['x@example.com'], body: 'Hello' }, uncertainties: [] }),
      JSON.stringify({ destination: 'x@example.com', connectionId: 'mail-1', fields: { to: ['x@example.com'], subject: 'Hi', body: 'Hello' }, uncertainties: [] }),
      JSON.stringify({ destination: 'SFT', connectionId: 'jira-1', fields: { description: 'no title' }, uncertainties: [] }),
      JSON.stringify({ destination: 'primary', connectionId: 'cal', fields: { summary: 'Lunch', start: '2026-10-02T12:00:00+01:00' }, uncertainties: [] }),
    ]);
    await expect(service.decideTask('alice', 'e1', 1, 'approve')).rejects.toMatchObject({ statusCode: 422, message: expect.stringContaining('subject') });
    await expect(service.decideTask('alice', 'j1', 1, 'approve')).rejects.toMatchObject({ statusCode: 422, message: expect.stringContaining('title') });
    await expect(service.decideTask('alice', 'c1', 1, 'approve')).rejects.toMatchObject({ statusCode: 422, message: expect.stringContaining('end') });
    expect((await db.query<{ state: string }>("SELECT state FROM tasks WHERE id='e1'")).rows[0].state).toBe('proposed');
    expect((await service.decideTask('alice', 'e2', 1, 'approve')).state).toBe('queued');
    // Rejecting never needs complete details.
    expect((await service.decideTask('alice', 'e1', 1, 'reject')).state).toBe('rejected');
    await db.close();
  });
});

