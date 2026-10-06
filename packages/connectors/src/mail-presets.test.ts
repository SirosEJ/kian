import { describe, expect, it, vi } from 'vitest';
import { MailConnectionError, MailConnector, settingsOf, type MailTarget } from './ionos-mail.js';
import { ALLOWED_MAIL_PORTS, MAIL_PRESETS, presetById } from './mail-presets.js';
import { isPlausibleMailHost, isPublicAddress, resolvePublicMailHost, UnsafeMailHost } from './mail-safety.js';

const ok = { verify: async () => true, sendMail: async () => ({ accepted: ['a@example.com'], rejected: [], messageId: 'id' }), close: () => {} };
const publicResolver = async () => [{ address: '93.184.216.34', family: 4 }];

describe('mail presets', () => {
  it('lists the providers people use, each with a server, a safe port and plain-words help', () => {
    const ids = MAIL_PRESETS.map(p => p.id);
    for (const id of ['gmail', 'outlook', 'microsoft365', 'yahoo', 'icloud', 'zoho', 'fastmail', 'gmx', 'ionos-uk', 'ionos-com', 'ionos-de', 'other']) expect(ids).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of MAIL_PRESETS) {
      expect(p.help.length, p.id).toBeGreaterThan(20);
      expect((ALLOWED_MAIL_PORTS as readonly number[]).includes(p.port), p.id).toBe(true);
      // Implicit TLS on 465, STARTTLS on the others: never plain text.
      expect(p.security, p.id).toBe(p.port === 465 ? 'ssl' : 'starttls');
      if (p.id !== 'other') expect(p.host, p.id).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/);
    }
    expect(presetById('gmail')).toMatchObject({ host: 'smtp.gmail.com', port: 465, security: 'ssl', appPassword: true });
    expect(presetById('outlook')).toMatchObject({ host: 'smtp-mail.outlook.com', port: 587, security: 'starttls' });
    expect(presetById('microsoft365')).toMatchObject({ host: 'smtp.office365.com', port: 587 });
    expect(MAIL_PRESETS.find(p => p.id === 'gmail')!.help).toMatch(/2-Step Verification.*App passwords/s);
    expect(presetById('nope')).toBeUndefined();
  });

  it('connects through each preset using the preset\'s own server and port, ignoring any host the client sends', async () => {
    for (const preset of MAIL_PRESETS.filter(p => p.host)) {
      const seen: MailTarget[] = [];
      const mail = new MailConnector((_c, target) => { seen.push(target); return ok; }, publicResolver);
      const saved = await mail.connect({ preset: preset.id, host: 'evil.example.com', port: 25, user: 'me@example.com', password: 'app-pass' });
      expect(saved, preset.id).toMatchObject({ host: preset.host, port: preset.port, security: preset.security, preset: preset.id, user: 'me@example.com' });
      expect(seen[0], preset.id).toEqual({ host: preset.host, servername: preset.host, port: preset.port, security: preset.security });
    }
  });

  it('still accepts a mailbox saved before presets existed (IONOS on 465) and nothing else without a preset', async () => {
    const mail = new MailConnector(() => ok, publicResolver);
    expect(settingsOf({ host: 'smtp.ionos.co.uk', user: 'a@b.co', password: 'x' })).toMatchObject({ host: 'smtp.ionos.co.uk', port: 465, security: 'ssl' });
    expect(await mail.test({ host: 'smtp.ionos.de', user: 'a@b.co', password: 'x' })).toBe(true);
    expect(() => settingsOf({ host: 'smtp.evil.com', user: 'a@b.co', password: 'x' })).toThrow(MailConnectionError);
  });

  it('sends from the chosen mailbox through the preset server', async () => {
    const sendMail = vi.fn(async (_m: unknown) => ({ accepted: ['sam@example.com'], rejected: [], messageId: 'm' }));
    const mail = new MailConnector(() => ({ ...ok, sendMail }), publicResolver);
    const result = await mail.execute({ preset: 'gmail', host: 'smtp.gmail.com', port: 465, security: 'ssl', user: 'me@gmail.com', password: 'p' }, { action: 'email.send', to: ['sam@example.com'], subject: 'Hi', body: 'Hello' }, 'task-1:1');
    expect(result.status).toBe('succeeded');
    expect(sendMail.mock.calls[0][0]).toMatchObject({ from: 'me@gmail.com', to: ['sam@example.com'], messageId: expect.stringMatching(/^<[0-9a-f]{64}@gmail\.com>$/) });
  });
});

describe('provider-specific failures', () => {
  const failing = (error: object) => new MailConnector(() => ({ ...ok, verify: async () => { throw Object.assign(new Error('x'), error); } }), publicResolver);
  const conn = { preset: 'gmail', host: 'smtp.gmail.com', user: 'me@gmail.com', password: 'p' };
  it('tells a wrong password from "an app password is needed" and from "the administrator switched password sign-in off"', async () => {
    expect(await failing({ code: 'EAUTH', responseCode: 535, response: '535-5.7.8 Username and Password not accepted' }).diagnose(conn)).toEqual({ ok: false, reason: 'auth' });
    expect(await failing({ code: 'EAUTH', responseCode: 534, response: '534-5.7.9 Application-specific password required' }).diagnose(conn)).toEqual({ ok: false, reason: 'app-password' });
    expect(await failing({ code: 'EAUTH', responseCode: 535, response: '535 5.7.139 Authentication unsuccessful, basic authentication is disabled' }).diagnose({ ...conn, preset: 'microsoft365', host: 'smtp.office365.com' })).toEqual({ ok: false, reason: 'basic-auth-disabled' });
    expect(await failing({ code: 'ESOCKET', message: 'certificate has expired' }).diagnose(conn)).toEqual({ ok: false, reason: 'tls' });
  });
});

describe('custom mail servers cannot be used to reach internal systems', () => {
  const other = (host: string, extra: object = {}) => ({ preset: 'other', host, port: 587, security: 'starttls', user: 'me@example.com', password: 'p', ...extra });
  it('accepts a public server and connects by the checked address while verifying the certificate for the name', async () => {
    const seen: MailTarget[] = [];
    const mail = new MailConnector((_c, t) => { seen.push(t); return ok; }, publicResolver);
    const saved = await mail.connect(other('Mail.Example-Provider.com'));
    expect(saved).toMatchObject({ host: 'mail.example-provider.com', port: 587, security: 'starttls', preset: 'other' });
    expect(seen[0]).toEqual({ host: '93.184.216.34', servername: 'mail.example-provider.com', port: 587, security: 'starttls' });
  });

  it('refuses names that are not public mail servers, before any connection is tried', async () => {
    let tried = 0;
    const mail = new MailConnector(() => { tried++; return ok; }, publicResolver);
    for (const host of ['localhost', 'intranet', 'db.internal', 'printer.local', '127.0.0.1', '10.0.0.5', '169.254.169.254', '[::1]', '::1', 'a.b', 'smtp.example.com:25', 'smtp.example.com/x', 'smtp.example.com\r\nRCPT', '-bad.example.com', '', 'x'.repeat(300) + '.com']) {
      const result = await mail.diagnose(other(host) as never);
      expect(result.ok, host).toBe(false);
      await expect(mail.connect(other(host))).rejects.toBeInstanceOf(MailConnectionError);
    }
    expect(tried).toBe(0);
  });

  it('refuses a public-looking name that resolves to a private address (including when only one of several is private)', async () => {
    let tried = 0;
    for (const answers of [[{ address: '10.1.2.3', family: 4 }], [{ address: '169.254.169.254', family: 4 }], [{ address: '127.0.0.1', family: 4 }], [{ address: '::1', family: 6 }], [{ address: 'fd00::1', family: 6 }], [{ address: '::ffff:192.168.1.1', family: 6 }], [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }]]) {
      const mail = new MailConnector(() => { tried++; return ok; }, async () => answers);
      expect(await mail.diagnose(other('smtp.rebind.example-provider.com') as never), JSON.stringify(answers)).toEqual({ ok: false, reason: 'blocked' });
      const sent = await mail.execute(other('smtp.rebind.example-provider.com') as never, { action: 'email.send', to: ['a@example.com'], subject: 's', body: 'b' }, 'k');
      expect(sent.status).toBe('failed');
    }
    expect(tried).toBe(0);
  });

  it('says "host" (not "blocked") when the name simply does not resolve', async () => {
    const mail = new MailConnector(() => ok, async () => { throw new Error('ENOTFOUND'); });
    expect(await mail.diagnose(other('smtp.nowhere.example-provider.com') as never)).toEqual({ ok: false, reason: 'host' });
  });

  it('allows only the mail ports and never plain text: 465 is SSL, the others STARTTLS', async () => {
    const mail = new MailConnector(() => ok, publicResolver);
    for (const [port, security] of [[22, 'starttls'], [80, 'ssl'], [443, 'ssl'], [3306, 'starttls'], [6379, 'starttls'], [25, 'ssl'], [465, 'starttls'], [587, 'ssl'], [587, 'none'], [0, 'ssl'], ['587; x', 'starttls']] as const) {
      await expect(mail.connect(other('smtp.example-provider.com', { port, security })), `${port} ${security}`).rejects.toMatchObject({ reason: 'input' });
    }
    for (const [port, security] of [[25, 'starttls'], [465, 'ssl'], [587, 'starttls'], [2587, 'starttls']] as const) expect((await mail.connect(other('smtp.example-provider.com', { port, security }))).port).toBe(port);
  });
});

describe('address classification', () => {
  it('knows which addresses are on the public internet', () => {
    for (const ip of ['93.184.216.34', '8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '2a00:1450:4009:81f::200e']) expect(isPublicAddress(ip), ip).toBe(true);
    for (const ip of ['0.0.0.0', '10.0.0.1', '10.255.255.255', '100.64.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.0.2.1', '192.168.0.1', '198.18.0.1', '198.51.100.7', '203.0.113.9', '224.0.0.1', '255.255.255.255',
      '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '2001:db8::1', '::ffff:10.0.0.1', '::ffff:127.0.0.1', '::ffff:a00:1', '64:ff9b::a00:1', '2002:7f00:1::1', 'not an ip', '', '999.1.1.1']) expect(isPublicAddress(ip), ip).toBe(false);
    expect(isPublicAddress('172.15.0.1')).toBe(true);
    expect(isPublicAddress('172.32.0.1')).toBe(true);
    expect(isPublicAddress('100.63.0.1')).toBe(true);
  });
  it('accepts plain public-looking names only', () => {
    expect(isPlausibleMailHost('smtp.fastmail.com')).toBe(true);
    for (const h of ['localhost', 'a', 'smtp', 'x.local', 'x.internal', 'x.lan', 'x.test', '1.2.3.4', 'a b.com', 'a_b.com', 'ü.com', 'smtp.example.com.', undefined, 5]) expect(isPlausibleMailHost(h as never), String(h)).toBe(false);
  });
  it('resolvePublicMailHost throws UnsafeMailHost with the reason', async () => {
    await expect(resolvePublicMailHost('localhost', publicResolver)).rejects.toMatchObject({ why: 'name' });
    await expect(resolvePublicMailHost('a.example-provider.com', async () => [{ address: '10.0.0.1', family: 4 }])).rejects.toBeInstanceOf(UnsafeMailHost);
    await expect(resolvePublicMailHost('a.example-provider.com', async () => [])).rejects.toMatchObject({ why: 'unresolved' });
    expect(await resolvePublicMailHost('a.example-provider.com', async () => [{ address: '2606:4700::1', family: 6 }, { address: '93.184.216.34', family: 4 }])).toBe('93.184.216.34');
  });
});
