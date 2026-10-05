import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { registerTeamsConnectionRoutes, getTeamsAccessToken } from './teams-routes.js';
import { registerConnectionRoutes, encryptSecret, decryptSecret } from './routes.js';

const migrations = ['001_core', '002_conversations', '003_message_tasks', '004_message_tables', '005_memory', '006_memory_corrections', '007_teams'];
async function database() {
  const db = new PGlite();
  for (const name of migrations) await db.exec(await readFile(new URL(`../../../../../packages/db/migrations/${name}.sql`, import.meta.url), 'utf8'));
  return db;
}
const key = Buffer.alloc(32, 7);
const config = (request: typeof fetch) => ({ clientId: 'cid', clientSecret: 'topsecret', redirectUri: 'https://kian.example/', encryptionKey: key, request });
const who = async (req: { headers: { authorization?: string } }) => (req.headers.authorization === 'alice' ? 'alice' : 'bob');

function microsoft(overrides: { token?: () => Response; me?: () => Response } = {}) {
  return vi.fn(async (url: string) => {
    if (url.includes('/oauth2/v2.0/token')) return overrides.token ? overrides.token() : Response.json({ access_token: 'private-access', refresh_token: 'private-refresh', expires_in: 3600 });
    if (url.includes('/me')) return overrides.me ? overrides.me() : Response.json({ displayName: 'Alice Smith', userPrincipalName: 'alice@sepenta.io' });
    return new Response('', { status: 404 });
  });
}

describe('Microsoft Teams connection', () => {
  it('signs in with PKCE, binds the sign-in to the user, stores tokens encrypted and shows only the account name', async () => {
    const db = await database(), mock = microsoft(), app = Fastify();
    registerTeamsConnectionRoutes(app, db, who, config(mock as unknown as typeof fetch));
    const start = await app.inject({ method: 'POST', url: '/connections/teams/start', headers: { authorization: 'alice' } });
    const url = new URL(start.json().url);
    expect(url.hostname).toBe('login.microsoftonline.com');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(start.body).not.toContain('topsecret');
    const state = url.searchParams.get('state')!;
    expect(state.startsWith('teams_')).toBe(true);
    // Another signed-in user cannot finish Alice's sign-in.
    expect((await app.inject({ method: 'POST', url: '/connections/teams/complete', headers: { authorization: 'bob' }, payload: { state, code: 'c' } })).statusCode).toBe(403);
    const done = await app.inject({ method: 'POST', url: '/connections/teams/complete', headers: { authorization: 'alice' }, payload: { state, code: 'c' } });
    expect(done.statusCode).toBe(201);
    expect(done.json()).toMatchObject({ provider: 'teams', accountName: 'Alice Smith' });
    expect(done.body).not.toMatch(/private-access|private-refresh|topsecret/);
    // The verifier was sent to Microsoft and is gone from the database afterwards; the sign-in cannot be reused.
    const tokenCall = mock.mock.calls.find(([u]) => String(u).includes('/token'))!;
    expect(String((tokenCall as unknown[])[1] && ((tokenCall as unknown[])[1] as RequestInit).body)).toContain('code_verifier=');
    expect((await db.query('SELECT code_verifier FROM oauth_states WHERE state=$1', [state])).rows[0]).toEqual({ code_verifier: null });
    expect((await app.inject({ method: 'POST', url: '/connections/teams/complete', headers: { authorization: 'alice' }, payload: { state, code: 'c' } })).statusCode).toBe(400);
    const row = (await db.query('SELECT secret_ciphertext, settings FROM connections WHERE owner_id=$1', ['alice'])).rows[0] as { secret_ciphertext: Buffer; settings: Record<string, string> };
    expect(row.secret_ciphertext.toString('utf8')).not.toContain('private-refresh');
    expect(decryptSecret<{ refresh_token: string }>(row.secret_ciphertext, key).refresh_token).toBe('private-refresh');
    expect(JSON.stringify(row.settings)).not.toMatch(/private|token/);
    await db.close();
  });

  it('explains a missing administrator approval in plain words and saves nothing', async () => {
    const db = await database(), app = Fastify();
    registerTeamsConnectionRoutes(app, db, who, config(microsoft({ token: () => Response.json({ error: 'invalid_grant', error_description: 'AADSTS65001: The user or administrator has not consented to use the application' }, { status: 400 }) }) as unknown as typeof fetch));
    const state = new URL((await app.inject({ method: 'POST', url: '/connections/teams/start', headers: { authorization: 'alice' } })).json().url).searchParams.get('state')!;
    const done = await app.inject({ method: 'POST', url: '/connections/teams/complete', headers: { authorization: 'alice' }, payload: { state, code: 'c' } });
    expect(done.statusCode).toBe(422);
    expect(done.json()).toMatchObject({ adminConsent: true });
    expect(done.json().error).toMatch(/administrator/);
    expect((await db.query("SELECT 1 FROM connections WHERE provider='teams'")).rows).toHaveLength(0);
    await db.close();
  });

  it('refreshes an expired token, keeps the rotated refresh token, and says to reconnect when Microsoft refuses', async () => {
    const db = await database();
    await db.query("INSERT INTO users(id) VALUES ('alice')");
    await db.query("INSERT INTO connections(id,owner_id,provider,display_name,secret_ciphertext,settings) VALUES ('t1','alice','teams','Microsoft Teams',$1,'{}')", [encryptSecret({ access_token: 'old', refresh_token: 'r0', expires_at: 1 }, key)]);
    const rotated = microsoft({ token: () => Response.json({ access_token: 'fresh', refresh_token: 'r1', expires_in: 3600 }) });
    expect(await getTeamsAccessToken(db, 'alice', 't1', config(rotated as unknown as typeof fetch))).toBe('fresh');
    const row = (await db.query('SELECT secret_ciphertext FROM connections WHERE id=$1', ['t1'])).rows[0] as { secret_ciphertext: Buffer };
    expect(decryptSecret<{ refresh_token: string }>(row.secret_ciphertext, key).refresh_token).toBe('r1');
    await db.query('UPDATE connections SET secret_ciphertext=$1 WHERE id=$2', [encryptSecret({ access_token: 'old', refresh_token: 'r1', expires_at: 1 }, key), 't1']);
    const refused = microsoft({ token: () => Response.json({ error: 'invalid_grant', error_description: 'AADSTS700082: The refresh token has expired' }, { status: 400 }) });
    await expect(getTeamsAccessToken(db, 'alice', 't1', config(refused as unknown as typeof fetch))).rejects.toMatchObject({ statusCode: 422, message: expect.stringMatching(/Reconnect in Settings/) });
    await db.close();
  });

  it('tests the connection, never lets another user use it, and forgets the tokens on disconnect', async () => {
    const db = await database(), app = Fastify(), cfg = config(microsoft() as unknown as typeof fetch);
    registerTeamsConnectionRoutes(app, db, who, cfg);
    registerConnectionRoutes(app, db, who, cfg);
    const state = new URL((await app.inject({ method: 'POST', url: '/connections/teams/start', headers: { authorization: 'alice' } })).json().url).searchParams.get('state')!;
    const id = (await app.inject({ method: 'POST', url: '/connections/teams/complete', headers: { authorization: 'alice' }, payload: { state, code: 'c' } })).json().id as string;
    const test = await app.inject({ method: 'POST', url: `/connections/teams/${id}/test`, headers: { authorization: 'alice' } });
    expect(test.json()).toMatchObject({ ok: true, accountName: 'Alice Smith' });
    expect((await app.inject({ method: 'POST', url: `/connections/teams/${id}/test`, headers: { authorization: 'bob' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/connections', headers: { authorization: 'bob' } })).json()).toEqual([]);
    const listed = (await app.inject({ method: 'GET', url: '/connections', headers: { authorization: 'alice' } })).body;
    expect(listed).toContain('Microsoft Teams');
    expect(listed).not.toMatch(/private-access|private-refresh|secret_ciphertext/);
    expect((await app.inject({ method: 'DELETE', url: `/connections/${id}`, headers: { authorization: 'bob' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/connections/${id}`, headers: { authorization: 'alice' } })).statusCode).toBe(204);
    expect((await db.query('SELECT secret_ciphertext FROM connections WHERE id=$1', [id])).rows[0]).toEqual({ secret_ciphertext: null });
    expect((await app.inject({ method: 'POST', url: `/connections/teams/${id}/test`, headers: { authorization: 'alice' } })).statusCode).toBe(404);
    await db.close();
  });

  it('connecting again replaces the earlier Teams connection of the same user', async () => {
    const db = await database(), app = Fastify();
    registerTeamsConnectionRoutes(app, db, who, config(microsoft() as unknown as typeof fetch));
    for (let i = 0; i < 2; i++) {
      const state = new URL((await app.inject({ method: 'POST', url: '/connections/teams/start', headers: { authorization: 'alice' } })).json().url).searchParams.get('state')!;
      await app.inject({ method: 'POST', url: '/connections/teams/complete', headers: { authorization: 'alice' }, payload: { state, code: 'c' } });
    }
    expect((await db.query("SELECT 1 FROM connections WHERE provider='teams' AND disconnected_at IS NULL")).rows).toHaveLength(1);
    await db.close();
  });
});
