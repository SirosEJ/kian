import type { FastifyInstance } from 'fastify';
import type { Queryable } from '@kian/db';
import { MailConnector, MailConnectionError, MAIL_PRESETS, presetById, type MailConnection, type MailFailureReason } from '@kian/connectors';
import { decryptSecret, encryptSecret } from './routes.js';
import { reuseOrCreateConnection } from './reuse.js';

const BASE: Record<MailFailureReason, string> = {
  auth: 'The mail server rejected the email address or password. Check them.',
  'app-password': 'This provider needs an app password instead of your normal password.',
  'basic-auth-disabled': 'Your provider, or your organisation\'s administrator, has switched off password sign-in for sending email, so Kian cannot connect this mailbox with a password. Ask the administrator to allow authenticated SMTP for it, or connect another mailbox.',
  host: 'Could not reach the mail server. Check the server name.',
  blocked: 'That mail server is not allowed. Only public mail servers on the usual mail ports (25, 465, 587 or 2587) can be used.',
  input: 'Check the email address, password and server details.',
  tls: 'The secure connection to the mail server failed. Check the server, the port and the security setting.',
  timeout: 'The mail server did not respond in time. Try again shortly.',
  unknown: 'Mailbox connection failed. Check the server and the mailbox credentials.',
};
/** The reason in words, with the provider's own steps where they help (for example where a Gmail app password is created). */
export function messageFor(reason: MailFailureReason, presetId?: string): string {
  const preset = presetById(presetId);
  const help = preset && preset.id !== 'other' && (reason === 'app-password' || (reason === 'auth' && preset.appPassword)) ? ` ${preset.help}` : '';
  return `${BASE[reason]}${help}`;
}
const reasonOf = (error: unknown): MailFailureReason => (error instanceof MailConnectionError ? error.reason : 'unknown');

type Auth = (req: { headers: { authorization?: string } }) => Promise<string>;
const safe = (c: MailConnection, label: string | null) => ({ mailbox: c.user, host: c.host, port: c.port ?? 465, security: c.security ?? 'ssl', preset: c.preset ?? 'ionos', ...(label ? { presetLabel: label } : {}) });

export function registerMailConnectionRoutes(app: FastifyInstance, db: Queryable, authenticate: Auth, key: Buffer, mail = new MailConnector()) {
  async function mailbox(owner: string, id: string) {
    const row = (await db.query("SELECT secret_ciphertext FROM connections WHERE owner_id=$1 AND id=$2 AND provider IN ('ionos','mailbox') AND disconnected_at IS NULL", [owner, id])).rows[0];
    return row ? decryptSecret<MailConnection>(row.secret_ciphertext as Buffer, key) : null;
  }
  async function save(owner: string, provider: 'ionos' | 'mailbox', connection: MailConnection) {
    await db.query('INSERT INTO users(id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [owner]);
    const settings = safe(connection, presetById(connection.preset)?.label ?? null);
    // One connection per mailbox address: connecting it again refreshes the saved password and server instead of adding a second entry.
    const { id } = await reuseOrCreateConnection(db, { owner, providers: ['ionos', 'mailbox'], provider, displayName: connection.user, ciphertext: encryptSecret(connection, key), settings, sameAccount: { key: 'mailbox', value: connection.user }, refresh: settings });
    return { id, provider, displayName: connection.user, settings };
  }

  // What Settings shows in its provider list. Static data: no secrets, no per-user content.
  app.get('/connections/mailbox/presets', async req => {
    await authenticate(req);
    return MAIL_PRESETS.map(p => ({ id: p.id, label: p.label, host: p.host, port: p.port, security: p.security, appPassword: p.appPassword, help: p.help }));
  });

  // Any mailbox: a provider from the list, or "Other server".
  app.post<{ Body: { preset?: string; user?: string; password?: string; host?: string; port?: number; security?: string } }>('/connections/mailbox', async (req, reply) => {
    const owner = await authenticate(req), body = req.body || {};
    if (!presetById(body.preset)) return reply.code(422).send({ error: messageFor('input'), reason: 'input' });
    let connection: MailConnection;
    try { connection = await mail.connect(body); } catch (error) { const reason = reasonOf(error); return reply.code(422).send({ error: messageFor(reason, body.preset), reason }); }
    return reply.code(201).send(await save(owner, 'mailbox', connection));
  });

  // The original IONOS form keeps working.
  app.post<{ Body: { host?: string; user?: string; password?: string } }>('/connections/ionos', async (req, reply) => {
    const owner = await authenticate(req);
    let connection: MailConnection;
    try { connection = await mail.connect(req.body); } catch (error) { const reason = reasonOf(error); return reply.code(422).send({ error: messageFor(reason, 'ionos-uk'), reason }); }
    return reply.code(201).send(await save(owner, 'ionos', connection));
  });

  for (const prefix of ['mailbox', 'ionos']) {
    app.post<{ Params: { id: string } }>(`/connections/${prefix}/:id/test`, async (req, reply) => {
      const connection = await mailbox(await authenticate(req), req.params.id);
      if (!connection) return reply.code(404).send({ error: 'Connection not found' });
      const result = await mail.diagnose(connection);
      return result.ok ? { ok: true } : { ok: false, reason: result.reason, message: messageFor(result.reason, connection.preset) };
    });
    // A new password for the same mailbox (the server, port and security stay as saved).
    app.put<{ Params: { id: string }; Body: { password?: string } }>(`/connections/${prefix}/:id`, async (req, reply) => {
      const owner = await authenticate(req), current = await mailbox(owner, req.params.id);
      if (!current) return reply.code(404).send({ error: 'Connection not found' });
      let updated: MailConnection;
      try { updated = await mail.connect({ ...current, password: req.body?.password }); } catch (error) { const reason = reasonOf(error); return reply.code(422).send({ error: messageFor(reason, current.preset), reason }); }
      await db.query("UPDATE connections SET secret_ciphertext=$3 WHERE owner_id=$1 AND id=$2 AND provider IN ('ionos','mailbox') AND disconnected_at IS NULL", [owner, req.params.id, encryptSecret(updated, key)]);
      return { id: req.params.id, displayName: updated.user, settings: safe(updated, presetById(updated.preset)?.label ?? null) };
    });
  }
}
