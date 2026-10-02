import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { encryptSecret } from '../connections/routes.js';
import { createJiraLookupPort } from './port.js';
import type { Reader } from './insights.js';

const key = randomBytes(32);
const config = { clientId: 'id', clientSecret: 'secret', redirectUri: 'https://x/', encryptionKey: key };
const tokens = (access: string, expires = Date.now() + 3600_000) => encryptSecret({ access_token: access, refresh_token: 'r', expires_at: expires }, key);

async function setup() {
  const db = new PGlite();
  for (const f of ['001_core.sql', '002_conversations.sql', '003_message_tasks.sql', '004_message_tables.sql']) await db.exec(await readFile(new URL(`../../../../../packages/db/migrations/${f}`, import.meta.url), 'utf8'));
  await db.query("INSERT INTO users(id) VALUES ('alice'),('bob')");
  const calls: { token: string; site: string; jql?: string }[] = [];
  const reader: Reader = {
    search: async (c, jql) => { calls.push({ token: c.accessToken, site: c.siteId, jql }); return { issues: [], truncated: false }; },
    issue: async () => { throw new Error('unused'); },
  };
  return { db, calls, port: createJiraLookupPort(db, config, reader) };
}
const add = (db: PGlite, id: string, owner: string, access: string, settings: object, extra = '') => db.query(`INSERT INTO connections(id,owner_id,provider,display_name,secret_ciphertext,settings${extra ? ',disconnected_at' : ''}) VALUES ($1,$2,'jira','Jira Cloud',$3,$4${extra ? ',now()' : ''})`, [id, owner, tokens(access), JSON.stringify(settings)]);
const lookups = [{ type: 'search' as const, project: 'SFT' }];

describe('Jira lookups through the user\'s own connection', () => {
  it('reports no Jira until a site has been chosen in Settings', async () => {
    const { db, port } = await setup();
    expect(await port.info('alice')).toEqual({ connected: false, defaultProject: null });
    await add(db, 'c1', 'alice', 'a-token', {});
    expect((await port.info('alice')).connected).toBe(false);
    expect(await port.run('alice', lookups, '2026-10-02')).toBeNull();
    await db.close();
  });

  it('uses the owner\'s connection and token, and the project chosen in Settings', async () => {
    const { db, port, calls } = await setup();
    await add(db, 'c1', 'alice', 'alice-token', { siteId: 'site-a', siteUrl: 'https://a.atlassian.net', destination: 'SFT' });
    await add(db, 'c2', 'bob', 'bob-token', { siteId: 'site-b', siteUrl: 'https://b.atlassian.net', destination: 'BOB' });
    expect(await port.info('alice')).toEqual({ connected: true, defaultProject: 'SFT' });
    await port.run('alice', [{ type: 'search' }], '2026-10-02');
    await port.run('bob', [{ type: 'search' }], '2026-10-02');
    expect(calls.map(c => [c.token, c.site])).toEqual([['alice-token', 'site-a'], ['bob-token', 'site-b']]);
    expect(calls[0].jql).toContain('project = "SFT"');
    expect(calls[1].jql).toContain('project = "BOB"');
    await db.close();
  });

  it('ignores a disconnected connection and another user\'s connection', async () => {
    const { db, port } = await setup();
    await add(db, 'c1', 'alice', 'old', { siteId: 'site-a', siteUrl: 'https://a.atlassian.net' }, 'disconnected');
    await add(db, 'c2', 'bob', 'bob-token', { siteId: 'site-b', siteUrl: 'https://b.atlassian.net' });
    expect((await port.info('alice')).connected).toBe(false);
    expect(await port.run('alice', lookups, '2026-10-02')).toBeNull();
    await db.close();
  });

  it('turns an expired Jira login into a plain note instead of an error', async () => {
    const db = new PGlite();
    for (const f of ['001_core.sql', '002_conversations.sql', '003_message_tasks.sql', '004_message_tables.sql']) await db.exec(await readFile(new URL(`../../../../../packages/db/migrations/${f}`, import.meta.url), 'utf8'));
    await db.query("INSERT INTO users(id) VALUES ('alice')");
    await db.query("INSERT INTO connections(id,owner_id,provider,display_name,secret_ciphertext,settings) VALUES ('c1','alice','jira','Jira Cloud',$1,$2)", [tokens('t', Date.now() - 1000), JSON.stringify({ siteId: 's', siteUrl: 'https://a.atlassian.net' })]);
    const port = createJiraLookupPort(db, { ...config, request: (async () => new Response('', { status: 400 })) as typeof fetch }, { search: async () => ({ issues: [], truncated: false }), issue: async () => { throw new Error('unused'); } });
    const outcome = await port.run('alice', lookups, '2026-10-02');
    expect(outcome?.notes[0]).toContain('Reconnect');
    expect(outcome?.tables).toEqual([]);
    await db.close();
  });
});
