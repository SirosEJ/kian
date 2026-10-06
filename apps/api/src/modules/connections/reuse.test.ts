import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import Fastify from 'fastify';
import { MailConnector } from '@kian/connectors';
import { reuseOrCreateConnection } from './reuse.js';
import { registerMailConnectionRoutes } from './mail-routes.js';
import { registerConnectionRoutes, encryptSecret, decryptSecret } from './routes.js';

const migrationsUpTo = ['001_core', '002_conversations', '003_message_tasks', '004_message_tables', '005_memory', '006_memory_corrections'];
const migration = async () => readFile(new URL('../../../../../packages/db/migrations/007_one_connection_per_account.sql', import.meta.url), 'utf8');
async function database(withMigration = false) {
  const db = new PGlite();
  for (const name of migrationsUpTo) await db.exec(await readFile(new URL(`../../../../../packages/db/migrations/${name}.sql`, import.meta.url), 'utf8'));
  await db.query("INSERT INTO users(id) VALUES ('alice'),('bob')");
  if (withMigration) await db.exec(await migration());
  return db;
}
const key = Buffer.alloc(32, 4);
const live = async (db: PGlite, owner: string) => (await db.query<{ id: string; provider: string; settings: Record<string, unknown> }>('SELECT id,provider,settings FROM connections WHERE owner_id=$1 AND disconnected_at IS NULL ORDER BY created_at, id', [owner])).rows;

describe('connecting the same account again (SFT-353)', () => {
  it('Google Calendar: one connection per person, keeping the calendar chosen and the trusted actions', async () => {
    const db = await database();
    const first = await reuseOrCreateConnection(db, { owner: 'alice', providers: ['google_calendar'], provider: 'google_calendar', displayName: 'Google Calendar', ciphertext: encryptSecret({ refresh_token: 'r1' }, key), settings: { destination: null } });
    expect(first.reused).toBe(false);
    await db.query("UPDATE connections SET settings=jsonb_set(settings,'{destination}','\"work@sepenta.io\"') WHERE id=$1", [first.id]);
    await db.query("INSERT INTO trust_rules(id,owner_id,connection_id,action,constraints) VALUES ('rule','alice',$1,'calendar.create','{\"destinations\":[\"work@sepenta.io\"]}')", [first.id]);
    const again = await reuseOrCreateConnection(db, { owner: 'alice', providers: ['google_calendar'], provider: 'google_calendar', displayName: 'Google Calendar', ciphertext: encryptSecret({ refresh_token: 'r2' }, key), settings: { destination: null } });
    expect(again).toEqual({ id: first.id, reused: true });
    const rows = await live(db, 'alice');
    expect(rows).toHaveLength(1);
    expect(rows[0].settings.destination).toBe('work@sepenta.io');
    const secret = (await db.query<{ secret_ciphertext: Buffer }>('SELECT secret_ciphertext FROM connections WHERE id=$1', [first.id])).rows[0].secret_ciphertext;
    expect(decryptSecret<{ refresh_token: string }>(secret, key).refresh_token).toBe('r2');
    expect((await db.query<{ revoked_at: string | null }>("SELECT revoked_at FROM trust_rules WHERE id='rule'")).rows[0].revoked_at).toBeNull();
    // Another person's connection is a different one.
    expect((await reuseOrCreateConnection(db, { owner: 'bob', providers: ['google_calendar'], provider: 'google_calendar', displayName: 'Google Calendar', ciphertext: Buffer.from('b'), settings: {} })).reused).toBe(false);
    expect(await live(db, 'alice')).toHaveLength(1);
    await db.close();
  });

  it('self-heals duplicates that already exist when the person connects again: keeps the one with trusted actions, disconnects the rest', async () => {
    const db = await database();
    const add = (id: string, settings: object, at: string) => db.query("INSERT INTO connections(id,owner_id,provider,display_name,secret_ciphertext,settings,created_at) VALUES ($1,'alice','google_calendar','Google Calendar',$2,$3,$4)", [id, Buffer.from('x'), JSON.stringify(settings), at]);
    await add('old-with-trust', { destination: 'a@x.co' }, '2026-10-01T00:00:00Z');
    await add('newest', { destination: null }, '2026-10-05T00:00:00Z');
    await db.query("INSERT INTO trust_rules(id,owner_id,connection_id,action,constraints) VALUES ('r','alice','old-with-trust','calendar.create','{\"destinations\":[\"a@x.co\"]}')");
    const result = await reuseOrCreateConnection(db, { owner: 'alice', providers: ['google_calendar'], provider: 'google_calendar', displayName: 'Google Calendar', ciphertext: Buffer.from('new'), settings: {} });
    expect(result).toEqual({ id: 'old-with-trust', reused: true });
    expect((await live(db, 'alice')).map(r => r.id)).toEqual(['old-with-trust']);
    expect((await db.query<{ secret_ciphertext: Buffer | null }>("SELECT secret_ciphertext FROM connections WHERE id='newest'")).rows[0].secret_ciphertext).toBeNull();
    await db.close();
  });

  it('a mailbox is one entry per address (any letter case, IONOS or preset), another address is another entry', async () => {
    const db = await database();
    const mail = new MailConnector(() => ({ verify: async () => true, sendMail: async () => ({}), close: () => {} }), async () => [{ address: '93.184.216.34', family: 4 }]);
    const app = Fastify();
    registerMailConnectionRoutes(app, db, async () => 'alice', key, mail);
    const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload });
    const a = (await post('/connections/ionos', { host: 'smtp.ionos.co.uk', user: 'Peyman@sepenta.io', password: 'p1' })).json().id;
    const b = (await post('/connections/ionos', { host: 'smtp.ionos.co.uk', user: 'peyman@sepenta.io', password: 'p2' })).json().id;
    const c = (await post('/connections/mailbox', { preset: 'ionos-uk', user: 'peyman@sepenta.io', password: 'p3' })).json().id;
    expect([b, c]).toEqual([a, a]);
    const other = (await post('/connections/mailbox', { preset: 'gmail', user: 'peyman@gmail.com', password: 'g' })).json().id;
    expect(other).not.toBe(a);
    expect(await live(db, 'alice')).toHaveLength(2);
    const stored = (await db.query<{ secret_ciphertext: Buffer }>('SELECT secret_ciphertext FROM connections WHERE id=$1', [a])).rows[0].secret_ciphertext;
    expect(decryptSecret<{ password: string }>(stored, key).password).toBe('p3');
    await app.close(); await db.close();
  });

  it('the Google connect route leaves one entry however many times the person connects', async () => {
    const db = await database();
    const request = (async (url: string) => (String(url).includes('/token') ? Response.json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }) : Response.json({ items: [{ id: 'primary', summary: 'Main', primary: true, accessRole: 'owner' }] }))) as typeof fetch;
    const app = Fastify();
    registerConnectionRoutes(app, db, async () => 'alice', { clientId: 'id', clientSecret: 's', redirectUri: 'https://kian.example/', encryptionKey: key, request });
    for (let i = 0; i < 3; i++) {
      const state = new URL((await app.inject({ method: 'POST', url: '/connections/google/start' })).json().url).searchParams.get('state');
      expect((await app.inject({ method: 'POST', url: '/connections/google/complete', payload: { state, code: 'c' } })).statusCode).toBe(201);
    }
    expect((await live(db, 'alice')).filter(r => r.provider === 'google_calendar')).toHaveLength(1);
    await app.close(); await db.close();
  });
});

describe('the one-time clean-up of existing duplicates (migration 007)', () => {
  async function seed(db: PGlite) {
    const add = (id: string, owner: string, provider: string, name: string, settings: object, at: string) => db.query('INSERT INTO connections(id,owner_id,provider,display_name,secret_ciphertext,settings,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, owner, provider, name, Buffer.from('s'), JSON.stringify(settings), at]);
    await add('g1', 'alice', 'google_calendar', 'Google Calendar', { destination: 'me@gmail.com' }, '2026-10-01T00:00:00Z');
    await add('g2', 'alice', 'google_calendar', 'Google Calendar', { destination: null }, '2026-10-04T00:00:00Z');
    await add('m1', 'alice', 'ionos', 'peyman@sepenta.io', { mailbox: 'peyman@sepenta.io' }, '2026-10-02T00:00:00Z');
    await add('m2', 'alice', 'ionos', 'peyman@sepenta.io', { mailbox: 'Peyman@Sepenta.io' }, '2026-10-03T00:00:00Z');
    await add('m3', 'alice', 'mailbox', 'peyman@gmail.com', { mailbox: 'peyman@gmail.com' }, '2026-10-03T00:00:00Z');
    await add('j1', 'alice', 'jira', 'Jira Cloud', { siteId: 'S1', destination: 'SFT' }, '2026-10-01T00:00:00Z');
    await add('j2', 'alice', 'jira', 'Jira Cloud', { siteId: 'S1', destination: null }, '2026-10-05T00:00:00Z');
    await add('j3', 'alice', 'jira', 'Jira Cloud', { siteId: 'S2', destination: null }, '2026-10-05T00:00:00Z');
    await add('bg', 'bob', 'google_calendar', 'Google Calendar', { destination: null }, '2026-10-01T00:00:00Z');
    await db.query("INSERT INTO trust_rules(id,owner_id,connection_id,action,constraints) VALUES ('on-m1','alice','m1','email.send','{\"destinations\":[\"a@b.co\"]}'),('on-g2','alice','g2','calendar.create','{\"destinations\":[\"x\"]}')");
  }

  it('keeps one per account (trusted actions first, then a chosen calendar or site, then the newest), disconnects the rest and revokes their trust', async () => {
    const db = await database();
    await seed(db);
    await db.exec(await migration());
    // Google: g2 has a trusted action, so it wins over g1 (chosen calendar) and g1 is disconnected, trust on g2 survives.
    // Mailbox peyman@sepenta.io: m1 has the trusted action. Gmail mailbox untouched. Jira S1: j1 has a project. S2 is another site.
    expect((await live(db, 'alice')).map(r => r.id).sort()).toEqual(['g2', 'j1', 'j3', 'm1', 'm3']);
    expect((await live(db, 'bob')).map(r => r.id)).toEqual(['bg']);
    const gone = (await db.query<{ id: string; secret_ciphertext: Buffer | null; disconnected_at: string | null }>("SELECT id,secret_ciphertext,disconnected_at FROM connections WHERE id IN ('g1','m2','j2')")).rows;
    expect(gone).toHaveLength(3);
    for (const row of gone) { expect(row.secret_ciphertext, row.id).toBeNull(); expect(row.disconnected_at, row.id).not.toBeNull(); }
    const rules = (await db.query<{ id: string; revoked_at: string | null }>('SELECT id,revoked_at FROM trust_rules ORDER BY id')).rows;
    expect(rules.map(r => [r.id, r.revoked_at === null])).toEqual([['on-g2', true], ['on-m1', true]]);
    await db.close();
  });

  it('revokes trusted actions that sat on a removed duplicate, and running it again changes nothing', async () => {
    const db = await database();
    const add = (id: string, at: string) => db.query("INSERT INTO connections(id,owner_id,provider,display_name,secret_ciphertext,settings,created_at) VALUES ($1,'alice','google_calendar','Google Calendar',$2,'{}',$3)", [id, Buffer.from('s'), at]);
    await add('keep', '2026-10-05T00:00:00Z'); await add('drop', '2026-10-01T00:00:00Z');
    await db.query("INSERT INTO trust_rules(id,owner_id,connection_id,action,constraints,revoked_at) VALUES ('old-rule','alice','drop','calendar.create','{\"destinations\":[\"x\"]}',now())");
    await db.query("INSERT INTO trust_rules(id,owner_id,connection_id,action,constraints) VALUES ('live-on-drop','alice','drop','calendar.create','{\"destinations\":[\"y\"]}')");
    await db.exec(await migration());
    // The live rule made `drop` the one to keep; `keep` is the duplicate that goes.
    expect((await live(db, 'alice')).map(r => r.id)).toEqual(['drop']);
    await db.exec(await migration());
    expect((await live(db, 'alice')).map(r => r.id)).toEqual(['drop']);
    expect((await db.query<{ revoked_at: string | null }>("SELECT revoked_at FROM trust_rules WHERE id='live-on-drop'")).rows[0].revoked_at).toBeNull();
    await db.close();
  });
});
