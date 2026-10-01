import { describe, expect, it } from 'vitest';
import { initialOf, nextIndex } from './profile.js';
import { pages, resolveRoute } from './routing.js';

describe('routing', () => {
  it('knows the four pages and treats a trailing slash as the same page', () => {
    expect(pages).toEqual(['/', '/activity', '/settings', '/account']);
    for (const page of pages) expect(resolveRoute(page, '').page).toBe(page);
    expect(resolveRoute('/settings/', '').page).toBe('/settings');
    expect(resolveRoute('/nope', '').page).toBeNull();
  });

  it('sends the provider callback to Settings with the query intact so the connection can complete', () => {
    expect(resolveRoute('/', '?code=abc&state=google_xyz')).toEqual({ page: '/settings', redirectTo: '/settings?code=abc&state=google_xyz' });
    expect(resolveRoute('/', '?code=abc&state=jira_xyz').redirectTo).toBe('/settings?code=abc&state=jira_xyz');
  });

  it('does not redirect Home visits that only look similar', () => {
    expect(resolveRoute('/', '').redirectTo).toBeUndefined();
    expect(resolveRoute('/', '?code=abc').redirectTo).toBeUndefined();
    expect(resolveRoute('/activity', '?code=abc&state=x').redirectTo).toBeUndefined();
  });
});

describe('profile helpers', () => {
  it('shows the first letter of the email in capitals, with a fallback', () => {
    expect(initialOf('siros.jarchlou@gmail.com')).toBe('S');
    expect(initialOf('  élodie@example.com')).toBe('É');
    expect(initialOf('42@example.com')).toBe('4');
    expect(initialOf('')).toBe('?');
    expect(initialOf(null)).toBe('?');
  });

  it('moves focus around the menu with the arrow, Home and End keys, wrapping at the ends', () => {
    expect(nextIndex(0, 3, 'ArrowDown')).toBe(1);
    expect(nextIndex(2, 3, 'ArrowDown')).toBe(0);
    expect(nextIndex(0, 3, 'ArrowUp')).toBe(2);
    expect(nextIndex(1, 3, 'Home')).toBe(0);
    expect(nextIndex(1, 3, 'End')).toBe(2);
    expect(nextIndex(1, 3, 'a')).toBe(1);
    expect(nextIndex(0, 0, 'ArrowDown')).toBe(-1);
  });
});
