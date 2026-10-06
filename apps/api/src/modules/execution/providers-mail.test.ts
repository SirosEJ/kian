import { describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { MailConnector, type MailTarget } from '@kian/connectors';
import { createProviderExecutor } from './providers.js';
import { encryptSecret } from '../connections/routes.js';

const key = Buffer.alloc(32, 5);
async function setup() {
  const db = new PGlite();
  for (const f of ['001_core', '002_conversations', '003_message_tasks', '004_message_tables']) await db.exec(await readFile(new URL(`../../../../../packages/db/migrations/${f}.sql`, import.meta.url), 'utf8'));
  await db.query("INSERT INTO users(id) VALUES ('alice'),('bob')");
  const add = (id: string, owner: string, provider: string, secret: object) => db.query('INSERT INTO connections(id,owner_id,provider,display_name,secret_ciphertext,settings) VALUES ($1,$2,$3,$1,$4,$5)', [id, owner, provider, encryptSecret(secret, key), '{}']);
  await add('gmail', 'alice', 'mailbox', { preset: 'gmail', host: 'smtp.gmail.com', port: 465, security: 'ssl', user: 'me@gmail.com', password: 'app-pass' });
  await add('outlook', 'alice', 'mailbox', { preset: 'outlook', host: 'smtp-mail.outlook.com', port: 587, security: 'starttls', user: 'me@outlook.com', password: 'app-pass' });
  await add('old-ionos', 'alice', 'ionos', { host: 'smtp.ionos.co.uk', user: 'me@sepenta.io', password: 'pw' });
  await add('bobs', 'bob', 'mailbox', { preset: 'gmail', host: 'smtp.gmail.com', port: 465, security: 'ssl', user: 'bob@gmail.com', password: 'bobs-pass' });
  return db;
}
const task = (connectionId: string, to = ['sam@example.com']) => ({ id: 't', owner_id: 'alice', action: 'email.send', state: 'queued', version: 1, parameters: { connectionId, destination: to[0], fields: { to, subject: 'Hello', body: 'Body' }, uncertainties: [] } }) as never;

describe('sending email through any connected mailbox (SFT-341)', () => {
  it('sends from the mailbox the card chose, through that provider\'s server: Gmail, Outlook and an older IONOS mailbox', async () => {
    const db = await setup();
    const used: { from: string; target: MailTarget }[] = [];
    const mail = new MailConnector((connection, target) => ({ verify: async () => true, close: () => {}, sendMail: async (m: { to: string[] }) => { used.push({ from: connection.user, target }); return { accepted: m.to, rejected: [], messageId: 'm' }; } }));
    const execute = createProviderExecutor(db, key, undefined, undefined, mail);
    for (const [id, from, host, port] of [['gmail', 'me@gmail.com', 'smtp.gmail.com', 465], ['outlook', 'me@outlook.com', 'smtp-mail.outlook.com', 587], ['old-ionos', 'me@sepenta.io', 'smtp.ionos.co.uk', 465]] as const) {
      expect((await execute('alice', task(id), `${id}:1`)).status, id).toBe('succeeded');
      expect(used.at(-1), id).toMatchObject({ from, target: { host, port } });
    }
    await db.close();
  });

  it('never sends from someone else\'s mailbox or one that is not a mailbox', async () => {
    const db = await setup();
    await db.query("INSERT INTO connections(id,owner_id,provider,display_name,settings) VALUES ('jira','alice','jira','Jira','{}')");
    const sendMail = vi.fn(async () => ({ accepted: ['sam@example.com'], rejected: [] }));
    const mail = new MailConnector(() => ({ verify: async () => true, close: () => {}, sendMail }));
    const execute = createProviderExecutor(db, key, undefined, undefined, mail);
    expect((await execute('alice', task('bobs'), 'k:1')).status).toBe('failed');
    expect((await execute('alice', task('jira'), 'k:2')).status).toBe('failed');
    expect(sendMail).not.toHaveBeenCalled();
    await db.close();
  });

  it('still never retries an uncertain send automatically', async () => {
    const db = await setup();
    const sendMail = vi.fn(async () => { throw Object.assign(new Error('timeout after acceptance'), { code: 'ETIMEDOUT', command: 'DATA' }); });
    const execute = createProviderExecutor(db, key, undefined, undefined, new MailConnector(() => ({ verify: async () => true, close: () => {}, sendMail })));
    expect((await execute('alice', task('gmail'), 'k:3')).status).toBe('uncertain');
    expect(sendMail).toHaveBeenCalledTimes(1);
    await db.close();
  });
});
