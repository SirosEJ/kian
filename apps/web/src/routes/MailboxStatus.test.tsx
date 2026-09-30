import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MailboxStatus } from './MailboxStatus.js';

describe('MailboxStatus', () => {
  it('shows the mailbox with test and password update controls', () => {
    const html = renderToString(<MailboxStatus id="m1" settings={{ mailbox: 'me@example.com', host: 'smtp.ionos.co.uk' }} onUpdated={async () => {}} />);
    expect(html).toContain('me@example.com');
    expect(html).toContain('Test connection');
    expect(html).toContain('Update password');
  });
});
