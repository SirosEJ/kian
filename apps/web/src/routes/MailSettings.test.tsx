import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { MailSettings, type MailPresetInfo } from './MailSettings.js';
import { MailboxStatus } from './MailboxStatus.js';

const presets: MailPresetInfo[] = [
  { id: 'gmail', label: 'Gmail', host: 'smtp.gmail.com', port: 465, security: 'ssl', appPassword: true, help: 'Gmail needs an app password: Google account, Security, 2-Step Verification, App passwords.' },
  { id: 'microsoft365', label: 'Microsoft 365 (work or school)', host: 'smtp.office365.com', port: 587, security: 'starttls', appPassword: false, help: 'Your administrator must allow authenticated SMTP.' },
  { id: 'other', label: 'Other server', host: null, port: 587, security: 'starttls', appPassword: false, help: 'Ask your provider.' },
];

describe('Connect email in Settings (SFT-341)', () => {
  it('offers every provider and explains where to get the app password for the first one', () => {
    const html = renderToStaticMarkup(<MailSettings onUpdated={async () => {}} initialPresets={presets} />);
    expect(html).toContain('Connect email');
    for (const label of ['Gmail', 'Microsoft 365 (work or school)', 'Other server']) expect(html).toContain(label);
    expect(html).toContain('2-Step Verification');
    expect(html).toContain('App password');
    expect(html).toContain('Test and save mailbox');
    expect(html).not.toContain('IONOS');
  });
  it('does not ask for server details until "Other server" is chosen', () => {
    expect(renderToStaticMarkup(<MailSettings onUpdated={async () => {}} initialPresets={presets} />)).not.toContain('Outgoing mail server');
  });
  it('shows a connected mailbox with its provider and the shared test and update routes', () => {
    const html = renderToStaticMarkup(<MailboxStatus id="m1" settings={{ mailbox: 'me@gmail.com', host: 'smtp.gmail.com', presetLabel: 'Gmail' }} onUpdated={async () => {}} />);
    expect(html).toContain('me@gmail.com');
    expect(html).toContain('(Gmail)');
    expect(readFileSync(new URL('./MailboxStatus.tsx', import.meta.url), 'utf8')).toContain('/connections/mailbox/');
  });
  it('the send card lists mailboxes of both kinds', () => {
    const source = readFileSync(new URL('./TaskReview.tsx', import.meta.url), 'utf8');
    expect(source).toContain("c.provider==='ionos'||c.provider==='mailbox'");
  });
});
