import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { TeamsSettings } from './TeamsSettings.js';

describe('Microsoft Teams in Settings', () => {
  it('shows who is signed in, the promise about permissions, and a Test connection button', () => {
    const html = renderToStaticMarkup(<TeamsSettings id="t1" settings={{ accountName: 'Peyman Ebrahimi', account: 'peyman@sepenta.io' }} />);
    expect(html).toContain('Peyman Ebrahimi');
    expect(html).toContain('peyman@sepenta.io');
    expect(html).toContain('Test connection');
    expect(html).toContain('Nothing is sent without your approval');
    expect(html).not.toMatch(/token|secret/i);
  });

  it('falls back to a generic line when the account name is unknown', () => {
    expect(renderToStaticMarkup(<TeamsSettings id="t1" settings={{}} />)).toContain('your Microsoft account');
  });

  it('is wired into Settings: a Connect button, the return from Microsoft, and the administrator message', () => {
    const source = readFileSync(new URL('./Settings.tsx', import.meta.url), 'utf8');
    expect(source).toContain('Connect Microsoft Teams');
    expect(source).toContain("/connections/teams/start");
    expect(source).toContain("startsWith('teams_')");
    expect(source).toContain('Microsoft needs an administrator');
    expect(source).toContain('Microsoft Teams is not available yet.');
  });
});
