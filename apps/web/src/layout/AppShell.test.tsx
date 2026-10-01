import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { AppShell } from './AppShell.js';
import { ProfileMenu } from './ProfileMenu.js';

describe('app shell', () => {
  it('shows the logo, main navigation with the current page marked, and the profile button', () => {
    const html = renderToString(<AppShell email="siros@example.com" page="/activity" onSignOut={() => {}}><p>content</p></AppShell>);
    expect(html).toMatch(/<img[^>]*sepenta-logo-light-bg/);
    expect(html).toContain('aria-label="Main"');
    expect(html).toMatch(/<a[^>]*href="\/activity"[^>]*aria-current="page"/);
    expect(html).not.toMatch(/<a[^>]*href="\/"[^>]*aria-current/);
    expect(html).toContain('aria-label="Profile menu for siros@example.com"');
    expect(html).toContain('>S</button>');
    expect(html).toContain('content');
  });

  it('keeps the menu closed until the avatar is pressed, with Settings only reachable through it', () => {
    const closed = renderToString(<ProfileMenu email="a@b.co" onSignOut={() => {}} />);
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).not.toContain('role="menu"');
    expect(closed).not.toContain('Settings');
    const shell = renderToString(<AppShell email="a@b.co" page="/" onSignOut={() => {}}>x</AppShell>);
    expect(shell).not.toContain('>Settings<');
  });

  it('opens to the email, Settings, Account and Sign out as menu items', () => {
    const open = renderToString(<ProfileMenu email="a@b.co" onSignOut={() => {}} defaultOpen />);
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain('role="menu"');
    expect(open).toContain('a@b.co');
    expect(open).toMatch(/<a[^>]*href="\/settings"[^>]*role="menuitem"[^>]*>Settings<\/a>/);
    expect(open).toMatch(/<a[^>]*href="\/account"[^>]*role="menuitem"[^>]*>Account<\/a>/);
    expect(open).toMatch(/<button[^>]*role="menuitem"[^>]*>Sign out<\/button>/);
  });

  it('gives Home a full-height chat frame and every other page the normal scrolling page', () => {
    const home = renderToString(<AppShell email="a@b.co" page="/" onSignOut={() => {}}><p>x</p></AppShell>);
    const other = renderToString(<AppShell email="a@b.co" page="/settings" onSignOut={() => {}}><p>x</p></AppShell>);
    expect(home).toContain('class="shell shell-chat"');
    expect(other).toContain('class="shell"');
    expect(other).not.toContain('shell-chat');
  });
});
