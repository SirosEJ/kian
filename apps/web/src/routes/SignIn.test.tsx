import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { SignIn } from './SignIn.js';

describe('SignIn', () => {
  it('offers both sign-in and self-service account creation', () => {
    const html = renderToString(<SignIn onSubmit={async () => {}} />);
    expect(html).toContain('Email');
    expect(html).toContain('Password');
    expect(html).toContain('Create account');
    expect(html).toContain('Sign in');
  });
});
