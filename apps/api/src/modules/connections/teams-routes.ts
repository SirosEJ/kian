import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Queryable } from '@kian/db';
import { needsAdminConsent, TeamsConnector, TeamsError } from '@kian/connectors';
import { encryptSecret, decryptSecret, type GoogleConfig } from './routes.js';

/** `tenant` is "organizations" (any work or school account) unless the company pins Kian to one directory. */
export type TeamsConfig = GoogleConfig & { tenant?: string };
type Tokens = { access_token: string; refresh_token: string; expires_at: number };
const error = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
const ADMIN_NEEDED = 'Microsoft needs an administrator of your organisation to approve Kian before you can connect. Ask your Microsoft 365 admin to approve it, then try again.';

/** A valid access token for the user's own Teams connection; refreshed (and the rotated refresh token saved) when it is about to expire. */
export async function getTeamsAccessToken(db: Queryable, owner: string, id: string, config: TeamsConfig, teams = new TeamsConnector(config.request)): Promise<string> {
  const row = (await db.query("SELECT secret_ciphertext FROM connections WHERE owner_id=$1 AND id=$2 AND provider='teams' AND disconnected_at IS NULL", [owner, id])).rows[0];
  if (!row) throw error(404, 'Connection not found');
  const tokens = decryptSecret<Tokens>(row.secret_ciphertext, config.encryptionKey);
  if (tokens.expires_at && tokens.expires_at > Date.now() + 60000) return tokens.access_token;
  const fresh = await teams.refresh({ tenant: config.tenant || 'organizations', clientId: config.clientId, clientSecret: config.clientSecret, refreshToken: tokens.refresh_token });
  if (!fresh.access_token) throw error(422, needsAdminConsent(fresh.error_description) ? ADMIN_NEEDED : 'Microsoft access expired. Reconnect in Settings.');
  const updated: Tokens = { access_token: fresh.access_token, refresh_token: fresh.refresh_token || tokens.refresh_token, expires_at: Date.now() + (fresh.expires_in || 3600) * 1000 };
  await db.query('UPDATE connections SET secret_ciphertext=$3 WHERE owner_id=$1 AND id=$2 AND disconnected_at IS NULL', [owner, id, encryptSecret(updated, config.encryptionKey)]);
  return updated.access_token;
}

export function registerTeamsConnectionRoutes(app: FastifyInstance, db: Queryable, authenticate: (req: { headers: { authorization?: string } }) => Promise<string>, config: TeamsConfig) {
  const teams = new TeamsConnector(config.request), tenant = config.tenant || 'organizations';
  app.post('/connections/teams/start', async req => {
    const owner = await authenticate(req), state = `teams_${randomBytes(32).toString('base64url')}`;
    const verifier = randomBytes(48).toString('base64url'), challenge = createHash('sha256').update(verifier).digest('base64url');
    await db.query('INSERT INTO users(id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [owner]);
    await db.query("INSERT INTO oauth_states(state,owner_id,provider,expires_at,code_verifier) VALUES ($1,$2,'teams',now()+interval '10 minutes',$3)", [state, owner, verifier]);
    return { url: teams.authorizeUrl({ tenant, clientId: config.clientId, redirectUri: config.redirectUri, state, challenge }) };
  });
  app.post<{ Body: { state?: string; code?: string } }>('/connections/teams/complete', async (req, reply) => {
    const owner = await authenticate(req), { state, code } = req.body || {};
    if (!state || !code || state.length > 128 || code.length > 4096) return reply.code(400).send({ error: 'Invalid authorization response' });
    const record = (await db.query("SELECT owner_id,expires_at,used_at,code_verifier FROM oauth_states WHERE state=$1 AND provider='teams'", [state])).rows[0];
    if (!record || record.used_at || new Date(record.expires_at).getTime() <= Date.now()) return reply.code(400).send({ error: 'Authorization expired or used' });
    if (record.owner_id !== owner) return reply.code(403).send({ error: 'Authorization belongs to another user' });
    const used = await db.query('UPDATE oauth_states SET used_at=now(), code_verifier=NULL WHERE state=$1 AND owner_id=$2 AND used_at IS NULL AND expires_at>now() RETURNING state', [state, owner]);
    if (!used.rows.length) return reply.code(400).send({ error: 'Authorization already used' });
    const tokens = await teams.exchangeCode({ tenant, clientId: config.clientId, clientSecret: config.clientSecret, redirectUri: config.redirectUri, code, verifier: String(record.code_verifier || '') });
    if (!tokens.access_token) return reply.code(needsAdminConsent(tokens.error_description) ? 422 : 502).send({ error: needsAdminConsent(tokens.error_description) ? ADMIN_NEEDED : 'Microsoft authorization failed', adminConsent: needsAdminConsent(tokens.error_description) });
    if (!tokens.refresh_token) return reply.code(502).send({ error: 'Microsoft did not provide offline access' });
    let account;
    try { account = await teams.account({ accessToken: tokens.access_token }); } catch { return reply.code(502).send({ error: 'Microsoft sign-in worked but your account could not be read' }); }
    const id = randomUUID(), saved: Tokens = { access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_at: Date.now() + (tokens.expires_in || 3600) * 1000 };
    // Connecting again replaces the earlier Teams connection of this user instead of leaving two.
    await db.query("UPDATE connections SET secret_ciphertext=NULL, disconnected_at=now() WHERE owner_id=$1 AND provider='teams' AND disconnected_at IS NULL", [owner]);
    await db.query("INSERT INTO connections(id,owner_id,provider,display_name,secret_ciphertext,settings) VALUES ($1,$2,'teams','Microsoft Teams',$3,$4)", [id, owner, encryptSecret(saved, config.encryptionKey), JSON.stringify({ accountName: account.name, account: account.account })]);
    return reply.code(201).send({ id, provider: 'teams', displayName: 'Microsoft Teams', accountName: account.name, account: account.account });
  });
  app.post<{ Params: { id: string } }>('/connections/teams/:id/test', async req => {
    const owner = await authenticate(req), token = await getTeamsAccessToken(db, owner, req.params.id, config, teams);
    try { const account = await teams.account({ accessToken: token }); return { ok: true, accountName: account.name, account: account.account }; }
    catch (e) {
      if (e instanceof TeamsError && e.code === 'expired') throw error(422, 'Microsoft access expired. Reconnect in Settings.');
      if (e instanceof TeamsError && e.code === 'forbidden') throw error(422, ADMIN_NEEDED);
      if (e instanceof TeamsError && e.code === 'rate-limited') throw error(429, 'Microsoft is busy. Try again in a minute.');
      throw error(502, 'Microsoft could not be reached. Try again.');
    }
  });
}
