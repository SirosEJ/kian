import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Account } from './Account.js';

describe('Account', () => {
  it('offers account deletion behind a confirmation step', () => {
    const html = renderToString(<Account onDeleted={() => {}} />);
    expect(html).toContain('Delete my account');
    expect(html).not.toContain('Permanently delete account');
  });
});
