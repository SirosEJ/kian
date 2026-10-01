import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { registerAccountRoutes } from './account.js';

async function setup(deleteIdentity = vi.fn(async () => {})) {
  const db = new PGlite();
  await db.exec(await readFile(new URL('../../../../../packages/db/migrations/001_core.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../../../../../packages/db/migrations/002_conversations.sql', import.meta.url), 'utf8'));
  await db.query("INSERT INTO users(id) VALUES ('alice'),('bob')");
  for (const owner of ['alice', 'bob']) {
    await db.query("INSERT INTO connections(id,owner_id,provider,display_name) VALUES ($1,$2,'ionos','Mailbox')", [`c-${owner}`, owner]);
    await db.query("INSERT INTO instructions(id,owner_id,corrected_text) VALUES ($1,$2,'text')", [`i-${owner}`, owner]);
    await db.query("INSERT INTO tasks(id,owner_id,action,state,parameters,instruction_id) VALUES ($1,$2,'email.send','proposed','{}',$3)", [`t-${owner}`, owner, `i-${owner}`]);
    await db.query("INSERT INTO trust_rules(id,owner_id,connection_id,action,constraints) VALUES ($1,$2,$3,'email.send','{}')", [`r-${owner}`, owner, `c-${owner}`]);
    await db.query("INSERT INTO activity(id,owner_id,task_id,event) VALUES ($1,$2,$3,'x')", [`a-${owner}`, owner, `t-${owner}`]);
  }
  const app = Fastify();
  registerAccountRoutes(app, db, async r => r.headers.authorization === 'Bearer alice' ? 'alice' : 'bob', deleteIdentity);
  return { db, app, deleteIdentity };
}
const count = async (db: PGlite, table: string, owner: string) => Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM ${table} WHERE owner_id=$1`, [owner])).rows[0].n);

describe('account deletion', () => {
  it('requires explicit confirmation', async () => {
    const { db, app, deleteIdentity } = await setup();
    const res = await app.inject({ method: 'DELETE', url: '/account', headers: { authorization: 'Bearer alice' }, payload: {} });
    expect(res.statusCode).toBe(400);
    expect(deleteIdentity).not.toHaveBeenCalled();
    expect(await count(db, 'tasks', 'alice')).toBe(1);
    await app.close(); await db.close();
  });

  it('removes only the caller\'s data and sign-in', async () => {
    const { db, app, deleteIdentity } = await setup();
    const res = await app.inject({ method: 'DELETE', url: '/account', headers: { authorization: 'Bearer alice' }, payload: { confirm: 'DELETE' } });
    expect(res.statusCode).toBe(204);
    expect(deleteIdentity).toHaveBeenCalledWith('alice');
    for (const table of ['connections', 'instructions', 'tasks', 'trust_rules', 'activity']) {
      expect(await count(db, table, 'alice')).toBe(0);
      expect(await count(db, table, 'bob')).toBe(1);
    }
    await app.close(); await db.close();
  });

  it('reports a retryable failure when sign-in removal fails', async () => {
    const { db, app } = await setup(vi.fn(async () => { throw new Error('down'); }));
    const res = await app.inject({ method: 'DELETE', url: '/account', headers: { authorization: 'Bearer alice' }, payload: { confirm: 'DELETE' } });
    expect(res.statusCode).toBe(502);
    expect(await count(db, 'tasks', 'alice')).toBe(0);
    await app.close(); await db.close();
  });
});
