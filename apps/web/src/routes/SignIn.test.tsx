import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { SignIn } from './SignIn.js';

describe('SignIn', () => {
  it('offers sign-in with a path to self-service account creation', () => {
    const html = renderToString(<SignIn onSubmit={async () => {}} />);
    expect(html).toContain('Email');
    expect(html).toContain('Password');
    expect(html).toContain('Sign in');
    expect(html).toContain('Create account');
    expect(html).not.toContain('Confirm password');
  });

  it('guides account creation with privacy note and password confirmation', () => {
    const html = renderToString(<SignIn onSubmit={async () => {}} initialMode="up" />);
    expect(html).toContain('Create your account');
    expect(html).toContain('private to your account');
    expect(html).toContain('Confirm password');
    expect(html).toContain('I already have an account');
  });
});
