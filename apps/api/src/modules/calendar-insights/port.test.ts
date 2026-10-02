import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { encryptSecret } from '../connections/routes.js';
import { createCalendarLookupPort } from './port.js';
import type { CalendarReader } from './insights.js';

const key = randomBytes(32);
const config = { clientId: 'id', clientSecret: 'secret', redirectUri: 'https://x/', encryptionKey: key };
const tokens = (access: string, expires = Date.now() + 3600_000) => encryptSecret({ access_token: access, refresh_token: 'r', expires_at: expires }, key);
const ctx = { today: '2026-10-02', timeZone: 'Europe/London', now: new Date('2026-10-02T09:00:00Z') };
const lookups = [{ type: 'calendar.agenda' as const, from: '2026-10-03' }];

async function setup(request?: typeof fetch) {
  const db = new PGlite();
  for (const f of ['001_core.sql', '002_conversations.sql', '003_message_tasks.sql', '004_message_tables.sql']) await db.exec(await readFile(new URL(`../../../../../packages/db/migrations/${f}`, import.meta.url), 'utf8'));
  await db.query("INSERT INTO users(id) VALUES ('alice'),('bob')");
  const calls: { token: string; calendar: string }[] = [];
  const reader: CalendarReader = {
    events: async (c, calendarId) => { calls.push({ token: c.accessToken, calendar: calendarId }); return { events: [], truncated: false }; },
    details: async () => [],
    calendars: async () => [],
  };
  return { db, calls, port: createCalendarLookupPort(db, request ? { ...config, request } : config, reader) };
}
const add = (db: PGlite, id: string, owner: string, access: string, settings: object, disconnected = false, expires?: number) => db.query(`INSERT INTO connections(id,owner_id,provider,display_name,secret_ciphertext,settings${disconnected ? ',disconnected_at' : ''}) VALUES ($1,$2,'google_calendar','Google',$3,$4${disconnected ? ',now()' : ''})`, [id, owner, tokens(access, expires), JSON.stringify(settings)]);

describe('calendar lookups through the user\'s own connection', () => {
  it('reports not connected, and runs nothing, until Google Calendar is connected', async () => {
    const { db, port } = await setup();
    expect(await port.info('alice')).toEqual({ connected: false });
    expect(await port.run('alice', lookups, ctx)).toBeNull();
    await db.close();
  });

  it('uses the owner\'s token and the calendar chosen in Settings (primary otherwise)', async () => {
    const { db, port, calls } = await setup();
    await add(db, 'c1', 'alice', 'alice-token', { destination: 'team@group' });
    await add(db, 'c2', 'bob', 'bob-token', {});
    expect(await port.info('alice')).toEqual({ connected: true });
    await port.run('alice', lookups, ctx);
    await port.run('bob', lookups, ctx);
    expect(calls).toEqual([{ token: 'alice-token', calendar: 'team@group' }, { token: 'bob-token', calendar: 'primary' }]);
    await db.close();
  });

  it('ignores a disconnected connection and another user\'s connection', async () => {
    const { db, port } = await setup();
    await add(db, 'c1', 'alice', 'old', {}, true);
    await add(db, 'c2', 'bob', 'bob-token', {});
    expect((await port.info('alice')).connected).toBe(false);
    expect(await port.run('alice', lookups, ctx)).toBeNull();
    await db.close();
  });

  it('turns an expired Google login into a plain note, with no token in it', async () => {
    const { db, port } = await setup((async () => new Response('', { status: 400 })) as typeof fetch);
    await add(db, 'c1', 'alice', 'secret-token', {}, false, Date.now() - 1000);
    const outcome = await port.run('alice', lookups, ctx);
    expect(outcome?.notes[0]).toContain('Reconnect');
    expect(outcome?.tables).toEqual([]);
    expect(JSON.stringify(outcome)).not.toContain('secret-token');
    await db.close();
  });
});
