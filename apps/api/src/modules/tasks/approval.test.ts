import { describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { createApprovalService } from './approval.js';

async function setup() {
  const db = new PGlite();
  await db.exec(await readFile(new URL('../../../../../packages/db/migrations/001_core.sql', import.meta.url), 'utf8'));
  await db.query("INSERT INTO users(id) VALUES ('alice'),('bob')");
  await db.query("INSERT INTO tasks(id,owner_id,action,state,parameters) VALUES ('a','alice','jira.create','proposed','{\"destination\":\"SFT\",\"connectionId\":\"jira-1\",\"fields\":{\"summary\":\"A\"},\"uncertainties\":[] }'),('b','alice','email.send','proposed','{\"destination\":\"x@example.com\",\"connectionId\":\"mail-1\",\"fields\":{\"to\":[\"x@example.com\"]},\"uncertainties\":[] }'),('c','bob','jira.create','proposed','{}')");
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
});

